import { activeAgentAssignments, agentMeshRoster, answerFromEvidence, createActions, LocalEvidenceRetriever, officialSourceRegistry, type Action, type Audience, type DocumentChunk, type Opportunity, type Profile, type Requirement } from "@openaction/core";
import { buildDemoCatalog, demoProfiles } from "@openaction/core/fixtures";
import { decideReview, type EvidenceBindings, type ReviewDecision } from "./persistence";
import type { RagBindings } from "./vectorize";
import { createIngestJob, type IngestJob } from "./ingestion";
import { OpenActionIngestWorkflow, scheduledJobs } from "./workflow";
import { retrieveSemanticEvidence } from "./semantic";
import { discoverSourceCandidates } from "./source-scout";

interface Env extends EvidenceBindings, RagBindings {
  INGEST_QUEUE?: Queue<IngestJob>;
  INGEST_WORKFLOW?: Workflow<IngestJob>;
  INGEST_TRIGGER_TOKEN?: string;
  GITHUB_INGEST_TOKEN?: string;
  AGENT_REASONING_MODEL?: string;
  ADMIN_TOKEN?: string;
}

const rateLimits = new Map<string, { count: number; resetAt: number }>();

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function allowRequest(request: Request): boolean {
  const key = request.headers.get("cf-connecting-ip") ?? "local";
  const now = Date.now();
  const state = rateLimits.get(key);
  if (!state || state.resetAt < now) {
    rateLimits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  state.count += 1;
  return state.count <= 60;
}

function isAdmin(request: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN ?? env.INGEST_TRIGGER_TOKEN;
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

function hasBearerToken(request: Request, expected: string | undefined): boolean {
  const received = request.headers.get("authorization");
  const candidate = received?.startsWith("Bearer ") ? received.slice("Bearer ".length) : "";
  if (!expected || candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  return difference === 0;
}

function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<Profile>;
  return ["business", "student", "citizen"].includes(profile.audience ?? "") && typeof profile.id === "string" && typeof profile.label === "string" && typeof profile.facts === "object" && profile.facts !== null;
}

function actionsForProfile(profile: Profile, catalog: Awaited<ReturnType<typeof buildDemoCatalog>>) {
  const base = demoProfiles[profile.audience as Audience];
  const effectiveProfile = { ...base, ...profile, facts: { ...base.facts, ...profile.facts } };
  const sourceMap = new Map(catalog.sources.map((source) => [source.id, source]));
  return createActions(catalog.opportunities, effectiveProfile, sourceMap, catalog.snapshots[0]?.retrievedAt ?? new Date().toISOString());
}

const opportunityKinds = new Set<Opportunity["kind"]>(["scheme", "tender", "deadline", "scholarship", "service"]);
const requirementOperators = new Set<Requirement["operator"]>(["equals", "in", "gte", "lte", "truthy"]);

function parseRequirements(value: unknown): Requirement[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const requirement = item as Partial<Requirement>;
      return typeof requirement.field === "string" && typeof requirement.label === "string" && requirementOperators.has(requirement.operator as Requirement["operator"])
        ? [{ field: requirement.field, operator: requirement.operator as Requirement["operator"], value: requirement.value, label: requirement.label }]
        : [];
    });
  } catch {
    return [];
  }
}

async function liveActionsForProfile(db: D1Database | undefined, profile: Profile): Promise<Action[]> {
  if (!db) return [];
  const result = await db.prepare("SELECT o.id, o.source_id, o.document_version_id, o.audience, o.kind, o.title, o.summary, o.action_label, o.action_url, o.deadline, o.requirements_json, snap.retrieved_at FROM opportunities o JOIN document_versions d ON d.id = o.document_version_id JOIN snapshots snap ON snap.id = d.snapshot_id WHERE o.audience = ? ORDER BY snap.retrieved_at DESC, o.title ASC LIMIT 36")
    .bind(profile.audience)
    .all<Record<string, unknown>>();
  const sourceMap = new Map(officialSourceRegistry.map((source) => [source.id, source]));
  const base = demoProfiles[profile.audience];
  const effectiveProfile = { ...base, ...profile, facts: { ...base.facts, ...profile.facts } };
  return result.results.flatMap((row) => {
    const sourceId = typeof row.source_id === "string" ? row.source_id : "";
    const source = sourceMap.get(sourceId);
    const kind = typeof row.kind === "string" && opportunityKinds.has(row.kind as Opportunity["kind"]) ? row.kind as Opportunity["kind"] : null;
    const retrievedAt = typeof row.retrieved_at === "string" ? row.retrieved_at : null;
    if (!source || !kind || !retrievedAt || typeof row.id !== "string" || typeof row.document_version_id !== "string" || typeof row.title !== "string" || typeof row.summary !== "string" || typeof row.action_label !== "string" || typeof row.action_url !== "string") return [];
    const opportunity: Opportunity = {
      id: row.id,
      sourceId,
      documentVersionId: row.document_version_id,
      audience: profile.audience,
      kind,
      title: row.title,
      summary: row.summary,
      actionLabel: row.action_label,
      actionUrl: row.action_url,
      deadline: typeof row.deadline === "string" ? row.deadline : undefined,
      requirements: parseRequirements(row.requirements_json)
    };
    return createActions([opportunity], effectiveProfile, new Map([[sourceId, source]]), retrievedAt);
  });
}

function fixtureChunks(catalog: Awaited<ReturnType<typeof buildDemoCatalog>>): DocumentChunk[] {
  return catalog.opportunities.map((opportunity) => ({
    id: `chunk-${opportunity.id}`,
    documentVersionId: opportunity.documentVersionId,
    sourceId: opportunity.sourceId,
    ordinal: 0,
    text: `${opportunity.title}. ${opportunity.summary}`,
    tokenEstimate: 20
  }));
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return json({}, { headers: { "access-control-allow-methods": "GET, POST, OPTIONS" } });
    if (!allowRequest(request)) return json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
    const url = new URL(request.url);
    const catalog = await buildDemoCatalog();

    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, mode: "fixture", sourceCount: catalog.sources.length });
    if (request.method === "GET" && url.pathname === "/v1/catalog") return json({ sources: catalog.sources, snapshots: catalog.snapshots, opportunities: catalog.opportunities });
    if (request.method === "GET" && url.pathname === "/v1/sources") return json({ sources: officialSourceRegistry, collectionPolicy: "Only allow-listed HTTPS public pages are collected. Access controls and source terms are never bypassed." });
    if (request.method === "GET" && url.pathname === "/v1/agent-mesh") return json({
      agents: agentMeshRoster,
      activeAssignments: activeAgentAssignments(officialSourceRegistry).map(({ agent, source }) => ({ agentId: agent.id, sourceId: source.id, sourceName: source.name })),
      policy: "Agents may discover and assess candidates, but cannot add collectors, create unsourced actions, or publish eligibility decisions."
    });
    if (request.method === "GET" && url.pathname === "/v1/agent-findings") {
      if (!_env.DB) return json({ findings: [], mode: "unconfigured" });
      const audience = url.searchParams.get("audience");
      const statement = audience
        ? _env.DB.prepare("SELECT f.id, f.agent_id, f.source_id, f.source_name, f.document_version_ids_json, f.signals_json, f.created_at, s.publisher, s.canonical_url FROM agent_findings f JOIN sources s ON s.id = f.source_id WHERE s.audience_json LIKE ? AND NOT EXISTS (SELECT 1 FROM agent_findings newer WHERE newer.source_id = f.source_id AND newer.created_at > f.created_at) ORDER BY f.created_at DESC LIMIT 24").bind(`%${audience}%`)
        : _env.DB.prepare("SELECT f.id, f.agent_id, f.source_id, f.source_name, f.document_version_ids_json, f.signals_json, f.created_at, s.publisher, s.canonical_url FROM agent_findings f JOIN sources s ON s.id = f.source_id WHERE NOT EXISTS (SELECT 1 FROM agent_findings newer WHERE newer.source_id = f.source_id AND newer.created_at > f.created_at) ORDER BY f.created_at DESC LIMIT 24");
      const result = await statement.all<Record<string, unknown>>();
      const findings = result.results.map((finding) => ({
        id: finding.id,
        agentId: finding.agent_id,
        sourceId: finding.source_id,
        sourceName: finding.source_name,
        publisher: finding.publisher,
        canonicalUrl: finding.canonical_url,
        documentVersionIds: parseJsonArray(finding.document_version_ids_json),
        signals: parseSignals(finding.signals_json),
        createdAt: finding.created_at,
        notice: "AI-selected signals are shown only with exact excerpts from collected official source material. They are informational, not eligibility or legal decisions."
      }));
      return json({ findings, mode: "live" });
    }
    if (request.method === "GET" && url.pathname === "/v1/source-candidates") {
      if (!_env.DB) return json({ candidates: [], mode: "unconfigured" });
      const result = await _env.DB.prepare("SELECT id, agent_id, discovered_from_source_id, canonical_url, name, evidence_excerpt, host, score, review_reason, status, created_at FROM source_candidates WHERE status = 'pending_review' ORDER BY score DESC, created_at DESC LIMIT 50").all<Record<string, unknown>>();
      return json({
        candidates: result.results.map((candidate) => ({
          id: candidate.id,
          agentId: candidate.agent_id,
          discoveredFromSourceId: candidate.discovered_from_source_id,
          canonicalUrl: candidate.canonical_url,
          name: candidate.name,
          evidenceExcerpt: candidate.evidence_excerpt,
          host: candidate.host,
          score: candidate.score,
          reviewReason: candidate.review_reason,
          status: candidate.status,
          createdAt: candidate.created_at
        })),
        notice: "Candidates are leads from trusted public pages. They are not monitored sources until a human verifies authority, access rules, and usefulness."
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/actions") {
      const audience = url.searchParams.get("audience");
      if (audience !== "business" && audience !== "student" && audience !== "citizen") return json({ error: "Provide a recognised audience." }, { status: 400 });
      const actions = await liveActionsForProfile(_env.DB, { id: `public-${audience}`, label: `Public ${audience} context`, audience, facts: {} });
      return json({ actions, mode: "live_resource_leads", informationalNotice: "These are leads from official resources already discovered by monitored sources. They are not eligibility determinations; confirm all criteria and deadlines on the linked official page." });
    }
    if (request.method === "GET" && url.pathname === "/v1/resources") {
      if (!_env.DB) return json({ resources: [], mode: "unconfigured", notice: "Official resource links appear after live source collection is configured." });
      const audience = url.searchParams.get("audience");
      const statement = audience
        ? _env.DB.prepare("SELECT d.id, d.title, d.canonical_url, d.source_id, s.name AS source_name, s.publisher, s.audience_json, snap.retrieved_at FROM document_versions d JOIN sources s ON s.id = d.source_id JOIN snapshots snap ON snap.id = d.snapshot_id WHERE d.external_id LIKE 'resource:%' AND s.audience_json LIKE ? AND NOT EXISTS (SELECT 1 FROM document_versions newer JOIN snapshots newer_snap ON newer_snap.id = newer.snapshot_id WHERE newer.source_id = d.source_id AND newer.external_id = d.external_id AND newer_snap.retrieved_at > snap.retrieved_at) ORDER BY snap.retrieved_at DESC LIMIT 24").bind(`%${audience}%`)
        : _env.DB.prepare("SELECT d.id, d.title, d.canonical_url, d.source_id, s.name AS source_name, s.publisher, s.audience_json, snap.retrieved_at FROM document_versions d JOIN sources s ON s.id = d.source_id JOIN snapshots snap ON snap.id = d.snapshot_id WHERE d.external_id LIKE 'resource:%' AND NOT EXISTS (SELECT 1 FROM document_versions newer JOIN snapshots newer_snap ON newer_snap.id = newer.snapshot_id WHERE newer.source_id = d.source_id AND newer.external_id = d.external_id AND newer_snap.retrieved_at > snap.retrieved_at) ORDER BY snap.retrieved_at DESC LIMIT 24");
      const result = await statement.all<Record<string, unknown>>();
      const resources = result.results.map((resource) => ({
        id: resource.id,
        title: resource.title,
        sourceId: resource.source_id,
        sourceName: resource.source_name,
        publisher: resource.publisher,
        canonicalUrl: resource.canonical_url,
        retrievedAt: resource.retrieved_at,
        notice: "Official link discovered from a monitored public source. Confirm eligibility and application details on the linked page."
      }));
      return json({ resources, mode: "live" });
    }
    if (request.method === "GET" && url.pathname === "/v1/status") {
      if (!_env.DB) return json({ sources: [], mode: "unconfigured", notice: "Live source status appears after the D1 binding is configured." });
      const result = await _env.DB.prepare("SELECT s.id, s.name, s.publisher, s.canonical_url, s.refresh_hours, r.status AS run_status, r.stage AS run_stage, r.requested_at, r.completed_at, r.error, r.document_count, r.indexed_count FROM sources s LEFT JOIN ingestion_runs r ON r.id = (SELECT id FROM ingestion_runs WHERE source_id = s.id ORDER BY requested_at DESC LIMIT 1) ORDER BY s.name ASC").all<Record<string, unknown>>();
      const now = Date.now();
      const sources = result.results.map((source) => {
        const checkedAt = typeof source.completed_at === "string" ? source.completed_at : typeof source.requested_at === "string" ? source.requested_at : null;
        const refreshHours = typeof source.refresh_hours === "number" ? source.refresh_hours : 24;
        const ageMilliseconds = checkedAt ? now - Date.parse(checkedAt) : Number.POSITIVE_INFINITY;
        const freshness = source.run_status === "completed" ? ageMilliseconds <= refreshHours * 90 * 60_000 ? "fresh" : "stale" : source.run_status ? "unavailable" : "unknown";
        return {
          id: source.id,
          name: source.name,
          publisher: source.publisher,
          canonicalUrl: source.canonical_url,
          refreshHours,
          freshness,
          lastRun: source.run_status ? { status: source.run_status, stage: source.run_stage, checkedAt, error: source.error ?? null, documentCount: source.document_count ?? null, indexedCount: source.indexed_count ?? null } : null
        };
      });
      return json({ sources, mode: "live", checkedAt: new Date(now).toISOString() });
    }
    if (request.method === "GET" && url.pathname === "/v1/changes") {
      if (!_env.DB) return json({ changes: [], mode: "unconfigured", notice: "Live change history appears after the D1 binding and scheduled ingestion are configured." });
      const sourceId = url.searchParams.get("sourceId");
      const statement = sourceId
        ? _env.DB.prepare("SELECT c.*, s.name AS source_name, s.publisher, s.canonical_url AS source_url, r.status AS review_status FROM document_changes c JOIN sources s ON s.id = c.source_id LEFT JOIN change_reviews r ON r.change_id = c.id WHERE c.source_id = ? ORDER BY c.detected_at DESC LIMIT 50").bind(sourceId)
        : _env.DB.prepare("SELECT c.*, s.name AS source_name, s.publisher, s.canonical_url AS source_url, r.status AS review_status FROM document_changes c JOIN sources s ON s.id = c.source_id LEFT JOIN change_reviews r ON r.change_id = c.id ORDER BY c.detected_at DESC LIMIT 50");
      const result = await statement.all();
      const changes = (result.results as Record<string, unknown>[]).map((change) => ({
        id: change.id,
        sourceId: change.source_id,
        sourceName: change.source_name,
        publisher: change.publisher,
        sourceUrl: change.source_url,
        detectedAt: change.detected_at,
        impact: change.impact,
        reasons: parseJsonArray(change.reasons_json),
        addedSentences: parseJsonArray(change.added_sentences_json),
        removedSentences: parseJsonArray(change.removed_sentences_json),
        reviewStatus: change.review_status ?? null
      }));
      return json({ changes, mode: "live" });
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/reviews") {
      if (!isAdmin(request, _env)) return json({ error: "Admin access is not configured." }, { status: 401 });
      if (!_env.DB) return json({ reviews: [], mode: "unconfigured" });
      const result = await _env.DB.prepare("SELECT change_reviews.*, document_changes.source_id, document_changes.external_id, document_changes.impact, document_changes.reasons_json, document_changes.added_sentences_json, document_changes.removed_sentences_json FROM change_reviews JOIN document_changes ON document_changes.id = change_reviews.change_id WHERE change_reviews.status = 'pending' ORDER BY change_reviews.created_at ASC LIMIT 100").all();
      return json({ reviews: result.results, mode: "live" });
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/feedback") {
      if (!isAdmin(request, _env)) return json({ error: "Admin access is not configured." }, { status: 401 });
      if (!_env.DB) return json({ reports: [], mode: "unconfigured" });
      const result = await _env.DB.prepare("SELECT f.id, f.kind, f.source_id, s.name AS source_name, f.message, f.created_at, f.status FROM feedback_reports f LEFT JOIN sources s ON s.id = f.source_id ORDER BY f.created_at DESC LIMIT 100").all();
      return json({ reports: result.results, mode: "live" });
    }
    if (request.method === "POST" && url.pathname.startsWith("/v1/admin/reviews/")) {
      if (!isAdmin(request, _env)) return json({ error: "Admin access is not configured." }, { status: 401 });
      const changeId = decodeURIComponent(url.pathname.slice("/v1/admin/reviews/".length));
      const body = await request.json().catch(() => null) as { decision?: ReviewDecision; reviewer?: string; note?: string } | null;
      if (!changeId || !body || (body.decision !== "approved" && body.decision !== "rejected") || !body.reviewer?.trim()) return json({ error: "Provide a pending change ID, decision, and reviewer." }, { status: 400 });
      const changed = await decideReview(_env, changeId, body.decision, body.reviewer.trim(), body.note?.trim());
      return changed ? json({ changeId, status: body.decision }) : json({ error: "Pending review not found." }, { status: 404 });
    }
    if (request.method === "GET" && url.pathname === "/v1/search") {
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (query.length < 3) return json({ error: "Use a search query of at least 3 characters." }, { status: 400 });
      const audience = url.searchParams.get("audience") ?? undefined;
      const semanticHits = await retrieveSemanticEvidence(_env, query, audience, 5);
      const hits = semanticHits ?? new LocalEvidenceRetriever(fixtureChunks(catalog), new Map(catalog.sources.map((source) => [source.id, source]))).search(query, { audience, limit: 5 });
      return json({ query, retrievalMode: semanticHits ? "vectorize-semantic" : "local-lexical-fallback", hits, notice: semanticHits ? undefined : "Semantic Vectorize retrieval is enabled after the VECTOR_INDEX and D1 bindings are configured." });
    }
    if (request.method === "POST" && url.pathname === "/v1/ask") {
      const body = await request.json().catch(() => null) as { question?: string; audience?: string } | null;
      const question = body?.question?.trim() ?? "";
      if (question.length < 3) return json({ error: "Ask a question of at least 3 characters." }, { status: 400 });
      const semanticHits = await retrieveSemanticEvidence(_env, question, body?.audience, 3);
      const hits = semanticHits ?? new LocalEvidenceRetriever(fixtureChunks(catalog), new Map(catalog.sources.map((source) => [source.id, source]))).search(question, { audience: body?.audience, limit: 3 });
      return json({ ...answerFromEvidence(question, hits), retrievalMode: semanticHits ? "vectorize-semantic" : "local-lexical-fallback" });
    }
    if (request.method === "POST" && url.pathname === "/v1/feedback") {
      if (!_env.DB) return json({ error: "Feedback storage is unavailable." }, { status: 503 });
      const body = await request.json().catch(() => null) as { kind?: string; sourceId?: string; message?: string } | null;
      const message = body?.message?.trim() ?? "";
      const kind = body?.kind ?? "source_issue";
      const source = body?.sourceId ? officialSourceRegistry.find((candidate) => candidate.id === body.sourceId) : undefined;
      if (!body || !["source_issue", "action_issue", "other"].includes(kind) || message.length < 10 || message.length > 1_000 || (body.sourceId && !source)) return json({ error: "Provide a recognised source (if any) and a 10-1000 character report. Do not include personal information." }, { status: 400 });
      const id = `feedback-${crypto.randomUUID()}`;
      await _env.DB.prepare("INSERT INTO feedback_reports (id, kind, source_id, message, created_at, status) VALUES (?, ?, ?, ?, ?, 'new')")
        .bind(id, kind, source?.id ?? null, message, new Date().toISOString())
        .run();
      return json({ accepted: true, id, notice: "Thanks. This report is stored for evidence review and does not change published guidance automatically." }, { status: 202 });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/ingest") {
      if (!isAdmin(request, _env)) return json({ error: "Admin ingestion is not configured." }, { status: 401 });
      const body = await request.json().catch(() => null) as { sourceId?: string } | null;
      const source = officialSourceRegistry.find((candidate) => candidate.id === body?.sourceId);
      if (!source) return json({ error: "Provide a registered sourceId." }, { status: 400 });
      const job = createIngestJob(source, "manual");
      if (_env.INGEST_QUEUE) await _env.INGEST_QUEUE.send(job);
      else if (_env.INGEST_WORKFLOW) await _env.INGEST_WORKFLOW.create({ params: job });
      else return json({ error: "No ingestion Queue or Workflow binding is configured." }, { status: 503 });
      return json({ accepted: true, job });
    }
    if (request.method === "POST" && url.pathname === "/v1/ingest/github") {
      if (!hasBearerToken(request, _env.GITHUB_INGEST_TOKEN)) return json({ error: "GitHub ingestion is not configured." }, { status: 401 });
      const body = await request.json().catch(() => null) as { sourceId?: string; agentId?: string } | null;
      const source = officialSourceRegistry.find((candidate) => candidate.id === body?.sourceId);
      const agent = agentMeshRoster.find((candidate) => candidate.id === body?.agentId);
      if (!source || !agent || !agent.approvedSourceIds.includes(source.id)) return json({ error: "Provide an approved agentId and sourceId assignment." }, { status: 400 });
      const job = createIngestJob(source, "github_actions", new Date(), agent.id);
      if (_env.INGEST_QUEUE) await _env.INGEST_QUEUE.send(job);
      else if (_env.INGEST_WORKFLOW) await _env.INGEST_WORKFLOW.create({ params: job });
      else return json({ error: "No ingestion Queue or Workflow binding is configured." }, { status: 503 });
      return json({ accepted: true, agentId: agent.id, job, notice: "GitHub requested collection; Cloudflare performs the allow-listed fetch, snapshot, validation, and indexing." });
    }
    if (request.method === "POST" && url.pathname === "/v1/agents/github/scout") {
      if (!hasBearerToken(request, _env.GITHUB_INGEST_TOKEN)) return json({ error: "GitHub source scouting is not configured." }, { status: 401 });
      const body = await request.json().catch(() => null) as { agentId?: string; seedSourceId?: string } | null;
      const agent = agentMeshRoster.find((candidate) => candidate.id === body?.agentId);
      const seedSource = officialSourceRegistry.find((candidate) => candidate.id === body?.seedSourceId);
      if (!agent || !seedSource || !agent.capabilities.includes("discover")) return json({ error: "Provide a discovery-capable agentId and registered seedSourceId." }, { status: 400 });
      try {
        const candidates = await discoverSourceCandidates({
          DB: _env.DB,
          AI: _env.AI as unknown as import("./agents").AgentReasoningBinding | undefined,
          AGENT_REASONING_MODEL: _env.AGENT_REASONING_MODEL
        }, agent, seedSource);
        return json({ accepted: true, agentId: agent.id, seedSourceId: seedSource.id, candidateCount: candidates.length, candidates: candidates.map((candidate) => ({ name: candidate.name, host: candidate.host, score: candidate.score })) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Source scout failed." }, { status: 502 });
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/match") {
      const body: unknown = await request.json().catch(() => null);
      if (!isProfile(body)) return json({ error: "Provide id, label, audience, and facts." }, { status: 400 });
      const liveActions = await liveActionsForProfile(_env.DB, body);
      if (liveActions.length > 0) return json({ profile: body, actions: liveActions, mode: "live_resource_leads", informationalNotice: "Results are informational leads, not eligibility decisions. Confirm official criteria, deadlines, and source terms before acting." });
      const actions = actionsForProfile(body, catalog);
      return json({ profile: body, actions, mode: "fixture_fallback", informationalNotice: "Results are informational. Check official eligibility and source terms before acting." });
    }
    return json({ error: "Not found" }, { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const jobs = scheduledJobs();
    if (env.INGEST_QUEUE) {
      await env.INGEST_QUEUE.sendBatch(jobs.map((body) => ({ body })));
      return;
    }
    if (env.INGEST_WORKFLOW) await Promise.all(jobs.map((params) => env.INGEST_WORKFLOW!.create({ params })));
  },
  async queue(batch: MessageBatch<IngestJob>, env: Env): Promise<void> {
    if (!env.INGEST_WORKFLOW) throw new Error("INGEST_WORKFLOW binding is required to consume ingestion jobs");
    for (const message of batch.messages) {
      try {
        await env.INGEST_WORKFLOW.create({ id: `workflow-${message.id}`, params: message.body });
        message.ack();
      } catch (error) {
        message.retry({ delaySeconds: Math.min(3_600, 2 ** Math.min(message.attempts, 10)) });
        console.log("Unable to start ingestion workflow", error);
      }
    }
  }
} satisfies ExportedHandler<Env, IngestJob>;

export { OpenActionIngestWorkflow };

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseSignals(value: unknown): Array<{ title: string; evidence: string }> {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const signal = item as { title?: unknown; evidence?: unknown };
      return typeof signal.title === "string" && typeof signal.evidence === "string" ? [{ title: signal.title, evidence: signal.evidence }] : [];
    });
  } catch {
    return [];
  }
}

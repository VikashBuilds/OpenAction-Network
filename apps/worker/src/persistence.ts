import { buildResourceLeadOpportunities, compareDocumentVersions, type DocumentChange, type DocumentVersion, type IngestResult, type Opportunity, type Source } from "@openaction/core";
import type { IngestionRun } from "./ingestion";
import type { AgentFinding } from "./agents";

export interface EvidenceBindings {
  DB?: D1Database;
  SNAPSHOTS?: R2Bucket;
}

export type ReviewDecision = "approved" | "rejected";

export async function ensureSource(bindings: EvidenceBindings, source: Source, createdAt = new Date().toISOString()): Promise<void> {
  if (!bindings.DB) return;
  await bindings.DB.prepare("INSERT INTO sources (id, name, publisher, canonical_url, audience_json, refresh_hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, publisher = excluded.publisher, canonical_url = excluded.canonical_url, audience_json = excluded.audience_json, refresh_hours = excluded.refresh_hours")
    .bind(source.id, source.name, source.publisher, source.canonicalUrl, JSON.stringify(source.audience), source.refreshHours, createdAt)
    .run();
}

export async function updateIngestionRun(bindings: EvidenceBindings, run: IngestionRun): Promise<void> {
  if (!bindings.DB) return;
  await bindings.DB.prepare("INSERT INTO ingestion_runs (id, source_id, requested_at, started_at, completed_at, status, stage, error, document_count, indexed_count, change_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET started_at = COALESCE(excluded.started_at, ingestion_runs.started_at), completed_at = COALESCE(excluded.completed_at, ingestion_runs.completed_at), status = excluded.status, stage = excluded.stage, error = excluded.error, document_count = COALESCE(excluded.document_count, ingestion_runs.document_count), indexed_count = COALESCE(excluded.indexed_count, ingestion_runs.indexed_count), change_count = COALESCE(excluded.change_count, ingestion_runs.change_count)")
    .bind(run.id, run.sourceId, run.requestedAt, run.startedAt ?? null, run.completedAt ?? null, run.status, run.stage, run.error ?? null, run.documentCount ?? null, run.indexedCount ?? null, run.changeCount ?? null)
    .run();
}

export async function detectPersistedChanges(bindings: EvidenceBindings, documents: DocumentVersion[], detectedAt: string): Promise<DocumentChange[]> {
  if (!bindings.DB) return [];
  const changes: DocumentChange[] = [];
  for (const current of documents) {
    const previous = await bindings.DB.prepare("SELECT d.id, d.source_id, d.snapshot_id, d.external_id, d.title, d.body, d.canonical_url, d.version_hash FROM document_versions d JOIN snapshots s ON s.id = d.snapshot_id WHERE d.source_id = ? AND d.external_id = ? AND d.id != ? ORDER BY s.retrieved_at DESC LIMIT 1")
      .bind(current.sourceId, current.externalId, current.id)
      .first<{ id: string; source_id: string; snapshot_id: string; external_id: string; title: string; body: string; canonical_url: string; version_hash: string }>();
    if (!previous) continue;
    const change = compareDocumentVersions({
      id: previous.id,
      sourceId: previous.source_id,
      snapshotId: previous.snapshot_id,
      externalId: previous.external_id,
      title: previous.title,
      body: previous.body,
      canonicalUrl: previous.canonical_url,
      versionHash: previous.version_hash
    }, current, detectedAt);
    if (change) changes.push(change);
  }
  return changes;
}

export async function persistIngest(bindings: EvidenceBindings, source: Source, result: IngestResult): Promise<void> {
  const snapshotBody = JSON.stringify({ source, snapshot: result.snapshot, documents: result.documents });
  if (bindings.SNAPSHOTS) {
    await bindings.SNAPSHOTS.put(result.snapshot.storageKey, snapshotBody, { httpMetadata: { contentType: "application/json" } });
  }
  if (!bindings.DB) return;
  await ensureSource(bindings, source, result.snapshot.retrievedAt);
  const statements = [
    bindings.DB.prepare("INSERT OR REPLACE INTO snapshots (id, source_id, retrieved_at, content_hash, storage_key, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(result.snapshot.id, result.snapshot.sourceId, result.snapshot.retrievedAt, result.snapshot.contentHash, result.snapshot.storageKey, result.snapshot.status, result.snapshot.error ?? null),
    ...result.documents.map((document) => documentStatement(bindings.DB!, document)),
    ...buildResourceLeadOpportunities(source, result.documents).map((opportunity) => opportunityStatement(bindings.DB!, opportunity)),
    ...result.changes.map((change) => changeStatement(bindings.DB!, change))
  ];
  await bindings.DB.batch(statements);
}

export async function createPendingReviews(bindings: EvidenceBindings, changes: IngestResult["changes"]): Promise<void> {
  if (!bindings.DB) return;
  const reviewable = changes.filter((change) => change.impact === "review_required");
  if (reviewable.length === 0) return;
  await bindings.DB.batch(reviewable.map((change) => bindings.DB!.prepare("INSERT OR IGNORE INTO change_reviews (change_id, status, created_at) VALUES (?, 'pending', ?)")
    .bind(change.id, change.detectedAt)));
}

export async function decideReview(bindings: EvidenceBindings, changeId: string, decision: ReviewDecision, reviewer: string, note?: string): Promise<boolean> {
  if (!bindings.DB) return false;
  const result = await bindings.DB.prepare("UPDATE change_reviews SET status = ?, reviewer = ?, note = ?, decided_at = ? WHERE change_id = ? AND status = 'pending'")
    .bind(decision, reviewer, note ?? null, new Date().toISOString(), changeId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function hasAgentFindingForContent(bindings: EvidenceBindings, sourceId: string, contentHash: string): Promise<boolean> {
  if (!bindings.DB) return false;
  const finding = await bindings.DB.prepare("SELECT id FROM agent_findings WHERE source_id = ? AND content_hash = ? LIMIT 1")
    .bind(sourceId, contentHash)
    .first<{ id: string }>();
  return Boolean(finding);
}

export async function persistAgentFinding(bindings: EvidenceBindings, finding: AgentFinding): Promise<void> {
  if (!bindings.DB) return;
  await bindings.DB.prepare("INSERT OR IGNORE INTO agent_findings (id, agent_id, source_id, source_name, document_version_ids_json, content_hash, signals_json, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(finding.id, finding.agentId, finding.sourceId, finding.sourceName, JSON.stringify(finding.documentVersionIds), finding.contentHash, JSON.stringify(finding.signals), finding.model, finding.createdAt)
    .run();
}

function documentStatement(db: D1Database, document: DocumentVersion): D1PreparedStatement {
  return db.prepare("INSERT OR REPLACE INTO document_versions (id, source_id, snapshot_id, external_id, title, body, canonical_url, version_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(document.id, document.sourceId, document.snapshotId, document.externalId, document.title, document.body, document.canonicalUrl, document.versionHash);
}

function opportunityStatement(db: D1Database, opportunity: Opportunity): D1PreparedStatement {
  return db.prepare("INSERT INTO opportunities (id, source_id, document_version_id, audience, kind, title, summary, action_label, action_url, deadline, requirements_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET document_version_id = excluded.document_version_id, kind = excluded.kind, title = excluded.title, summary = excluded.summary, action_label = excluded.action_label, action_url = excluded.action_url, deadline = excluded.deadline, requirements_json = excluded.requirements_json")
    .bind(opportunity.id, opportunity.sourceId, opportunity.documentVersionId, opportunity.audience, opportunity.kind, opportunity.title, opportunity.summary, opportunity.actionLabel, opportunity.actionUrl, opportunity.deadline ?? null, JSON.stringify(opportunity.requirements));
}

function changeStatement(db: D1Database, change: IngestResult["changes"][number]): D1PreparedStatement {
  return db.prepare("INSERT OR REPLACE INTO document_changes (id, source_id, external_id, previous_document_version_id, current_document_version_id, detected_at, impact, reasons_json, added_sentences_json, removed_sentences_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(change.id, change.sourceId, change.externalId, change.previousDocumentVersionId, change.currentDocumentVersionId, change.detectedAt, change.impact, JSON.stringify(change.reasons), JSON.stringify(change.addedSentences), JSON.stringify(change.removedSentences));
}

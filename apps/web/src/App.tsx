import { useEffect, useMemo, useState, type FormEvent } from "react";
import { answerFromEvidence, LocalEvidenceRetriever, type Action, type Audience, type DocumentChunk, type GroundedAnswer, type Profile } from "@openaction/core";
import { buildDemoCatalog, demoProfiles } from "@openaction/core/fixtures";

const audienceLabels: Record<Audience, { title: string; subtitle: string; icon: string }> = {
  business: { title: "Build your business", subtitle: "Schemes, support and official opportunities", icon: "↗" },
  student: { title: "Plan your next step", subtitle: "Scholarships and learning opportunities", icon: "✦" },
  citizen: { title: "Navigate public services", subtitle: "Schemes and official support in one place", icon: "⌁" }
};

const storageKey = "openaction-demo-profile";
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

interface SourceChange {
  id: string;
  sourceName: string;
  publisher: string;
  sourceUrl: string;
  detectedAt: string;
  impact: "informational" | "review_required";
  reasons: string[];
  addedSentences: string[];
  removedSentences: string[];
  reviewStatus: "pending" | "approved" | "rejected" | null;
}

interface ApiAnswer extends GroundedAnswer {
  retrievalMode?: "vectorize-semantic" | "local-lexical-fallback";
}

interface SourceHealth {
  id: string;
  name: string;
  publisher: string;
  canonicalUrl: string;
  refreshHours: number;
  freshness: "fresh" | "stale" | "unavailable" | "unknown";
  lastRun: { status: string; stage: string; checkedAt: string | null; error: string | null; documentCount: number | null; indexedCount: number | null } | null;
}

interface OfficialResource {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  publisher: string;
  canonicalUrl: string;
  retrievedAt: string;
  notice: string;
}

interface AgentFinding {
  id: string;
  agentId: string;
  sourceId: string;
  sourceName: string;
  publisher: string;
  canonicalUrl: string;
  signals: Array<{ title: string; evidence: string }>;
  createdAt: string;
  notice: string;
}

interface SourceCandidate {
  id: string;
  agentId: string;
  discoveredFromSourceId: string;
  canonicalUrl: string;
  name: string;
  evidenceExcerpt: string;
  host: string;
  score: number;
  reviewReason: string;
  createdAt: string;
}

interface ActionFeed {
  actions?: Action[];
  mode?: "live_resource_leads" | "fixture_fallback";
  informationalNotice?: string;
}

function loadProfile(): Profile {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved) as Profile;
  } catch { /* Start with a useful demo profile. */ }
  return demoProfiles.business;
}

export function App() {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof buildDemoCatalog>> | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [liveAnswer, setLiveAnswer] = useState<ApiAnswer | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState("");
  const [changes, setChanges] = useState<SourceChange[] | null>(null);
  const [changeLoadError, setChangeLoadError] = useState("");
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[] | null>(null);
  const [sourceHealthError, setSourceHealthError] = useState("");
  const [resources, setResources] = useState<OfficialResource[] | null>(null);
  const [resourceError, setResourceError] = useState("");
  const [agentFindings, setAgentFindings] = useState<AgentFinding[] | null>(null);
  const [agentFindingsError, setAgentFindingsError] = useState("");
  const [sourceCandidates, setSourceCandidates] = useState<SourceCandidate[] | null>(null);
  const [sourceCandidatesError, setSourceCandidatesError] = useState("");
  const [liveActions, setLiveActions] = useState<Action[] | null>(null);
  const [liveActionsError, setLiveActionsError] = useState("");
  const [reportSource, setReportSource] = useState<SourceHealth | null>(null);

  useEffect(() => { void buildDemoCatalog().then(setCatalog); }, []);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(profile)); }, [profile]);
  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    setLiveActions(null);
    setLiveActionsError("");
    void fetch(`${apiBaseUrl}/v1/actions?audience=${encodeURIComponent(profile.audience)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The live action feed is unavailable.");
        return response.json() as Promise<ActionFeed>;
      })
      .then((payload) => setLiveActions(payload.actions ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLiveActionsError("Live action leads could not be loaded right now.");
      });
    return () => controller.abort();
  }, [profile.audience]);
  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/v1/changes`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The evidence feed is unavailable.");
        return response.json() as Promise<{ changes?: SourceChange[] }>;
      })
      .then((payload) => setChanges(payload.changes ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setChangeLoadError("The live evidence feed could not be reached.");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    setResources(null);
    void fetch(`${apiBaseUrl}/v1/resources?audience=${encodeURIComponent(profile.audience)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The official resource feed is unavailable.");
        return response.json() as Promise<{ resources?: OfficialResource[] }>;
      })
      .then((payload) => setResources(payload.resources ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResourceError("Official resources could not be loaded right now.");
      });
    return () => controller.abort();
  }, [profile.audience]);
  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/v1/source-candidates`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The source discovery queue is unavailable.");
        return response.json() as Promise<{ candidates?: SourceCandidate[] }>;
      })
      .then((payload) => setSourceCandidates(payload.candidates ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSourceCandidatesError("The source discovery queue could not be loaded right now.");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    setAgentFindings(null);
    void fetch(`${apiBaseUrl}/v1/agent-findings?audience=${encodeURIComponent(profile.audience)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The agent evidence feed is unavailable.");
        return response.json() as Promise<{ findings?: AgentFinding[] }>;
      })
      .then((payload) => setAgentFindings(payload.findings ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAgentFindingsError("Agent-selected evidence could not be loaded right now.");
      });
    return () => controller.abort();
  }, [profile.audience]);
  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/v1/status`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The source status feed is unavailable.");
        return response.json() as Promise<{ sources?: SourceHealth[] }>;
      })
      .then((payload) => setSourceHealth(payload.sources ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSourceHealthError("Live source health is temporarily unavailable.");
      });
    return () => controller.abort();
  }, []);

  const previewActions = useMemo<Action[]>(() => catalog?.actions[profile.audience] ?? [], [catalog, profile.audience]);
  const actions = liveActions ?? (apiBaseUrl ? [] : previewActions);
  const audience = audienceLabels[profile.audience];
  const freshSources = catalog?.snapshots.filter((item) => item.status === "ready").length ?? 0;
  const liveFreshSources = sourceHealth?.filter((source) => source.freshness === "fresh").length;
  const fallbackAnswer = useMemo(() => {
    if (!catalog || submittedQuestion.length < 3) return null;
    const chunks: DocumentChunk[] = catalog.opportunities.map((opportunity) => ({
      id: `chunk-${opportunity.id}`,
      documentVersionId: opportunity.documentVersionId,
      sourceId: opportunity.sourceId,
      ordinal: 0,
      text: `${opportunity.title}. ${opportunity.summary}`,
      tokenEstimate: 20
    }));
    const hits = new LocalEvidenceRetriever(chunks, new Map(catalog.sources.map((source) => [source.id, source]))).search(submittedQuestion, { audience: profile.audience, limit: 3 });
    return answerFromEvidence(submittedQuestion, hits);
  }, [catalog, profile.audience, submittedQuestion]);
  const answer = liveAnswer ?? fallbackAnswer;

  function switchAudience(next: Audience) {
    setProfile(demoProfiles[next]);
  }

  async function askOpenAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuestion = question.trim();
    setSubmittedQuestion(nextQuestion);
    setLiveAnswer(null);
    setAnswerError("");
    if (nextQuestion.length < 3 || !apiBaseUrl) return;
    setAnswerLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/v1/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: nextQuestion, audience: profile.audience }) });
      if (!response.ok) throw new Error("The live evidence service is unavailable.");
      const payload = await response.json() as ApiAnswer;
      if (typeof payload.answer !== "string" || !Array.isArray(payload.citations)) throw new Error("The live evidence service returned an invalid response.");
      setLiveAnswer(payload);
    } catch {
      setAnswerError("Live evidence is temporarily unavailable; showing the local source-backed preview instead.");
    } finally {
      setAnswerLoading(false);
    }
  }

  return <main>
    <nav className="topbar">
      <a className="brand" href="#top" aria-label="OpenAction home"><span className="brand-mark">OA</span> OpenAction <em>Network</em></a>
      <div className="status"><span className="pulse" /> {liveFreshSources ?? (freshSources || 3)} official sources fresh</div>
      <button className="profile-button" onClick={() => setShowProfile(true)}>Your profile <span>→</span></button>
    </nav>

    <section className="hero" id="top">
      <p className="eyebrow">INDIA’S OPEN ACTION ENGINE</p>
      <h1>Turn public information<br /><i>into your next move.</i></h1>
      <p className="hero-copy">OpenAction watches official sources and translates what changed into clear, source-backed actions for you.</p>
      <div className="proof"><span>⌁ Source-backed</span><span>◌ No black-box advice</span><span>↗ Built in the open</span></div>
    </section>

    <section className="audiences" aria-label="Choose your context">
      {(Object.keys(audienceLabels) as Audience[]).map((key) => <button key={key} onClick={() => switchAudience(key)} className={`audience-card ${profile.audience === key ? "selected" : ""}`}>
        <span className="audience-icon">{audienceLabels[key].icon}</span>
        <strong>{audienceLabels[key].title}</strong>
        <small>{audienceLabels[key].subtitle}</small>
        <span className="select-dot" />
      </button>)}
    </section>

    <section className="dashboard">
      <div className="section-heading">
        <div><p className="eyebrow">YOUR ACTION RADAR</p><h2>{audience.title}</h2><p>For <b>{profile.label}</b> · saved only in this browser</p></div>
        <button className="secondary" onClick={() => setShowProfile(true)}>Adjust profile</button>
      </div>
      <div className="notice"><span>i</span><p>OpenAction is informational. Always confirm eligibility, deadlines, and terms on the official source before acting.</p></div>
      <section className="source-health" aria-labelledby="source-health-title">
        <div className="source-health-heading"><div><p className="eyebrow">LIVE SOURCE HEALTH</p><h2 id="source-health-title">What the engine can verify right now.</h2></div><span>{sourceHealth ? `${sourceHealth.length} MONITORS` : "CONNECTING"}</span></div>
        {sourceHealth === null ? <div className="source-health-empty">{sourceHealthError || "Loading the Cloudflare ingestion record…"}</div> : <div className="source-health-list">{sourceHealth.map((source) => <article key={source.id} className="source-health-card"><div><span className={`health-dot ${source.freshness}`} /><b>{source.freshness === "unavailable" ? "Source unavailable" : source.freshness === "fresh" ? "Fresh evidence" : source.freshness}</b></div><h3>{source.name}</h3><p>{source.lastRun?.error || (source.lastRun?.checkedAt ? `Checked ${new Date(source.lastRun.checkedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "No collection run recorded yet.")}</p><div className="source-health-actions"><a href={source.canonicalUrl} target="_blank" rel="noreferrer">Official source ↗</a><button type="button" onClick={() => setReportSource(source)}>Report issue</button></div></article>)}</div>}
      </section>
      <section className="resource-shelf" aria-labelledby="resource-shelf-title">
        <div className="resource-shelf-heading"><div><p className="eyebrow">OFFICIAL RESOURCE SHELF</p><h2 id="resource-shelf-title">Explore verified public links.</h2><p>These are source-discovered official resources, not eligibility decisions or personalised recommendations.</p></div><span>{resources === null ? "LOADING" : `${resources.length} LINKS`}</span></div>
        {resources === null ? <div className="resource-empty">{resourceError || "Looking for official programme and service links…"}</div> : resources.length === 0 ? <div className="resource-empty">No relevant official links are available for this context yet.</div> : <div className="resource-list">{resources.slice(0, 8).map((resource) => <article key={resource.id} className="resource-card"><span>{resource.sourceName}</span><h3>{resource.title}</h3><p>Checked {new Date(resource.retrievedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p><a href={resource.canonicalUrl} target="_blank" rel="noreferrer">Open official resource</a></article>)}</div>}
      </section>
      <section className="agent-desk" aria-labelledby="agent-desk-title">
        <div className="agent-desk-heading"><div><p className="eyebrow">AI EVIDENCE DESK</p><h2 id="agent-desk-title">What the agents found in official material.</h2><p>Every displayed signal includes an exact excerpt from a collected source. These are discovery cues, never automatic eligibility decisions.</p></div><span>{agentFindings === null ? "ANALYSING" : `${agentFindings.length} AGENT REPORTS`}</span></div>
        {agentFindings === null ? <div className="agent-desk-empty">{agentFindingsError || "Checking the latest source-grounded agent reportsâ€¦"}</div> : agentFindings.length === 0 ? <div className="agent-desk-empty">No validated AI evidence signals are available for this context yet.</div> : <div className="agent-report-list">{agentFindings.slice(0, 6).map((finding) => <article key={finding.id} className="agent-report"><div><span>{finding.agentId.replaceAll("-", " ")}</span><a href={finding.canonicalUrl} target="_blank" rel="noreferrer">{finding.sourceName} â†—</a></div>{finding.signals.slice(0, 3).map((signal) => <section key={`${finding.id}-${signal.evidence}`}><h3>{signal.title}</h3><blockquote>â€œ{signal.evidence}â€</blockquote></section>)}<small>Analysed {new Date(finding.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></article>)}</div>}
      </section>
      <section className="source-frontier" aria-labelledby="source-frontier-title">
        <div className="source-frontier-heading"><div><p className="eyebrow">SOURCE FRONTIER</p><h2 id="source-frontier-title">New official-source leads, held for review.</h2><p>The scout finds public-domain candidates from trusted sources. Nothing is automatically scraped or published from this queue.</p></div><span>{sourceCandidates === null ? "SCOUTING" : `${sourceCandidates.length} LEADS`}</span></div>
        {sourceCandidates === null ? <div className="source-frontier-empty">{sourceCandidatesError || "Loading the source-scout review queueâ€¦"}</div> : sourceCandidates.length === 0 ? <div className="source-frontier-empty">No new source candidates are waiting for review.</div> : <div className="source-frontier-list">{sourceCandidates.slice(0, 8).map((candidate) => <article key={candidate.id} className="source-candidate"><div><span>{candidate.score}/100 RELEVANCE</span><small>Found by {candidate.agentId.replaceAll("-", " ")}</small></div><h3>{candidate.name}</h3><p>{candidate.host}</p><a href={candidate.canonicalUrl} target="_blank" rel="noreferrer">Inspect candidate source â†—</a><small className="candidate-review">Awaiting authority, terms, and access review</small></article>)}</div>}
      </section>
      <section className="live-action-radar" aria-labelledby="live-action-radar-title">
        <div className="live-action-heading"><div><p className="eyebrow">LIVE ACTION RADAR</p><h2 id="live-action-radar-title">Official leads for your selected context.</h2><p>These cards are created from official links already found by monitored sources. They are leads, never eligibility decisions.</p></div><span>{liveActions === null ? (apiBaseUrl ? "SYNCING" : "LOCAL PREVIEW") : `${liveActions.length} LIVE LEADS`}</span></div>
        {liveActions === null && apiBaseUrl ? <div className="live-action-empty">{liveActionsError || "Loading source-backed action leads…"}</div> : <div className="action-grid">{actions.length ? actions.map((action) => <ActionCard key={action.id} action={action} />) : <div className="empty"><h3>No verified action leads yet</h3><p>More official resources will appear as the monitored sources are collected and reviewed.</p></div>}</div>}
      </section>
      <section className="ask-panel" aria-labelledby="ask-title">
        <div><p className="eyebrow">ASK OPENACTION</p><h2 id="ask-title">Explore the evidence.</h2><p>Ask a question in plain English. Answers stay tied to retrieved official source material.</p></div>
        <form onSubmit={askOpenAction}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What support may be relevant to my startup?" aria-label="Ask OpenAction" />
          <button className="primary" type="submit" disabled={answerLoading}>{answerLoading ? "Searching…" : "Ask →"}</button>
        </form>
        {answer && <div className="answer"><span className="fallback-label">{liveAnswer?.retrievalMode === "vectorize-semantic" ? "LIVE VECTORIZE EVIDENCE" : "LOCAL EVIDENCE FALLBACK"}</span><p>{answer.answer}</p>{answer.citations.length > 0 && <div className="answer-sources">{answer.citations.map((hit) => <a key={hit.chunk.id} href={hit.source.canonicalUrl} target="_blank" rel="noreferrer">{hit.source.publisher} ↗</a>)}</div>}{answerError && <small>{answerError}</small>}<small>{answer.limitation}</small></div>}
      </section>
      <section className="change-panel" aria-labelledby="changes-title">
        <div className="change-heading"><div><p className="eyebrow">SOURCE CHANGE LEDGER</p><h2 id="changes-title">What changed, exactly?</h2><p>High-impact changes are held for review before they can influence actions.</p></div><span className="ledger-state">{changes === null ? "CONNECTING WHEN API IS SET" : `${changes.length} RECENT CHANGES`}</span></div>
        {changes === null ? <div className="change-empty"><b>Live change feed ready</b><p>{changeLoadError || "The dashboard will show verified changes when its Cloudflare Worker API address is configured."}</p></div> : changes.length === 0 ? <div className="change-empty"><b>No publishable source changes yet</b><p>OpenAction retains snapshots and compares new official material against the prior version.</p></div> : <div className="change-list">{changes.slice(0, 5).map((change) => <article key={change.id} className="change-card"><div><span className={`impact ${change.impact}`}>{change.impact === "review_required" ? "Review required" : "Informational"}</span><time>{new Date(change.detectedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</time></div><h3>{change.sourceName}</h3><p>{change.reasons.join(" · ") || "Official source wording changed."}</p>{change.addedSentences[0] && <blockquote>“{change.addedSentences[0]}”</blockquote>}<a href={change.sourceUrl} target="_blank" rel="noreferrer">View official source →</a></article>)}</div>}
      </section>
    </section>

    <section className="how-it-works">
      <div><p className="eyebrow">EVIDENCE, NOT GUESSWORK</p><h2>Every card has a trail.</h2></div>
      <ol><li><b>01</b><span>We collect permitted public information and retain its source snapshot.</span></li><li><b>02</b><span>Rules compare the official criteria with your local profile.</span></li><li><b>03</b><span>You see why it may apply, when it was checked, and the original source.</span></li></ol>
    </section>

    <footer><span>OpenAction Network · English-first India demo</span><span>Built for verifiable public intelligence</span></footer>
    {showProfile && <ProfileModal profile={profile} onClose={() => setShowProfile(false)} onSave={(next) => { setProfile(next); setShowProfile(false); }} />}
    {reportSource && <ReportModal source={reportSource} onClose={() => setReportSource(null)} />}
  </main>;
}

function ReportModal({ source, onClose }: { source: SourceHealth; onClose(): void }) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiBaseUrl || message.trim().length < 10) return;
    setSending(true);
    setStatus("");
    try {
      const response = await fetch(`${apiBaseUrl}/v1/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "source_issue", sourceId: source.id, message: message.trim() }) });
      const payload = await response.json() as { notice?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not send your report.");
      setStatus(payload.notice ?? "Report submitted for review.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not send your report.");
    } finally {
      setSending(false);
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="close" onClick={onClose} aria-label="Close">×</button><p className="eyebrow">EVIDENCE QUALITY REPORT</p><h2 id="report-title">Report an issue</h2><p className="modal-copy">Tell us what seems stale, incorrect, or inaccessible for <b>{source.name}</b>. Do not include personal information.</p>
    <form onSubmit={submit}><label>What should we review?<textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} maxLength={1000} placeholder="For example: the official link no longer opens…" required /></label><div className="modal-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={sending || message.trim().length < 10}>{sending ? "Sending…" : "Send report"}</button></div></form>{status && <p className="report-status">{status}</p>}
  </section></div>;
}

function ActionCard({ action }: { action: Action }) {
  return <article className="action-card">
    <div className="card-meta"><span className={`freshness ${action.freshness}`}>{action.freshness === "fresh" ? "Fresh source" : "Check freshness"}</span><time>Checked {new Date(action.retrievedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</time></div>
    <h3>{action.title}</h3><p>{action.explanation}</p>
    <div className="source"><span>Official source</span><a href={action.source.canonicalUrl} target="_blank" rel="noreferrer">{action.source.publisher} ↗</a></div>
    <a className="action-link" href={action.actionUrl} target="_blank" rel="noreferrer">{action.actionLabel} <span>→</span></a>
  </article>;
}

function ProfileModal({ profile, onClose, onSave }: { profile: Profile; onClose(): void; onSave(next: Profile): void }) {
  const [draft, setDraft] = useState(profile);
  const entries = Object.entries(draft.facts);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="close" onClick={onClose} aria-label="Close">×</button><p className="eyebrow">LOCAL-ONLY PROFILE</p><h2 id="profile-title">Tune your action radar</h2><p className="modal-copy">Your profile stays in this browser in this demo.</p>
    <label>Profile label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
    {entries.map(([key, value]) => <label key={key}>{key.replaceAll("_", " ")}<input value={String(value)} onChange={(event) => setDraft({ ...draft, facts: { ...draft.facts, [key]: typeof value === "boolean" ? event.target.value === "true" : event.target.value } })} /></label>)}
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={() => onSave(draft)}>Save local profile</button></div>
  </section></div>;
}

import { agentMeshRoster, createOfficialPageCollector, EvidenceStore, officialSourceRegistry } from "@openaction/core";
import { createEvidenceFinding, type AgentReasoningBinding } from "./agents";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createIngestJob, runId, type IngestJob } from "./ingestion";
import { createPendingReviews, detectPersistedChanges, ensureSource, hasAgentFindingForContent, persistAgentFinding, persistIngest, updateIngestionRun, type EvidenceBindings } from "./persistence";
import { indexEvidenceDocuments, type RagBindings } from "./vectorize";

export interface IngestionEnv extends EvidenceBindings, RagBindings {
  AGENT_REASONING_MODEL?: string;
}

export class OpenActionIngestWorkflow extends WorkflowEntrypoint<IngestionEnv, IngestJob> {
  async run(event: Readonly<WorkflowEvent<IngestJob>>, step: WorkflowStep): Promise<{ runId: string; status: "completed" | "partial_failed" }> {
    const job = event.payload;
    const source = officialSourceRegistry.find((candidate) => candidate.id === job.sourceId);
    if (!source) throw new Error(`Unknown source: ${job.sourceId}`);
    const id = runId(job);
    await ensureSource(this.env, source, job.requestedAt);
    await step.do("mark run started", async () => {
      await updateIngestionRun(this.env, { id, sourceId: source.id, requestedAt: job.requestedAt, startedAt: new Date().toISOString(), status: "running", stage: "collect" });
      return { id };
    });
    const collected = await step.do("collect official evidence", async () => {
      const store = new EvidenceStore();
      return store.ingest(createOfficialPageCollector(source));
    });
    const result = await step.do("detect persisted source changes", async () => {
      const persistedChanges = await detectPersistedChanges(this.env, collected.documents, collected.snapshot.retrievedAt);
      return { ...collected, changes: [...collected.changes, ...persistedChanges] };
    });
    await step.do("persist source snapshot", async () => {
      await updateIngestionRun(this.env, { id, sourceId: source.id, requestedAt: job.requestedAt, status: "running", stage: "persist", documentCount: result.documents.length, changeCount: result.changes.length });
      await persistIngest(this.env, source, result);
      await createPendingReviews(this.env, result.changes);
      return { persisted: true };
    });
    if (result.snapshot.status === "failed") {
      await step.do("record collection failure", async () => {
        await updateIngestionRun(this.env, { id, sourceId: source.id, requestedAt: job.requestedAt, completedAt: new Date().toISOString(), status: "partial_failed", stage: "complete", error: result.snapshot.error });
        return { recorded: true };
      });
      return { runId: id, status: "partial_failed" };
    }
    await step.do("extract source-grounded agent signals", async () => {
      const agent = job.agentId
        ? agentMeshRoster.find((candidate) => candidate.id === job.agentId)
        : agentMeshRoster.find((candidate) => candidate.approvedSourceIds.includes(source.id));
      if (!agent || await hasAgentFindingForContent(this.env, source.id, result.snapshot.contentHash)) return { created: false, reason: "not-needed" };
      const finding = await createEvidenceFinding({
        AI: this.env.AI as unknown as AgentReasoningBinding | undefined,
        AGENT_REASONING_MODEL: this.env.AGENT_REASONING_MODEL
      }, agent, source, result.documents, result.snapshot.contentHash);
      if (!finding) return { created: false, reason: "no-validated-model-output" };
      await persistAgentFinding(this.env, finding);
      return { created: true, signalCount: finding.signals.length };
    });
    const indexed = await step.do("index evidence chunks", async () => {
      await updateIngestionRun(this.env, { id, sourceId: source.id, requestedAt: job.requestedAt, status: "running", stage: "index" });
      return indexEvidenceDocuments(this.env, result.documents);
    });
    await step.do("complete ingestion run", async () => {
      await updateIngestionRun(this.env, { id, sourceId: source.id, requestedAt: job.requestedAt, completedAt: new Date().toISOString(), status: "completed", stage: "complete", documentCount: result.documents.length, indexedCount: indexed.indexed, changeCount: result.changes.length });
      return { completed: true };
    });
    return { runId: id, status: "completed" };
  }
}

export function scheduledJobs(now = new Date()): IngestJob[] {
  return officialSourceRegistry.map((source) => createIngestJob(source, "scheduled", now));
}

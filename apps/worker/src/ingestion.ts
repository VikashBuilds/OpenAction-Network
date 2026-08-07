import type { Source } from "@openaction/core";

export type IngestReason = "scheduled" | "manual" | "queue_retry" | "github_actions";

export interface IngestJob {
  sourceId: string;
  requestedAt: string;
  reason: IngestReason;
  agentId?: string;
}

export interface IngestionRun {
  id: string;
  sourceId: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  status: "queued" | "running" | "completed" | "partial_failed" | "failed";
  stage: "queued" | "collect" | "persist" | "index" | "complete";
  error?: string;
  documentCount?: number;
  indexedCount?: number;
  changeCount?: number;
}

export function createIngestJob(source: Source, reason: IngestReason, now = new Date(), agentId?: string): IngestJob {
  return { sourceId: source.id, requestedAt: now.toISOString(), reason, agentId };
}

export function runId(job: IngestJob): string {
  return `run-${job.sourceId}-${job.requestedAt.replace(/[^0-9]/g, "")}`;
}

export type Audience = "business" | "student" | "citizen";

export type FactValue = string | number | boolean;

export interface Source {
  id: string;
  name: string;
  publisher: string;
  canonicalUrl: string;
  audience: Audience[];
  refreshHours: number;
}

export interface Snapshot {
  id: string;
  sourceId: string;
  retrievedAt: string;
  contentHash: string;
  storageKey: string;
  status: "ready" | "failed";
  error?: string;
}

export interface DocumentVersion {
  id: string;
  sourceId: string;
  snapshotId: string;
  externalId: string;
  title: string;
  body: string;
  canonicalUrl: string;
  publishedAt?: string;
  effectiveFrom?: string;
  versionHash: string;
}

export interface DocumentChange {
  id: string;
  sourceId: string;
  externalId: string;
  previousDocumentVersionId: string;
  currentDocumentVersionId: string;
  detectedAt: string;
  status: "content_changed";
  impact: "informational" | "review_required";
  reasons: string[];
  addedSentences: string[];
  removedSentences: string[];
}

export interface DocumentChunk {
  id: string;
  documentVersionId: string;
  sourceId: string;
  ordinal: number;
  text: string;
  tokenEstimate: number;
}

export interface RetrievalHit {
  chunk: DocumentChunk;
  score: number;
  source: Pick<Source, "id" | "name" | "publisher" | "canonicalUrl">;
}

export interface EvidenceVector {
  id: string;
  values: number[];
  metadata: {
    sourceId: string;
    documentVersionId: string;
    ordinal: number;
    language: string;
    status: "current";
  };
}

export interface GroundedAnswer {
  answer: string;
  citations: RetrievalHit[];
  limitation?: string;
}

export interface Requirement {
  field: string;
  operator: "equals" | "in" | "gte" | "lte" | "truthy";
  value?: FactValue | FactValue[];
  label: string;
}

export interface Opportunity {
  id: string;
  sourceId: string;
  documentVersionId: string;
  audience: Audience;
  kind: "scheme" | "tender" | "deadline" | "scholarship" | "service";
  title: string;
  summary: string;
  actionLabel: string;
  actionUrl: string;
  deadline?: string;
  requirements: Requirement[];
}

export interface Profile {
  id: string;
  audience: Audience;
  label: string;
  facts: Record<string, FactValue>;
}

export interface Match {
  id: string;
  opportunityId: string;
  profileId: string;
  matchedAt: string;
  status: "eligible" | "possibly_eligible" | "not_eligible";
  applicableFacts: string[];
  missingFacts: string[];
}

export interface Action {
  id: string;
  opportunityId: string;
  matchId: string;
  title: string;
  explanation: string;
  actionLabel: string;
  actionUrl: string;
  source: Pick<Source, "name" | "publisher" | "canonicalUrl">;
  retrievedAt: string;
  freshness: "fresh" | "stale" | "unknown";
  deadline?: string;
}

export interface IngestResult {
  snapshot: Snapshot;
  documents: DocumentVersion[];
  changes: DocumentChange[];
  inserted: number;
  unchanged: number;
}

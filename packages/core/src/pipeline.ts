import type { DocumentChange, DocumentVersion, IngestResult, Opportunity, Profile, Requirement, Snapshot, Source } from "./types";
import { compareDocumentVersions } from "./changes";
import { validateOpportunity, validateSource } from "./validation";

export interface CollectedDocument {
  externalId: string;
  title: string;
  body: string;
  canonicalUrl: string;
  publishedAt?: string;
  effectiveFrom?: string;
}

export interface Collector {
  source: Source;
  collect(): Promise<CollectedDocument[]>;
}

const hash = (input: string): string => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) value = Math.imul(value ^ input.charCodeAt(index), 16777619);
  return `h${(value >>> 0).toString(36)}`;
};

export class EvidenceStore {
  readonly snapshots = new Map<string, Snapshot>();
  readonly documents = new Map<string, DocumentVersion>();
  readonly changes: DocumentChange[] = [];
  readonly opportunities = new Map<string, Opportunity>();
  private documentHashes = new Map<string, string>();
  private latestDocuments = new Map<string, DocumentVersion>();

  async ingest(collector: Collector, now = new Date()): Promise<IngestResult> {
    const source = validateSource(collector.source);
    const retrievedAt = now.toISOString();
    let collected: CollectedDocument[];
    try {
      collected = await collector.collect();
    } catch (error) {
      const snapshot: Snapshot = {
        id: `snapshot-${source.id}-${now.getTime()}`,
        sourceId: source.id,
        retrievedAt,
        contentHash: "",
        storageKey: `sources/${source.id}/${now.toISOString()}.json`,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown collector failure"
      };
      this.snapshots.set(snapshot.id, snapshot);
      return { snapshot, documents: [], changes: [], inserted: 0, unchanged: 0 };
    }

    const contentHash = hash(JSON.stringify(collected));
    const snapshot: Snapshot = {
      id: `snapshot-${source.id}-${now.getTime()}`,
      sourceId: source.id,
      retrievedAt,
      contentHash,
      storageKey: `sources/${source.id}/${now.toISOString()}.json`,
      status: "ready"
    };
    this.snapshots.set(snapshot.id, snapshot);
    let inserted = 0;
    let unchanged = 0;
    const changes: DocumentChange[] = [];
    const documents = collected.map((item) => {
      const versionHash = hash(JSON.stringify(item));
      const key = `${source.id}:${item.externalId}`;
      if (this.documentHashes.get(key) === versionHash) {
        unchanged += 1;
      } else {
        inserted += 1;
        this.documentHashes.set(key, versionHash);
      }
      const document: DocumentVersion = {
        id: `document-${source.id}-${item.externalId}-${versionHash}`,
        sourceId: source.id,
        snapshotId: snapshot.id,
        ...item,
        canonicalUrl: new URL(item.canonicalUrl).toString(),
        versionHash
      };
      const previous = this.latestDocuments.get(key);
      if (previous && previous.versionHash !== document.versionHash) {
        const change = compareDocumentVersions(previous, document, retrievedAt);
        if (change) {
          changes.push(change);
          this.changes.push(change);
        }
      }
      this.documents.set(document.id, document);
      this.latestDocuments.set(key, document);
      return document;
    });
    return { snapshot, documents, changes, inserted, unchanged };
  }

  addOpportunity(opportunity: Opportunity): Opportunity {
    const valid = validateOpportunity(opportunity);
    if (!this.documents.has(valid.documentVersionId)) throw new Error("Opportunity must reference an ingested document version");
    const duplicate = [...this.opportunities.values()].find((item) => item.documentVersionId === valid.documentVersionId && item.title === valid.title);
    if (duplicate) return duplicate;
    this.opportunities.set(valid.id, valid);
    return valid;
  }
}

function evaluateRequirement(requirement: Requirement, facts: Profile["facts"]): "matched" | "missing" | "not_matched" {
  const actual = facts[requirement.field];
  if (actual === undefined) return "missing";
  if (requirement.operator === "truthy") return actual ? "matched" : "not_matched";
  if (requirement.operator === "equals") return actual === requirement.value ? "matched" : "not_matched";
  if (requirement.operator === "in") return Array.isArray(requirement.value) && requirement.value.includes(actual) ? "matched" : "not_matched";
  if (typeof actual !== "number" || typeof requirement.value !== "number") return "not_matched";
  if (requirement.operator === "gte") return actual >= requirement.value ? "matched" : "not_matched";
  return actual <= requirement.value ? "matched" : "not_matched";
}

export function matchOpportunity(opportunity: Opportunity, profile: Profile): { status: "eligible" | "possibly_eligible" | "not_eligible"; applicableFacts: string[]; missingFacts: string[] } {
  if (opportunity.audience !== profile.audience) return { status: "not_eligible", applicableFacts: [], missingFacts: [] };
  const applicableFacts: string[] = [];
  const missingFacts: string[] = [];
  let failure = false;
  for (const requirement of opportunity.requirements) {
    const result = evaluateRequirement(requirement, profile.facts);
    if (result === "matched") applicableFacts.push(requirement.label);
    if (result === "missing") missingFacts.push(requirement.label);
    if (result === "not_matched") failure = true;
  }
  return { status: failure ? "not_eligible" : missingFacts.length ? "possibly_eligible" : "eligible", applicableFacts, missingFacts };
}

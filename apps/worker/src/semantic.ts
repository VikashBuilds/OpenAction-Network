import { chunkDocument, type DocumentVersion, type RetrievalHit, type Source } from "@openaction/core";
import type { EvidenceBindings } from "./persistence";
import { semanticVectorSearch, type RagBindings } from "./vectorize";

interface StoredDocumentRow {
  id: string;
  source_id: string;
  snapshot_id: string;
  external_id: string;
  title: string;
  body: string;
  canonical_url: string;
  version_hash: string;
  source_name: string;
  publisher: string;
  source_url: string;
  audience_json: string;
  refresh_hours: number;
}

export async function retrieveSemanticEvidence(bindings: EvidenceBindings & RagBindings, query: string, audience?: string, limit = 5): Promise<RetrievalHit[] | null> {
  if (!bindings.DB) return null;
  try {
    const vectorMatches = await semanticVectorSearch(bindings, query, limit * 2);
    if (vectorMatches === null) return null;
    const hits: RetrievalHit[] = [];
    for (const match of vectorMatches) {
      const documentVersionId = typeof match.metadata.documentVersionId === "string" ? match.metadata.documentVersionId : null;
      const ordinal = typeof match.metadata.ordinal === "number" ? match.metadata.ordinal : null;
      if (!documentVersionId || ordinal === null) continue;
      const row = await bindings.DB.prepare("SELECT d.id, d.source_id, d.snapshot_id, d.external_id, d.title, d.body, d.canonical_url, d.version_hash, s.name AS source_name, s.publisher, s.canonical_url AS source_url, s.audience_json, s.refresh_hours FROM document_versions d JOIN sources s ON s.id = d.source_id WHERE d.id = ?").bind(documentVersionId).first<StoredDocumentRow>();
      if (!row) continue;
      const source: Source = { id: row.source_id, name: row.source_name, publisher: row.publisher, canonicalUrl: row.source_url, audience: JSON.parse(row.audience_json), refreshHours: row.refresh_hours };
      if (audience && !source.audience.includes(audience as Source["audience"][number])) continue;
      const document: DocumentVersion = { id: row.id, sourceId: row.source_id, snapshotId: row.snapshot_id, externalId: row.external_id, title: row.title, body: row.body, canonicalUrl: row.canonical_url, versionHash: row.version_hash };
      const chunk = chunkDocument(document)[ordinal];
      if (chunk) hits.push({ chunk, score: match.score, source: { id: source.id, name: source.name, publisher: source.publisher, canonicalUrl: source.canonicalUrl } });
      if (hits.length === limit) break;
    }
    return hits;
  } catch (error) {
    console.log("Semantic retrieval unavailable; using local fallback", error);
    return null;
  }
}

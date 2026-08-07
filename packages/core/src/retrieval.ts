import type { DocumentChunk, DocumentVersion, EvidenceVector, GroundedAnswer, RetrievalHit, Source } from "./types";

const words = (value: string) => value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

// Vectorize limits record IDs to 64 bytes. Keep the human-readable chunk ID in
// the application model, but use a compact deterministic ID for the index.
const vectorHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
};

const vectorRecordId = (chunk: DocumentChunk): string => `vec-${vectorHash(chunk.documentVersionId)}-${vectorHash(chunk.text)}-${chunk.ordinal}`;

export function chunkDocument(document: DocumentVersion, maxCharacters = 1_200): DocumentChunk[] {
  const paragraphs = document.body.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > maxCharacters) {
      chunks.push(current);
      current = paragraph;
    } else current = `${current}${current ? " " : ""}${paragraph}`;
  }
  if (current) chunks.push(current);
  return chunks.map((text, ordinal) => ({
    id: `chunk-${document.id}-${ordinal}`,
    documentVersionId: document.id,
    sourceId: document.sourceId,
    ordinal,
    text,
    tokenEstimate: Math.ceil(text.length / 4)
  }));
}

export class LocalEvidenceRetriever {
  constructor(private readonly chunks: DocumentChunk[], private readonly sources: Map<string, Source>) {}

  search(query: string, options: { audience?: string; limit?: number } = {}): RetrievalHit[] {
    const queryWords = new Set(words(query));
    if (queryWords.size === 0) return [];
    return this.chunks
      .map((chunk) => {
        const source = this.sources.get(chunk.sourceId);
        if (!source || (options.audience && !source.audience.includes(options.audience as Source["audience"][number]))) return null;
        const chunkWords = new Set(words(chunk.text));
        const matched = [...queryWords].filter((word) => chunkWords.has(word)).length;
        return matched === 0 ? null : { chunk, score: matched / queryWords.size, source: { id: source.id, name: source.name, publisher: source.publisher, canonicalUrl: source.canonicalUrl } };
      })
      .filter((item): item is RetrievalHit => item !== null)
      .sort((a, b) => b.score - a.score || a.chunk.ordinal - b.chunk.ordinal)
      .slice(0, options.limit ?? 5);
  }
}

export function answerFromEvidence(query: string, hits: RetrievalHit[]): GroundedAnswer {
  if (hits.length === 0) return {
    answer: `I could not find enough verified evidence to answer “${query}” yet. Try the official sources directly or broaden your question.`,
    citations: [],
    limitation: "No matching evidence was retrieved."
  };
  const evidence = hits.slice(0, 2).map((hit) => excerpt(hit.chunk.text)).join(" ");
  return {
    answer: `The available official material most relevant to “${query}” says: ${evidence}`,
    citations: hits,
    limitation: "This is a retrieval summary, not an eligibility decision. Confirm the official source before acting."
  };
}

function excerpt(text: string, maximumLength = 360): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximumLength) return normalized;
  const boundary = normalized.lastIndexOf(" ", maximumLength);
  return `${normalized.slice(0, boundary > 0 ? boundary : maximumLength)}…`;
}

export function toEvidenceVectors(chunks: DocumentChunk[], embeddings: number[][], language = "en"): EvidenceVector[] {
  if (chunks.length !== embeddings.length) throw new Error("Every chunk must have exactly one embedding");
  return chunks.map((chunk, index) => {
    const values = embeddings[index];
    if (!values || values.length === 0 || values.some((value) => !Number.isFinite(value))) throw new Error("Embedding values must be finite numbers");
    return { id: vectorRecordId(chunk), values, metadata: { sourceId: chunk.sourceId, documentVersionId: chunk.documentVersionId, ordinal: chunk.ordinal, language, status: "current" } };
  });
}

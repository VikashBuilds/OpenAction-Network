import { chunkDocument, toEvidenceVectors, type DocumentVersion, type EvidenceVector } from "@openaction/core";

export interface EmbeddingBinding {
  run(model: string, input: { text: string[] }, options?: { gateway?: { id: string; cacheTtl?: number; skipCache?: boolean } }): Promise<{ data: number[][] }>;
}

export interface VectorIndexBinding {
  upsert(vectors: EvidenceVector[]): Promise<void>;
  query(values: number[], options: { topK: number; filter: Record<string, string>; returnMetadata: "all" }): Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;
}

export interface RagBindings {
  AI?: EmbeddingBinding;
  VECTOR_INDEX?: VectorIndexBinding;
  AI_GATEWAY_ID?: string;
  EMBEDDING_MODEL?: string;
}

export async function indexEvidenceDocuments(bindings: RagBindings, documents: DocumentVersion[]): Promise<{ indexed: number; skipped: boolean }> {
  if (!bindings.AI || !bindings.VECTOR_INDEX) return { indexed: 0, skipped: true };
  const chunks = documents.flatMap((document) => chunkDocument(document));
  if (chunks.length === 0) return { indexed: 0, skipped: false };
  const embedding = await bindings.AI.run(bindings.EMBEDDING_MODEL ?? "@cf/baai/bge-base-en-v1.5", { text: chunks.map((chunk) => chunk.text) }, bindings.AI_GATEWAY_ID ? { gateway: { id: bindings.AI_GATEWAY_ID, cacheTtl: 86_400 } } : undefined);
  const vectors = toEvidenceVectors(chunks, embedding.data);
  await bindings.VECTOR_INDEX.upsert(vectors);
  return { indexed: vectors.length, skipped: false };
}

export async function semanticVectorSearch(bindings: RagBindings, query: string, limit = 5): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }> | null> {
  if (!bindings.AI || !bindings.VECTOR_INDEX) return null;
  const embedding = await bindings.AI.run(bindings.EMBEDDING_MODEL ?? "@cf/baai/bge-base-en-v1.5", { text: [query] }, bindings.AI_GATEWAY_ID ? { gateway: { id: bindings.AI_GATEWAY_ID, cacheTtl: 3_600 } } : undefined);
  const queryVector = embedding.data[0];
  if (!queryVector) throw new Error("Embedding provider returned no query vector");
  const result = await bindings.VECTOR_INDEX.query(queryVector, { topK: limit, filter: { language: "en", status: "current" }, returnMetadata: "all" });
  return result.matches.flatMap((match) => match.metadata ? [{ id: match.id, score: match.score, metadata: match.metadata }] : []);
}

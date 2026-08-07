import type { DocumentChange, DocumentVersion } from "./types";

const reviewPatterns: Array<[RegExp, string]> = [
  [/\b(deadline|last date|due date|apply by)\b/i, "deadline language changed"],
  [/\b(eligible|eligibility|criteria|qualification)\b/i, "eligibility language changed"],
  [/\b(required|mandatory|must|shall|document)\b/i, "requirement language changed"],
  [/\b(amount|funding|grant|benefit|fee)\b/i, "financial language changed"]
];

function sentences(body: string): string[] {
  return body.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
}

function comparable(sentence: string): string {
  return sentence.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function compareDocumentVersions(previous: DocumentVersion, current: DocumentVersion, detectedAt = new Date().toISOString()): DocumentChange | null {
  if (previous.sourceId !== current.sourceId || previous.externalId !== current.externalId) throw new Error("Only versions of the same source document can be compared");
  if (previous.versionHash === current.versionHash) return null;
  const previousSentences = sentences(previous.body);
  const currentSentences = sentences(current.body);
  const previousSet = new Set(previousSentences.map(comparable));
  const currentSet = new Set(currentSentences.map(comparable));
  const addedSentences = currentSentences.filter((sentence) => !previousSet.has(comparable(sentence)));
  const removedSentences = previousSentences.filter((sentence) => !currentSet.has(comparable(sentence)));
  const changedText = [...addedSentences, ...removedSentences].join(" ");
  const reasons = reviewPatterns.filter(([pattern]) => pattern.test(changedText)).map(([, reason]) => reason);
  return {
    id: `change-${previous.id}-${current.id}`,
    sourceId: current.sourceId,
    externalId: current.externalId,
    previousDocumentVersionId: previous.id,
    currentDocumentVersionId: current.id,
    detectedAt,
    status: "content_changed",
    impact: reasons.length > 0 ? "review_required" : "informational",
    reasons,
    addedSentences,
    removedSentences
  };
}

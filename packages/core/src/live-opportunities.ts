import type { DocumentVersion, Opportunity, Source } from "./types";

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `resource-lead-${(hash >>> 0).toString(36)}`;
}

function inferKind(title: string): Opportunity["kind"] {
  if (/\b(scholarship|fellowship)\b/i.test(title)) return "scholarship";
  if (/\b(tender|procurement)\b/i.test(title)) return "tender";
  if (/\b(deadline|last date|notification)\b/i.test(title)) return "deadline";
  if (/\b(service|career|job|skill)\b/i.test(title)) return "service";
  return "scheme";
}

/**
 * Produces cautious, source-backed leads from resource links that an allow-listed
 * collector has already discovered. It deliberately makes no eligibility claim.
 */
export function buildResourceLeadOpportunities(source: Source, documents: DocumentVersion[]): Opportunity[] {
  return documents
    .filter((document) => document.externalId.startsWith("resource:"))
    .flatMap((document) => source.audience.map((audience) => ({
      id: stableId(`${source.id}:${audience}:${document.externalId}`),
      sourceId: source.id,
      documentVersionId: document.id,
      audience,
      kind: inferKind(document.title),
      title: document.title,
      summary: `${source.name} lists this official resource. Open the source to confirm its current purpose, eligibility criteria, application requirements, and any deadline.`,
      actionLabel: "Open official resource",
      actionUrl: document.canonicalUrl,
      requirements: [{
        field: "official_criteria_confirmed",
        operator: "truthy" as const,
        label: "you confirm the official criteria on the linked page"
      }]
    })));
}

import type { Opportunity, Source } from "./types";

export function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("Source URLs must use HTTPS");
  url.hash = "";
  return url.toString();
}

export function validateSource(source: Source): Source {
  if (!source.id || !source.name || !source.publisher) throw new Error("Source requires id, name, and publisher");
  if (source.audience.length === 0) throw new Error("Source must serve an audience");
  if (!Number.isInteger(source.refreshHours) || source.refreshHours < 1) throw new Error("refreshHours must be a positive integer");
  return { ...source, canonicalUrl: normalizeUrl(source.canonicalUrl) };
}

export function validateOpportunity(opportunity: Opportunity): Opportunity {
  if (!opportunity.id || !opportunity.documentVersionId || !opportunity.title) throw new Error("Opportunity identity is incomplete");
  if (!opportunity.actionUrl || !opportunity.summary) throw new Error("Opportunity requires an action and summary");
  normalizeUrl(opportunity.actionUrl);
  for (const requirement of opportunity.requirements) {
    if (!requirement.field || !requirement.label) throw new Error("Requirements must explain the required fact");
    if (requirement.operator !== "truthy" && requirement.value === undefined) throw new Error("Requirement value is missing");
  }
  return opportunity;
}

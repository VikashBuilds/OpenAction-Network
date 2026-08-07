import type { Action, Opportunity, Profile, Source } from "./types";
import { matchOpportunity } from "./pipeline";

export function createActions(opportunities: Opportunity[], profile: Profile, sources: Map<string, Source>, retrievedAt: string, now = new Date()): Action[] {
  return opportunities.flatMap((opportunity) => {
    const match = matchOpportunity(opportunity, profile);
    if (match.status === "not_eligible") return [];
    const source = sources.get(opportunity.sourceId);
    if (!source) return [];
    const age = now.getTime() - new Date(retrievedAt).getTime();
    const freshness = Number.isNaN(age) ? "unknown" : age <= source.refreshHours * 3_600_000 ? "fresh" : "stale";
    const explanation = match.applicableFacts.length > 0
      ? `This may apply because your profile matches: ${match.applicableFacts.join(", ")}.`
      : `Check the official criteria to confirm whether this applies to you.`;
    return [{
      id: `action-${profile.id}-${opportunity.id}`,
      opportunityId: opportunity.id,
      matchId: `match-${profile.id}-${opportunity.id}`,
      title: opportunity.title,
      explanation: match.missingFacts.length ? `${explanation} Confirm: ${match.missingFacts.join(", ")}.` : explanation,
      actionLabel: opportunity.actionLabel,
      actionUrl: opportunity.actionUrl,
      source: { name: source.name, publisher: source.publisher, canonicalUrl: source.canonicalUrl },
      retrievedAt,
      freshness,
      deadline: opportunity.deadline
    }];
  });
}

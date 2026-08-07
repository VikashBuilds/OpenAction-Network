import type { Audience, Source } from "./types";

export type AgentCapability = "discover" | "verify" | "extract" | "detect_change" | "deduplicate" | "quality_review";
export type CandidateDecision = "rejected" | "needs_human_review";
export type AccessStatus = "allowed" | "unknown" | "blocked";

export interface AgentDefinition {
  id: string;
  name: string;
  lane: string;
  capabilities: AgentCapability[];
  audience: Audience[];
  approvedSourceIds: string[];
  cadence: "every_4_hours" | "daily" | "weekly" | "on_change";
  publishAuthority: false;
}

/** A strict, evidence-bearing handoff from an AI scout to a human reviewer. */
export interface SourceCandidate {
  canonicalUrl: string;
  name: string;
  publisher: string;
  audience: Audience[];
  discoveredFromUrl: string;
  evidenceExcerpt: string;
  accessStatus: AccessStatus;
  requiresLogin: boolean;
  hasCaptcha: boolean;
  intendedUse: "monitor_page" | "official_api" | "rss_feed" | "public_dataset" | "manual_link_only";
}

export interface CandidateAssessment {
  decision: CandidateDecision;
  reasons: string[];
  qualityScore: number;
}

/** Each agent has bounded responsibility and no agent can publish an action. */
export const agentMeshRoster: AgentDefinition[] = [
  { id: "business-opportunity-scout", name: "Business Opportunity Scout", lane: "MSME and Startup", capabilities: ["discover", "extract"], audience: ["business"], approvedSourceIds: ["startup-india"], cadence: "every_4_hours", publishAuthority: false },
  { id: "procurement-scout", name: "Procurement Scout", lane: "Public procurement", capabilities: ["discover", "verify", "extract"], audience: ["business"], approvedSourceIds: ["msme-schemes"], cadence: "every_4_hours", publishAuthority: false },
  { id: "compliance-deadline-scout", name: "Compliance and Deadline Scout", lane: "Business deadlines", capabilities: ["discover", "detect_change", "extract"], audience: ["business"], approvedSourceIds: ["msme-notices"], cadence: "every_4_hours", publishAuthority: false },
  { id: "student-opportunity-scout", name: "Student Opportunity Scout", lane: "Scholarships and education", capabilities: ["discover", "extract"], audience: ["student"], approvedSourceIds: ["national-scholarship-portal"], cadence: "every_4_hours", publishAuthority: false },
  { id: "skills-career-scout", name: "Skills and Career Scout", lane: "Public skills and careers", capabilities: ["discover", "verify", "extract"], audience: ["student", "citizen"], approvedSourceIds: ["ncs"], cadence: "every_4_hours", publishAuthority: false },
  { id: "citizen-services-scout", name: "Citizen Services Scout", lane: "Schemes and services", capabilities: ["discover", "extract"], audience: ["citizen", "business", "student"], approvedSourceIds: ["myscheme"], cadence: "every_4_hours", publishAuthority: false },
  { id: "state-portal-scout", name: "State Portal Scout", lane: "State government", capabilities: ["discover", "verify", "extract"], audience: ["business", "student", "citizen"], approvedSourceIds: ["india-gov-schemes"], cadence: "every_4_hours", publishAuthority: false },
  { id: "source-verifier", name: "Source Verifier", lane: "Authority and access", capabilities: ["discover", "verify", "extract"], audience: ["business", "student", "citizen"], approvedSourceIds: ["education-scholarships"], cadence: "daily", publishAuthority: false },
  { id: "evidence-quality-agent", name: "Evidence Quality Agent", lane: "Conflicts and duplicates", capabilities: ["deduplicate", "quality_review", "extract"], audience: ["student"], approvedSourceIds: ["education-loans"], cadence: "daily", publishAuthority: false },
  { id: "change-watch-agent", name: "Change Watch Agent", lane: "High-impact updates", capabilities: ["detect_change", "quality_review", "extract"], audience: ["business", "student", "citizen"], approvedSourceIds: ["india-gov-spotlight"], cadence: "every_4_hours", publishAuthority: false }
];

function isHttpsPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !/^(localhost|127\\.|0\\.|10\\.|192\\.168\\.|172\.(1[6-9]|2\\d|3[01])\\.)/.test(url.hostname);
  } catch {
    return false;
  }
}

/** Deterministic guardrail around any model-proposed source. */
export function assessSourceCandidate(candidate: SourceCandidate): CandidateAssessment {
  const reasons: string[] = [];
  if (!isHttpsPublicUrl(candidate.canonicalUrl)) reasons.push("Candidate URL must be a public HTTPS URL without credentials.");
  if (!isHttpsPublicUrl(candidate.discoveredFromUrl)) reasons.push("Candidate must include the public URL that led to its discovery.");
  if (!candidate.name.trim() || !candidate.publisher.trim()) reasons.push("Candidate must identify its name and publisher.");
  if (!candidate.audience.length) reasons.push("Candidate must identify at least one audience.");
  if (candidate.evidenceExcerpt.trim().length < 40) reasons.push("Candidate needs a short evidence excerpt proving its purpose.");
  if (candidate.accessStatus !== "allowed") reasons.push("Access permission is not confirmed for automated collection.");
  if (candidate.requiresLogin || candidate.hasCaptcha) reasons.push("Login- or CAPTCHA-gated sources are manual-link-only, never automated collectors.");
  if (candidate.intendedUse === "manual_link_only") reasons.push("Manual-link-only sources cannot enter the collector allow-list.");
  const penalty = Math.min(90, reasons.length * 15);
  return {
    decision: reasons.length ? "rejected" : "needs_human_review",
    reasons: reasons.length ? reasons : ["Candidate meets mechanical safeguards. A human must still verify terms, authority, content quality, and cadence before enabling collection."],
    qualityScore: Math.max(10, 100 - penalty)
  };
}

export function activeAgentAssignments(sources: Source[]): Array<{ agent: AgentDefinition; source: Source }> {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return agentMeshRoster.flatMap((agent) => agent.approvedSourceIds.flatMap((sourceId) => {
    const source = sourceById.get(sourceId);
    return source ? [{ agent, source }] : [];
  }));
}

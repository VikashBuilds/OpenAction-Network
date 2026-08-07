import { createActions } from "./actions";
import { EvidenceStore, type CollectedDocument, type Collector } from "./pipeline";
import type { Audience, Opportunity, Profile, Source } from "./types";

const sources: Source[] = [
  {
    id: "msme",
    name: "Startup India Government Schemes",
    publisher: "Department for Promotion of Industry and Internal Trade",
    canonicalUrl: "https://www.startupindia.gov.in/content/sih/en/government-schemes.html",
    audience: ["business"],
    refreshHours: 24
  },
  {
    id: "student",
    name: "National Scholarship Portal",
    publisher: "Ministry of Electronics and Information Technology",
    canonicalUrl: "https://scholarships.gov.in/",
    audience: ["student"],
    refreshHours: 24
  },
  {
    id: "citizen",
    name: "myScheme",
    publisher: "Government of India",
    canonicalUrl: "https://www.myscheme.gov.in/",
    audience: ["citizen", "business", "student"],
    refreshHours: 24
  }
];

const documents: Record<string, CollectedDocument[]> = {
  msme: [{
    externalId: "startup-india-schemes",
    title: "Startup India government schemes directory",
    body: "Official directory of programmes and support for startups.",
    canonicalUrl: "https://www.startupindia.gov.in/content/sih/en/government-schemes.html"
  }],
  student: [{
    externalId: "nsp-home",
    title: "National Scholarship Portal",
    body: "Official gateway for scholarship applications and scheme notices.",
    canonicalUrl: "https://scholarships.gov.in/"
  }],
  citizen: [{
    externalId: "myscheme-home",
    title: "myScheme scheme discovery",
    body: "Official government scheme discovery service.",
    canonicalUrl: "https://www.myscheme.gov.in/"
  }]
};

function collectorFor(source: Source): Collector {
  return { source, collect: async () => documents[source.id] ?? [] };
}

export const demoProfiles: Record<Audience, Profile> = {
  business: {
    id: "demo-business",
    audience: "business",
    label: "Udyam-registered startup",
    facts: { entity_type: "startup", udyam_registered: true, state: "Karnataka" }
  },
  student: {
    id: "demo-student",
    audience: "student",
    label: "Undergraduate student",
    facts: { education_level: "undergraduate", indian_resident: true, state: "Bihar" }
  },
  citizen: {
    id: "demo-citizen",
    audience: "citizen",
    label: "Indian resident",
    facts: { indian_resident: true, state: "Maharashtra" }
  }
};

export async function buildDemoCatalog(now = new Date("2026-07-26T09:00:00.000Z")) {
  const store = new EvidenceStore();
  const ingests = await Promise.all(sources.map((source) => store.ingest(collectorFor(source), now)));
  const bySource = new Map(ingests.map((item) => [item.snapshot.sourceId, item.documents[0]! ]));
  const opportunities: Opportunity[] = [
    {
      id: "business-startup-schemes",
      sourceId: "msme",
      documentVersionId: bySource.get("msme")!.id,
      audience: "business",
      kind: "scheme",
      title: "Review startup support schemes",
      summary: "Compare official startup programmes and identify support relevant to your company.",
      actionLabel: "Open official directory",
      actionUrl: "https://www.startupindia.gov.in/content/sih/en/government-schemes.html",
      requirements: [
        { field: "entity_type", operator: "equals", value: "startup", label: "you identify as a startup" },
        { field: "udyam_registered", operator: "truthy", label: "you have an Udyam registration" }
      ]
    },
    {
      id: "student-scholarship-portal",
      sourceId: "student",
      documentVersionId: bySource.get("student")!.id,
      audience: "student",
      kind: "scholarship",
      title: "Check scholarship applications",
      summary: "Review official scholarship options and the current application requirements.",
      actionLabel: "Visit National Scholarship Portal",
      actionUrl: "https://scholarships.gov.in/",
      requirements: [
        { field: "education_level", operator: "in", value: ["undergraduate", "postgraduate"], label: "you are in higher education" },
        { field: "indian_resident", operator: "truthy", label: "you are an Indian resident" }
      ]
    },
    {
      id: "citizen-scheme-discovery",
      sourceId: "citizen",
      documentVersionId: bySource.get("citizen")!.id,
      audience: "citizen",
      kind: "service",
      title: "Find schemes matched to your situation",
      summary: "Use the Government of India scheme discovery service to check available support.",
      actionLabel: "Search myScheme",
      actionUrl: "https://www.myscheme.gov.in/",
      requirements: [{ field: "indian_resident", operator: "truthy", label: "you are an Indian resident" }]
    }
  ];
  opportunities.forEach((opportunity) => store.addOpportunity(opportunity));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const actions = Object.fromEntries((Object.keys(demoProfiles) as Audience[]).map((audience) => [
    audience,
    createActions(opportunities, demoProfiles[audience], sourceMap, now.toISOString(), now)
  ]));
  return { sources, opportunities, actions, snapshots: ingests.map((item) => item.snapshot) };
}

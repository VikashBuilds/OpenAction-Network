import { describe, expect, it } from "vitest";
import { EvidenceStore, LocalEvidenceRetriever, activeAgentAssignments, answerFromEvidence, assessSourceCandidate, chunkDocument, createOfficialPageCollector, discoverOfficialResources, extractOfficialText, matchOpportunity, normalizeUrl, officialSourceRegistry, toEvidenceVectors, validateSource } from "./index";
import { buildDemoCatalog, demoProfiles } from "./fixtures";
import type { Collector, Opportunity, Source } from "./index";

const source: Source = { id: "test", name: "Test", publisher: "Government", canonicalUrl: "https://example.gov.in/path#fragment", audience: ["business"], refreshHours: 24 };
const collector: Collector = { source, collect: async () => [{ externalId: "one", title: "One", body: "Body", canonicalUrl: "https://example.gov.in/one" }] };

describe("evidence pipeline", () => {
  it("normalizes official source URLs and rejects unsafe URLs", () => {
    expect(normalizeUrl(" https://example.gov.in/path#fragment ")).toBe("https://example.gov.in/path");
    expect(() => normalizeUrl("http://example.gov.in")).toThrow();
    expect(validateSource(source).canonicalUrl).toBe("https://example.gov.in/path");
  });

  it("retains snapshots and makes repeated collection idempotent", async () => {
    const store = new EvidenceStore();
    const first = await store.ingest(collector, new Date("2026-07-26T00:00:00.000Z"));
    const second = await store.ingest(collector, new Date("2026-07-26T01:00:00.000Z"));
    expect(first.inserted).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(store.snapshots.size).toBe(2);
  });

  it("records failed collection without losing observability", async () => {
    const store = new EvidenceStore();
    const failed = await store.ingest({ source, collect: async () => { throw new Error("Source unavailable"); } });
    expect(failed.snapshot.status).toBe("failed");
    expect(failed.snapshot.error).toContain("unavailable");
  });

  it("matches deterministically and treats missing facts as possible, not certain", () => {
    const opportunity: Opportunity = {
      id: "op", sourceId: "test", documentVersionId: "doc", audience: "business", kind: "scheme", title: "Test", summary: "test", actionLabel: "Open", actionUrl: "https://example.gov.in", requirements: [
        { field: "entity_type", operator: "equals", value: "startup", label: "startup" },
        { field: "state", operator: "equals", value: "Karnataka", label: "state" }
      ]
    };
    expect(matchOpportunity(opportunity, demoProfiles.business).status).toBe("eligible");
    expect(matchOpportunity(opportunity, { ...demoProfiles.business, facts: { entity_type: "startup" } }).status).toBe("possibly_eligible");
    expect(matchOpportunity(opportunity, { ...demoProfiles.business, facts: { entity_type: "shop" } }).status).toBe("not_eligible");
  });

  it("produces source-backed actions for every demonstration audience", async () => {
    const catalog = await buildDemoCatalog();
    expect(catalog.actions.business?.[0]?.source.canonicalUrl).toMatch(/^https:/);
    expect(catalog.actions.student?.[0]?.explanation).toContain("matches");
    expect(catalog.actions.citizen?.[0]?.freshness).toBe("fresh");
  });

  it("chunks live evidence and returns source-preserving retrieval results", async () => {
    const liveSource: Source = { ...source, id: "live" };
    const collector = createOfficialPageCollector(liveSource, async () => new Response("<html><title>Official notice</title><body>This government support scheme is for eligible startups in Karnataka. Apply using the official portal.</body></html>", { status: 200 }));
    const store = new EvidenceStore();
    const result = await store.ingest(collector, new Date("2026-07-26T00:00:00.000Z"));
    const chunks = chunkDocument(result.documents[0]!);
    const hits = new LocalEvidenceRetriever(chunks, new Map([[liveSource.id, liveSource]])).search("startup support Karnataka");
    const answer = answerFromEvidence("startup support Karnataka", hits);
    expect(hits[0]?.source.canonicalUrl).toBe(liveSource.canonicalUrl);
    expect(answer.citations).toHaveLength(1);
    expect(answer.answer).toContain("official material");
  });

  it("prefers the official page's main content over navigation and footer noise", () => {
    const text = extractOfficialText("<html><header>Portal login notifications</header><nav>Home Schemes Contact</nav><main><h1>Startup support notice</h1><p>Eligible startups may apply for the official seed support programme using the linked portal.</p></main><footer>Privacy terms copyright</footer></html>");
    expect(text).toContain("Eligible startups may apply");
    expect(text).not.toContain("Portal login");
    expect(text).not.toContain("Privacy terms");
  });

  it("discovers only relevant same-host official resource links", () => {
    const resources = discoverOfficialResources("<a href='/home'>Home</a><a href='/seed-fund'>Startup Seed Fund Scheme</a><a href='https://outside.example/loan'>Loan support</a><a href='/seed-fund'>Startup Seed Fund Scheme</a>", source);
    expect(resources).toHaveLength(1);
    expect(resources[0]?.title).toBe("Startup Seed Fund Scheme");
    expect(resources[0]?.canonicalUrl).toBe("https://example.gov.in/seed-fund");
  });

  it("keeps AI-discovered candidates outside the collector allow-list until review", () => {
    const assessment = assessSourceCandidate({
      canonicalUrl: "https://example.gov.in/private",
      name: "Example service",
      publisher: "Example Department",
      audience: ["citizen"],
      discoveredFromUrl: "https://example.gov.in/",
      evidenceExcerpt: "This public service page has eligibility and application information for citizens.",
      accessStatus: "unknown",
      requiresLogin: true,
      hasCaptcha: false,
      intendedUse: "monitor_page"
    });
    expect(assessment.decision).toBe("rejected");
    expect(assessment.reasons.join(" ")).toContain("Login");
    expect(activeAgentAssignments(officialSourceRegistry)).toHaveLength(3);
  });

  it("creates versioned vector records and rejects incomplete embeddings", () => {
    const document = { id: "document-live-one", sourceId: "live", snapshotId: "snapshot", externalId: "one", title: "Official", body: "Verified official evidence for search.", canonicalUrl: "https://example.gov.in/one", versionHash: "hash" };
    const chunks = chunkDocument(document);
    const vectors = toEvidenceVectors(chunks, chunks.map(() => [0.1, 0.2, 0.3]));
    expect(vectors[0]?.metadata.documentVersionId).toBe(document.id);
    expect(vectors[0]?.id.length).toBeLessThanOrEqual(64);
    expect(() => toEvidenceVectors(chunks, [])).toThrow("exactly one embedding");
  });

  it("preserves a source-backed change and flags high-impact language for review", async () => {
    let body = "Applications are open for eligible startups.";
    const changingCollector: Collector = { source, collect: async () => [{ externalId: "notice", title: "Notice", body, canonicalUrl: "https://example.gov.in/notice" }] };
    const store = new EvidenceStore();
    await store.ingest(changingCollector, new Date("2026-07-26T00:00:00.000Z"));
    body = "Applications are open for eligible startups. The application deadline is 31 August.";
    const updated = await store.ingest(changingCollector, new Date("2026-07-27T00:00:00.000Z"));
    expect(updated.changes).toHaveLength(1);
    expect(updated.changes[0]?.impact).toBe("review_required");
    expect(updated.changes[0]?.reasons).toContain("deadline language changed");
  });
});

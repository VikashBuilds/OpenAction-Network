import type { Collector, CollectedDocument } from "./pipeline";
import type { Source } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const officialSourceRegistry: Source[] = [
  { id: "startup-india", name: "Startup India Government Schemes", publisher: "Department for Promotion of Industry and Internal Trade", canonicalUrl: "https://www.startupindia.gov.in/content/sih/en/government-schemes.html", audience: ["business"], refreshHours: 24 },
  { id: "msme-schemes", name: "MyMSME Scheme Catalogue", publisher: "Ministry of Micro, Small and Medium Enterprises", canonicalUrl: "https://my.msme.gov.in/MyMsme/Scheme.aspx", audience: ["business"], refreshHours: 12 },
  { id: "msme-notices", name: "MyMSME Scheme Activity", publisher: "Ministry of Micro, Small and Medium Enterprises", canonicalUrl: "https://my.msme.gov.in/mymsme/SchemeWiseProposals.aspx", audience: ["business"], refreshHours: 12 },
  { id: "national-scholarship-portal", name: "National Scholarship Portal", publisher: "Ministry of Electronics and Information Technology", canonicalUrl: "https://scholarships.gov.in/", audience: ["student"], refreshHours: 24 },
  { id: "education-scholarships", name: "Social Justice Schemes", publisher: "Ministry of Social Justice and Empowerment", canonicalUrl: "https://socialjustice.gov.in/schemes", audience: ["student", "citizen"], refreshHours: 24 },
  { id: "education-loans", name: "Tribal Affairs Scholarship Information", publisher: "Ministry of Tribal Affairs", canonicalUrl: "https://tribal.nic.in/ScholarshiP.aspx", audience: ["student", "citizen"], refreshHours: 24 },
  { id: "ncs", name: "National Career Service Opportunities", publisher: "Ministry of Labour and Employment", canonicalUrl: "https://www.ncs.gov.in/", audience: ["student", "citizen"], refreshHours: 12 },
  { id: "myscheme", name: "myScheme", publisher: "Government of India", canonicalUrl: "https://www.myscheme.gov.in/", audience: ["citizen", "business", "student"], refreshHours: 24 },
  { id: "india-gov-schemes", name: "National Portal Government Schemes", publisher: "National Portal of India", canonicalUrl: "https://www.india.gov.in/my-government/schemes", audience: ["citizen", "business", "student"], refreshHours: 24 },
  { id: "india-gov-spotlight", name: "National Portal Scheme Spotlight", publisher: "National Portal of India", canonicalUrl: "https://www.india.gov.in/", audience: ["citizen", "business", "student"], refreshHours: 24 }
];

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(?:svg|iframe|template)[\s\S]*?<\/(?:svg|iframe|template)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/&(?:quot|#34);/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s*--\>\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentInside(html: string, tag: "main" | "article"): string | null {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html)?.[1] ?? null;
}

export function extractOfficialText(html: string): string {
  const candidates = [contentInside(html, "main"), contentInside(html, "article")].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const text = htmlToText(candidate);
    if (text.length >= 80) return text;
  }
  return htmlToText(html
    .replace(/<(?:nav|header|footer|aside|form)\b[\s\S]*?<\/(?:nav|header|footer|aside|form)>/gi, " "));
}

const officialResourceTerms = /\b(scheme|fund|grant|scholarship|loan|credit|startup|benefit|apply|support|service|mudra|seed|incubat|enterprise)\b/i;

export function discoverOfficialResources(html: string, source: Source): CollectedDocument[] {
  const target = new URL(source.canonicalUrl);
  const seen = new Set<string>();
  const resources: CollectedDocument[] = [];
  const anchors = html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi);
  for (const anchor of anchors) {
    const href = anchor[2];
    const label = htmlToText(anchor[3] ?? "");
    if (!href || !label || !officialResourceTerms.test(label)) continue;
    let url: URL;
    try {
      url = new URL(href, target);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.host !== target.host) continue;
    url.hash = "";
    if (url.toString() === target.toString() || seen.has(url.toString())) continue;
    seen.add(url.toString());
    resources.push({
      externalId: `resource:${url.pathname}${url.search}`,
      title: label,
      body: `Official resource listed by ${source.name}: ${label}. This is a source discovery record; confirm eligibility, application requirements, and deadlines on the linked official page.`,
      canonicalUrl: url.toString()
    });
    if (resources.length === 12) break;
  }
  return resources;
}

function htmlTitle(html: string, fallback: string): string {
  const result = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return result ? htmlToText(result) : fallback;
}

export function createOfficialPageCollector(source: Source, fetcher: FetchLike = fetch): Collector {
  const allowedHost = new URL(source.canonicalUrl).host;
  return {
    source,
    async collect(): Promise<CollectedDocument[]> {
      const target = new URL(source.canonicalUrl);
      if (target.protocol !== "https:" || target.host !== allowedHost) throw new Error("Collector target is not an allow-listed HTTPS source");
      const response = await fetcher(target.toString(), { headers: { "user-agent": "OpenActionNetwork/0.1 evidence collector" } });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > 1_500_000) throw new Error("Source response exceeds the 1.5MB collector limit");
      const html = await response.text();
      if (html.length > 1_500_000) throw new Error("Source response exceeds the 1.5MB collector limit");
      const body = extractOfficialText(html);
      if (body.length < 80) throw new Error("Source response did not contain enough extractable public text");
      return [
        { externalId: target.pathname || "home", title: htmlTitle(html, source.name), body, canonicalUrl: target.toString() },
        ...discoverOfficialResources(html, source)
      ];
    }
  };
}

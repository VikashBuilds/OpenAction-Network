# OpenAction Network

An English-first India action engine: it turns permitted public information into source-backed next actions for businesses, students, and citizens.

## What is implemented

- React dashboard with browser-local profiles for Business, Student, and Citizen contexts.
- Deterministic, evidence-first opportunity matching with applicable-fact explanations.
- Immutable snapshot and document-version model with idempotent ingestion and failed-run records.
- Provider-neutral collector interface and official-source demo fixtures.
- Cloudflare Worker API, scheduled-ingestion contract, D1 schema, and resource binding template.
- Ten-agent discovery, verification, and quality roster with a separately authenticated GitHub Actions collector mesh.
- No AI key is required. Any future Groq/NVIDIA NIM adapter must emit strict structured data and cannot create an unsourced action.

See [implementation status](docs/implementation-status.md) for the current task list, completed work, and the remaining production milestones.

## Quick start

```powershell
pnpm install
pnpm verify
pnpm --filter @openaction/web dev
```

Open the printed local URL, normally `http://localhost:5173`.

Run the Worker separately:

```powershell
pnpm --filter @openaction/worker dev
```

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Fixture-runtime health status |
| `GET /v1/catalog` | Sources, snapshots, and available opportunities |
| `GET /v1/agent-mesh` | Agent roles and their approved source assignments |
| `GET /v1/agent-findings` | AI-selected, exact-excerpt evidence signals from monitored official sources |
| `GET /v1/source-candidates` | AI-assisted, human-review-only official-source leads |
| `POST /v1/match` | Deterministically match a local profile to actions |
| `GET /v1/changes` | Persisted, source-backed document changes after D1 is configured |
| `POST /v1/ask` | Evidence-only answer with citations; lexical fallback until Vectorize is configured |
| `GET /v1/admin/reviews` | Token-protected list of high-impact source changes awaiting review |
| `POST /v1/admin/reviews/:changeId` | Token-protected approve/reject decision for a pending change |
| `POST /v1/ingest/github` | GitHub-Actions-token-protected request for an approved source assignment |

`POST /v1/match` accepts:

```json
{
  "id": "my-profile",
  "label": "Karnataka startup",
  "audience": "business",
  "facts": { "entity_type": "startup", "udyam_registered": true, "state": "Karnataka" }
}
```

## Cloudflare deployment preparation

1. Create the D1 database, R2 bucket, and Queue in your Cloudflare account.
2. Copy bindings from `apps/worker/wrangler.resources.example.jsonc` into `apps/worker/wrangler.jsonc` and replace the D1 placeholder.
3. Apply `apps/worker/schema.sql` with Wrangler.
4. Deploy the worker and point the web app’s API base URL at it.

Free plans change. Treat the included infrastructure as a low-cost launch path, not a promise of unlimited capacity. Never bypass source access controls, CAPTCHAs, logins, or terms of use.

Set `ADMIN_TOKEN` using `wrangler secret put ADMIN_TOKEN`; do not place the real value in `wrangler.jsonc`, a repository variable file, or the browser bundle.

See [the agent mesh runbook](docs/agent-mesh.md) to connect the public GitHub repository to the Worker with a dedicated ingestion secret. GitHub Actions orchestrates approved collection; Cloudflare remains the evidence and publication trust boundary.

When D1, Workers AI, and `VECTOR_INDEX` are bound, `GET /v1/search` and `POST /v1/ask` automatically use semantic retrieval. Until then they use the local lexical fallback and label that mode in their response.

## Verification

`pnpm verify` runs TypeScript checks, evidence-pipeline tests, a Worker dry-run bundle, and the production web build.

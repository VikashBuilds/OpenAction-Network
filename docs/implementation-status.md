# Implementation Status

## Completed

- [x] Local MVP: three audience dashboards, browser-local profiles, deterministic action matching, source-linked cards, API, tests, CI, and local Git repository.
- [x] Evidence model: source, snapshot, document version, opportunity, profile, match, action, chunk, retrieval hit, and evidence vector types.
- [x] Safe live-source collection: allow-listed HTTPS targets, response-size limit, extraction failure records, and official source registry.
- [x] Content-quality extraction: collectors prefer official `main`/`article` material, strip navigation/footer noise, and preserve only readable public text for retrieval.
- [x] Official resource shelf: collectors discover relevant same-host programme and service links, persist them as evidence records, and expose them as clearly non-personalised official resources.
- [x] Persistence contracts: raw snapshot payloads to R2 and structured source/snapshot/document records to D1.
- [x] Retrieval foundation: document chunking, source-preserving lexical retrieval, citation-only response shape, vector record creation, and optional Workers AI/Vectorize indexing bindings.
- [x] Durable ingestion orchestration: Queue job contract, workflow stages, retries/backoff, D1 run-state records, failed-run retention, scheduled jobs, and token-protected manual triggering.
- [x] Ask OpenAction evidence explorer: local evidence retrieval, a source-cited answer shape, `POST /v1/ask`, and a dashboard question UI with clear fallback labeling.
- [x] Semantic retrieval runtime: `/v1/search` and `/v1/ask` embed questions, query Vectorize with current-English filters, hydrate exact D1 document versions, and fall back safely when Cloudflare bindings are unavailable.
- [x] Change intelligence: version-to-version sentence diffs, source-backed before/after records, deterministic review flags for deadline/eligibility/requirement changes, D1 persistence, and `GET /v1/changes`.
- [x] Admin review gate: high-impact source changes create pending reviews; token-protected endpoints list and approve/reject them before downstream publishing.
- [x] Verification: strict TypeScript checks, ten core tests, Worker dry-run bundle, production web build, and live Pages HTTP check.

## Live Cloudflare deployment (2026-07-26)

- [x] Worker deployed as `openaction-api` with Workers AI, D1, R2, Queue, Workflow, scheduled trigger, and Vectorize bindings.
- [x] Remote D1 database `openaction` initialized from `apps/worker/schema.sql`.
- [x] R2 bucket `openaction-snapshots`, ingestion and dead-letter queues, and the `openaction-ingest` Workflow provisioned.
- [x] Vectorize index `openaction-evidence` provisioned at 768 dimensions with cosine distance and metadata indexes for source, language, and status.
- [x] First successful source runs: myScheme (4 indexed chunks) and Startup India (10 indexed chunks). The National Scholarship Portal returned HTTP 522 and is retained as a visible partial failure.
- [x] Public dashboard deployed: https://openaction-network.pages.dev/
- [x] Dashboard-to-Worker connection: the production Pages build uses `VITE_API_BASE_URL=https://openaction-api.novamint.workers.dev` for the live source-change feed.
- [x] Live source health: `/v1/status` exposes freshness, last successful or failed run, source error, and indexing counts; the Pages dashboard renders the real ingestion state.

## Next implementation tasks

- [ ] Add streamed grounded answers and answer-quality/evidence regression tests for model-generated summaries.
- [ ] Build a source-change timeline and impact explanation UI once live snapshots accumulate.
- [ ] Add user identity, subscriptions, Durable Object deadline alarms, email/browser alerts, and per-user rate/spend limits.

## Deliberate boundaries

- The dashboard remains fixture-backed until live opportunity extraction has human review.
- Live scheduled ingestion runs every six hours. Source outages remain visible and never generate uncited actions.
- No model can publish an unsourced action or make a definitive eligibility, legal, financial, or benefit decision.

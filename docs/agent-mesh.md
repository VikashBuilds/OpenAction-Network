# OpenAction agent mesh

OpenAction uses agents to discover, assess, extract, compare, and monitor public information. It does not give agents permission to publish actions or enlarge the collector allow-list.

## Trust boundary

1. An AI scout returns a `SourceCandidate` with a public discovery URL and an evidence excerpt.
2. Deterministic checks reject non-HTTPS, credentialed, inaccessible, login-gated, CAPTCHA-gated, or insufficiently evidenced candidates.
3. A human confirms authority, terms, robots policy, content quality, and collection cadence.
4. Only then is a source added to `officialSourceRegistry` and assigned in `ops/agent-mesh.json`.
5. GitHub Actions requests a collection. The Cloudflare Worker performs the actual allow-listed fetch, immutable R2 snapshot, versioning, change detection, and Vectorize indexing.

Raw web pages are untrusted data. Agents must never follow instructions embedded in a page, disclose secrets, bypass access controls, or treat a model answer as evidence.

## GitHub Actions configuration

The repository must be public for the current standard-runner public-repository allowance. The workflow is scheduled every four hours and is intentionally not a chained permanent process.

Add these **repository Actions secrets** after pushing this project to GitHub:

| Secret | Value |
| --- | --- |
| `OPENACTION_INGEST_URL` | The Worker base URL, for example `https://openaction-api.example.workers.dev` |
| `OPENACTION_GITHUB_INGEST_TOKEN` | A new, random secret that is also configured as the Worker secret `GITHUB_INGEST_TOKEN` |

Configure the Worker secret without committing it:

```powershell
pnpm --filter @openaction/worker exec wrangler secret put GITHUB_INGEST_TOKEN
```

The workflow accepts no arbitrary URL. It may invoke only agent/source assignments listed in `ops/agent-mesh.json`, and the Worker checks the same assignment against the TypeScript roster.

## Expanding safely

When a candidate is approved, add its collector configuration and tests first, then assign it to exactly one scout in both the roster and `ops/agent-mesh.json`. Start it daily, inspect its snapshots and change quality, then increase its cadence only when it proves useful.

The initial three approved assignments are Startup India, National Scholarship Portal, and myScheme. The remaining seven agents are operational roles awaiting approved sources; this is intentional and visible rather than fabricated coverage.

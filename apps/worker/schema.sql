CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  publisher TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  audience_json TEXT NOT NULL,
  refresh_hours INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  version_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS document_versions_source_external ON document_versions(source_id, external_id);

CREATE TABLE IF NOT EXISTS document_changes (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  previous_document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  current_document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  detected_at TEXT NOT NULL,
  impact TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  added_sentences_json TEXT NOT NULL,
  removed_sentences_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS document_changes_recent ON document_changes(detected_at DESC);

CREATE TABLE IF NOT EXISTS change_reviews (
  change_id TEXT PRIMARY KEY REFERENCES document_changes(id),
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewer TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS change_reviews_pending ON change_reviews(status, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  audience TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  action_label TEXT NOT NULL,
  action_url TEXT NOT NULL,
  deadline TEXT,
  requirements_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  audience TEXT NOT NULL,
  label TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  matched_at TEXT NOT NULL,
  status TEXT NOT NULL,
  applicable_facts_json TEXT NOT NULL,
  missing_facts_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  error TEXT,
  document_count INTEGER,
  indexed_count INTEGER,
  change_count INTEGER
);

CREATE INDEX IF NOT EXISTS ingestion_runs_recent ON ingestion_runs(requested_at DESC);

CREATE TABLE IF NOT EXISTS feedback_reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('source_issue', 'action_issue', 'other')),
  source_id TEXT REFERENCES sources(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new', 'reviewed', 'closed')) DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS feedback_reports_review_queue ON feedback_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_findings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_name TEXT NOT NULL,
  document_version_ids_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  signals_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_findings_source_content ON agent_findings(source_id, content_hash);
CREATE INDEX IF NOT EXISTS agent_findings_recent ON agent_findings(created_at DESC);

CREATE TABLE IF NOT EXISTS source_candidates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  discovered_from_source_id TEXT NOT NULL REFERENCES sources(id),
  canonical_url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  evidence_excerpt TEXT NOT NULL,
  host TEXT NOT NULL,
  score INTEGER NOT NULL,
  review_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_review', 'approved', 'rejected')) DEFAULT 'pending_review',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS source_candidates_review_queue ON source_candidates(status, score DESC, created_at DESC);

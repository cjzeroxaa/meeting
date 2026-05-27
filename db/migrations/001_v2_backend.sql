CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT 'Untitled meeting',
  status TEXT NOT NULL DEFAULT 'draft',
  recording_mode TEXT NOT NULL DEFAULT 'microphone_only',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  transcript_status TEXT NOT NULL DEFAULT 'not_started',
  audio_status TEXT NOT NULL DEFAULT 'not_uploaded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT meetings_status_check CHECK (
    status IN ('draft', 'recording', 'processing', 'saved', 'failed', 'deleted')
  ),
  CONSTRAINT transcript_status_check CHECK (
    transcript_status IN ('not_started', 'live', 'partial', 'complete', 'failed')
  ),
  CONSTRAINT audio_status_check CHECK (
    audio_status IN ('not_uploaded', 'uploading', 'uploaded', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS meetings_owner_created_idx
ON meetings(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meetings_owner_status_idx
ON meetings(owner_user_id, status);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  provider_item_id TEXT,
  sequence_index INTEGER NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  raw_text TEXT NOT NULL,
  edited_text TEXT,
  is_final BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, sequence_index)
);

CREATE INDEX IF NOT EXISTS transcript_segments_meeting_order_idx
ON transcript_segments(meeting_id, sequence_index);

CREATE INDEX IF NOT EXISTS transcript_segments_provider_idx
ON transcript_segments(meeting_id, provider_item_id);

CREATE TABLE IF NOT EXISTS note_documents (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  content_json JSONB NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  last_edited_by TEXT REFERENCES users(id),
  last_edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_documents_meeting_idx
ON note_documents(meeting_id);

CREATE INDEX IF NOT EXISTS note_documents_content_search_idx
ON note_documents
USING GIN (to_tsvector('english', content_text));

CREATE TABLE IF NOT EXISTS note_revisions (
  id TEXT PRIMARY KEY,
  note_document_id TEXT NOT NULL REFERENCES note_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_json JSONB NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',
  edited_by TEXT REFERENCES users(id),
  change_source TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(note_document_id, version)
);

CREATE INDEX IF NOT EXISTS note_revisions_document_version_idx
ON note_revisions(note_document_id, version DESC);

CREATE TABLE IF NOT EXISTS audio_assets (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  bucket_name TEXT NOT NULL,
  object_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  duration_seconds INTEGER,
  upload_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audio_upload_status_check CHECK (
    upload_status IN ('pending', 'uploaded', 'failed', 'deleted')
  )
);

CREATE INDEX IF NOT EXISTS audio_assets_meeting_idx
ON audio_assets(meeting_id);

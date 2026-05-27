import type { NoteDocumentContent } from "@/lib/server/notes";

export type MeetingRow = {
  id: string;
  owner_user_id: string;
  title: string;
  status: string;
  recording_mode: string;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  duration_seconds: number | null;
  transcript_status: string;
  audio_status: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SegmentRow = {
  id: string;
  meeting_id: string;
  provider_item_id: string | null;
  sequence_index: number;
  start_ms: number | null;
  end_ms: number | null;
  raw_text: string;
  edited_text: string | null;
  is_final: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export type NoteDocumentRow = {
  id: string;
  meeting_id: string;
  content_json: NoteDocumentContent;
  content_text: string;
  version: number;
  last_edited_by: string | null;
  last_edited_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type NoteRevisionRow = {
  id: string;
  note_document_id: string;
  version: number;
  content_json: NoteDocumentContent;
  content_text: string;
  edited_by: string | null;
  change_source: string;
  created_at: Date | string;
};

export type AudioAssetRow = {
  id: string;
  meeting_id: string;
  bucket_name: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: string | number | null;
  duration_seconds: number | null;
  upload_status: string;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapMeeting(row: MeetingRow) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    status: row.status,
    recordingMode: row.recording_mode,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    durationSeconds: row.duration_seconds,
    transcriptStatus: row.transcript_status,
    audioStatus: row.audio_status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export function mapTranscriptSegment(row: SegmentRow) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    providerItemId: row.provider_item_id,
    sequenceIndex: row.sequence_index,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.edited_text ?? row.raw_text,
    rawText: row.raw_text,
    editedText: row.edited_text,
    isFinal: row.is_final,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export function mapNoteDocument(row: NoteDocumentRow) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    contentJson: row.content_json,
    contentText: row.content_text,
    version: row.version,
    lastEditedBy: row.last_edited_by,
    lastEditedAt: iso(row.last_edited_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export function mapNoteRevision(row: NoteRevisionRow) {
  return {
    id: row.id,
    noteDocumentId: row.note_document_id,
    version: row.version,
    contentJson: row.content_json,
    contentText: row.content_text,
    editedBy: row.edited_by,
    changeSource: row.change_source,
    createdAt: iso(row.created_at)
  };
}

export function mapAudioAsset(row: AudioAssetRow | null) {
  if (!row) {
    return {
      status: "not_uploaded",
      durationSeconds: null
    };
  }

  return {
    id: row.id,
    meetingId: row.meeting_id,
    bucketName: row.bucket_name,
    objectPath: row.object_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    durationSeconds: row.duration_seconds,
    status: row.upload_status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

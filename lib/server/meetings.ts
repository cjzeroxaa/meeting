import { type PoolClient } from "pg";
import { query, withTransaction } from "@/lib/server/db";
import { createServerId } from "@/lib/server/ids";
import {
  mapAudioAsset,
  mapMeeting,
  mapNoteDocument,
  mapNoteRevision,
  mapTranscriptSegment,
  type AudioAssetRow,
  type MeetingRow,
  type NoteDocumentRow,
  type NoteRevisionRow,
  type SegmentRow
} from "@/lib/server/mappers";
import {
  createInitialNoteDocument,
  extractContentText,
  type NoteDocumentContent
} from "@/lib/server/notes";

export async function createMeetingForUser({
  ownerUserId,
  title,
  recordingMode
}: {
  ownerUserId: string;
  title: string;
  recordingMode: string;
}) {
  return withTransaction(async (client) => {
    const meetingId = createServerId("mtg");
    const noteDocumentId = createServerId("doc");
    const noteContent = createInitialNoteDocument(title);
    const noteText = extractContentText(noteContent);

    const meetingResult = await client.query<MeetingRow>(
      `
        INSERT INTO meetings (
          id,
          owner_user_id,
          title,
          recording_mode
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [meetingId, ownerUserId, title || "Untitled meeting", recordingMode]
    );

    const noteResult = await client.query<NoteDocumentRow>(
      `
        INSERT INTO note_documents (
          id,
          meeting_id,
          content_json,
          content_text
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [noteDocumentId, meetingId, noteContent, noteText]
    );

    await client.query(
      `
        INSERT INTO note_revisions (
          id,
          note_document_id,
          version,
          content_json,
          content_text,
          edited_by,
          change_source
        )
        VALUES ($1, $2, 1, $3, $4, $5, 'system')
      `,
      [createServerId("rev"), noteDocumentId, noteContent, noteText, ownerUserId]
    );

    return {
      meeting: mapMeeting(meetingResult.rows[0]),
      noteDocument: mapNoteDocument(noteResult.rows[0])
    };
  });
}

export async function listMeetingsForUser({
  ownerUserId,
  limit,
  cursor
}: {
  ownerUserId: string;
  limit: number;
  cursor?: string;
}) {
  const values: unknown[] = [ownerUserId, Math.min(Math.max(limit, 1), 100)];
  let cursorClause = "";

  if (cursor) {
    values.push(cursor);
    cursorClause = `AND created_at < $${values.length}`;
  }

  const result = await query<MeetingRow>(
    `
      SELECT *
      FROM meetings
      WHERE owner_user_id = $1
        AND deleted_at IS NULL
        ${cursorClause}
      ORDER BY created_at DESC
      LIMIT $2
    `,
    values
  );

  const items = result.rows.map(mapMeeting);
  const nextCursor =
    items.length === values[1] ? items[items.length - 1]?.createdAt : null;

  return { items, nextCursor };
}

export async function getOwnedMeeting(meetingId: string, ownerUserId: string) {
  const result = await query<MeetingRow>(
    `
      SELECT *
      FROM meetings
      WHERE id = $1
        AND owner_user_id = $2
        AND deleted_at IS NULL
    `,
    [meetingId, ownerUserId]
  );

  return result.rows[0] ? mapMeeting(result.rows[0]) : null;
}

export async function getMeetingDetail(meetingId: string, ownerUserId: string) {
  return withTransaction(async (client) => {
    const meetingResult = await client.query<MeetingRow>(
      `
        SELECT *
        FROM meetings
        WHERE id = $1
          AND owner_user_id = $2
          AND deleted_at IS NULL
      `,
      [meetingId, ownerUserId]
    );

    if (!meetingResult.rows[0]) {
      return null;
    }

    const noteResult = await client.query<NoteDocumentRow>(
      "SELECT * FROM note_documents WHERE meeting_id = $1",
      [meetingId]
    );
    const segmentsResult = await client.query<SegmentRow>(
      `
        SELECT *
        FROM transcript_segments
        WHERE meeting_id = $1
        ORDER BY sequence_index ASC
      `,
      [meetingId]
    );
    const audioResult = await client.query<AudioAssetRow>(
      "SELECT * FROM audio_assets WHERE meeting_id = $1",
      [meetingId]
    );

    return {
      meeting: mapMeeting(meetingResult.rows[0]),
      noteDocument: mapNoteDocument(noteResult.rows[0]),
      transcriptSegments: segmentsResult.rows.map(mapTranscriptSegment),
      audio: mapAudioAsset(audioResult.rows[0] ?? null)
    };
  });
}

export async function updateMeetingTitle({
  meetingId,
  ownerUserId,
  title
}: {
  meetingId: string;
  ownerUserId: string;
  title: string;
}) {
  const result = await query<MeetingRow>(
    `
      UPDATE meetings
      SET title = $3,
          updated_at = now()
      WHERE id = $1
        AND owner_user_id = $2
        AND deleted_at IS NULL
      RETURNING *
    `,
    [meetingId, ownerUserId, title || "Untitled meeting"]
  );

  return result.rows[0] ? mapMeeting(result.rows[0]) : null;
}

export async function startMeeting({
  meetingId,
  ownerUserId,
  startedAt
}: {
  meetingId: string;
  ownerUserId: string;
  startedAt: string;
}) {
  const result = await query<MeetingRow>(
    `
      UPDATE meetings
      SET status = 'recording',
          transcript_status = 'live',
          started_at = $3,
          updated_at = now()
      WHERE id = $1
        AND owner_user_id = $2
        AND deleted_at IS NULL
      RETURNING *
    `,
    [meetingId, ownerUserId, startedAt]
  );

  return result.rows[0] ? mapMeeting(result.rows[0]) : null;
}

export async function stopMeeting({
  meetingId,
  ownerUserId,
  endedAt,
  durationSeconds,
  transcriptStatus
}: {
  meetingId: string;
  ownerUserId: string;
  endedAt: string;
  durationSeconds: number;
  transcriptStatus: "complete" | "partial" | "failed";
}) {
  return withTransaction(async (client) => {
    const result = await client.query<MeetingRow>(
      `
        UPDATE meetings
        SET status = 'saved',
            transcript_status = $5,
            ended_at = $3,
            duration_seconds = $4,
            updated_at = now()
        WHERE id = $1
          AND owner_user_id = $2
          AND deleted_at IS NULL
        RETURNING *
      `,
      [meetingId, ownerUserId, endedAt, durationSeconds, transcriptStatus]
    );

    if (!result.rows[0]) {
      return null;
    }

    const noteResult = await client.query<NoteDocumentRow>(
      `
        UPDATE note_documents
        SET version = version + 1,
            last_edited_by = $2,
            last_edited_at = now(),
            updated_at = now()
        WHERE meeting_id = $1
        RETURNING *
      `,
      [meetingId, ownerUserId]
    );

    if (noteResult.rows[0]) {
      const note = noteResult.rows[0];

      await client.query(
        `
          INSERT INTO note_revisions (
            id,
            note_document_id,
            version,
            content_json,
            content_text,
            edited_by,
            change_source
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'recording_stop')
          ON CONFLICT (note_document_id, version) DO NOTHING
        `,
        [
          createServerId("rev"),
          note.id,
          note.version,
          note.content_json,
          note.content_text,
          ownerUserId
        ]
      );
    }

    return mapMeeting(result.rows[0]);
  });
}

export async function assertMeetingOwner(
  client: PoolClient,
  meetingId: string,
  ownerUserId: string
) {
  const result = await client.query(
    `
      SELECT id
      FROM meetings
      WHERE id = $1
        AND owner_user_id = $2
        AND deleted_at IS NULL
    `,
    [meetingId, ownerUserId]
  );

  return Boolean(result.rows[0]);
}

export async function getNoteDocument(meetingId: string, ownerUserId: string) {
  const result = await query<NoteDocumentRow>(
    `
      SELECT note_documents.*
      FROM note_documents
      JOIN meetings ON meetings.id = note_documents.meeting_id
      WHERE meetings.id = $1
        AND meetings.owner_user_id = $2
        AND meetings.deleted_at IS NULL
    `,
    [meetingId, ownerUserId]
  );

  return result.rows[0] ? mapNoteDocument(result.rows[0]) : null;
}

export async function listNoteRevisions(meetingId: string, ownerUserId: string) {
  const result = await query<NoteRevisionRow>(
    `
      SELECT note_revisions.*
      FROM note_revisions
      JOIN note_documents ON note_documents.id = note_revisions.note_document_id
      JOIN meetings ON meetings.id = note_documents.meeting_id
      WHERE meetings.id = $1
        AND meetings.owner_user_id = $2
        AND meetings.deleted_at IS NULL
      ORDER BY note_revisions.version DESC, note_revisions.created_at DESC
      LIMIT 50
    `,
    [meetingId, ownerUserId]
  );

  return result.rows.map(mapNoteRevision);
}

export async function updateNoteDocument({
  meetingId,
  ownerUserId,
  expectedVersion,
  contentJson,
  contentText,
  editedBy
}: {
  meetingId: string;
  ownerUserId: string;
  expectedVersion: number;
  contentJson: NoteDocumentContent;
  contentText: string;
  editedBy: string;
}) {
  return withTransaction(async (client) => {
    const owned = await assertMeetingOwner(client, meetingId, ownerUserId);

    if (!owned) {
      return { status: "not_found" as const };
    }

    const updateResult = await client.query<NoteDocumentRow>(
      `
        UPDATE note_documents
        SET content_json = $2,
            content_text = $3,
            version = version + 1,
            last_edited_by = $4,
            last_edited_at = now(),
            updated_at = now()
        WHERE meeting_id = $1
          AND version = $5
        RETURNING *
      `,
      [meetingId, contentJson, contentText, editedBy, expectedVersion]
    );

    if (!updateResult.rows[0]) {
      const latest = await client.query(
        "SELECT version FROM note_documents WHERE meeting_id = $1",
        [meetingId]
      );

      return {
        status: "conflict" as const,
        latestVersion: latest.rows[0]?.version ?? null
      };
    }

    const document = mapNoteDocument(updateResult.rows[0]);

    await client.query(
      `
        INSERT INTO note_revisions (
          id,
          note_document_id,
          version,
          content_json,
          content_text,
          edited_by,
          change_source
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'user')
        ON CONFLICT (note_document_id, version) DO NOTHING
      `,
      [
        createServerId("rev"),
        document.id,
        document.version,
        contentJson,
        contentText,
        editedBy
      ]
    );

    return { status: "saved" as const, document };
  });
}

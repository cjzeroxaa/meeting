import { query, withTransaction } from "@/lib/server/db";
import { assertMeetingOwner } from "@/lib/server/meetings";
import { mapTranscriptSegment, type SegmentRow } from "@/lib/server/mappers";

export type TranscriptSegmentInput = {
  id: string;
  providerItemId?: string | null;
  sequenceIndex: number;
  startMs?: number | null;
  endMs?: number | null;
  rawText: string;
  isFinal: boolean;
};

export async function upsertTranscriptSegments({
  meetingId,
  ownerUserId,
  segments
}: {
  meetingId: string;
  ownerUserId: string;
  segments: TranscriptSegmentInput[];
}) {
  return withTransaction(async (client) => {
    const owned = await assertMeetingOwner(client, meetingId, ownerUserId);

    if (!owned) {
      return null;
    }

    const saved = [];

    for (const segment of segments) {
      const result = await client.query<SegmentRow>(
        `
          INSERT INTO transcript_segments (
            id,
            meeting_id,
            provider_item_id,
            sequence_index,
            start_ms,
            end_ms,
            raw_text,
            is_final
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (meeting_id, sequence_index)
          DO UPDATE SET
            provider_item_id = EXCLUDED.provider_item_id,
            start_ms = EXCLUDED.start_ms,
            end_ms = EXCLUDED.end_ms,
            raw_text = EXCLUDED.raw_text,
            is_final = EXCLUDED.is_final,
            updated_at = now()
          RETURNING *
        `,
        [
          segment.id,
          meetingId,
          segment.providerItemId ?? null,
          segment.sequenceIndex,
          segment.startMs ?? null,
          segment.endMs ?? null,
          segment.rawText,
          segment.isFinal
        ]
      );

      saved.push(mapTranscriptSegment(result.rows[0]));
    }

    return saved;
  });
}

export async function editTranscriptSegment({
  meetingId,
  segmentId,
  ownerUserId,
  editedText
}: {
  meetingId: string;
  segmentId: string;
  ownerUserId: string;
  editedText: string | null;
}) {
  const result = await query<SegmentRow>(
    `
      UPDATE transcript_segments
      SET edited_text = $4,
          updated_at = now()
      FROM meetings
      WHERE transcript_segments.id = $1
        AND transcript_segments.meeting_id = $2
        AND meetings.id = transcript_segments.meeting_id
        AND meetings.owner_user_id = $3
        AND meetings.deleted_at IS NULL
      RETURNING transcript_segments.*
    `,
    [segmentId, meetingId, ownerUserId, editedText]
  );

  return result.rows[0] ? mapTranscriptSegment(result.rows[0]) : null;
}

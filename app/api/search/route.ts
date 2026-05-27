import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { jsonError, jsonRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

    if (!q) {
      return NextResponse.json({ items: [] });
    }

    const result = await query(
      `
        SELECT DISTINCT ON (meetings.id)
          meetings.id,
          meetings.title,
          meetings.status,
          meetings.duration_seconds,
          meetings.created_at,
          meetings.updated_at,
          CASE
            WHEN meetings.title ILIKE $2 THEN 'title'
            WHEN note_documents.content_text ILIKE $2 THEN 'note'
            ELSE 'transcript'
          END AS match_type,
          CASE
            WHEN note_documents.content_text ILIKE $2 THEN left(note_documents.content_text, 180)
            ELSE left(COALESCE(transcript_segments.edited_text, transcript_segments.raw_text, ''), 180)
          END AS snippet
        FROM meetings
        LEFT JOIN note_documents ON note_documents.meeting_id = meetings.id
        LEFT JOIN transcript_segments ON transcript_segments.meeting_id = meetings.id
        WHERE meetings.owner_user_id = $1
          AND meetings.deleted_at IS NULL
          AND (
            meetings.title ILIKE $2
            OR note_documents.content_text ILIKE $2
            OR transcript_segments.raw_text ILIKE $2
            OR transcript_segments.edited_text ILIKE $2
          )
        ORDER BY meetings.id, meetings.updated_at DESC
        LIMIT 30
      `,
      [user.id, `%${q}%`]
    );

    return NextResponse.json({
      items: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        matchType: row.match_type,
        snippet: row.snippet
      }))
    });
  } catch (error) {
    return jsonRouteError(error, "search_failed", "Could not search meetings.");
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import {
  asBoolean,
  asNumber,
  asString,
  isRecord,
  jsonError,
  jsonRouteError,
  readJson
} from "@/lib/server/http";
import { upsertTranscriptSegments } from "@/lib/server/transcripts";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const body = await readJson(request);

    if (!isRecord(body) || !Array.isArray(body.segments)) {
      return jsonError(400, "invalid_request", "segments must be an array.");
    }

    const segments = body.segments.map((segment) => {
      if (!isRecord(segment)) {
        throw new Error("invalid_segment");
      }

      return {
        id: asString(segment.id),
        providerItemId: asString(segment.providerItemId) || null,
        sequenceIndex: asNumber(segment.sequenceIndex) ?? 0,
        startMs: asNumber(segment.startMs) ?? null,
        endMs: asNumber(segment.endMs) ?? null,
        rawText: asString(segment.rawText),
        isFinal: asBoolean(segment.isFinal) ?? true
      };
    });

    if (segments.some((segment) => !segment.id || !segment.rawText)) {
      return jsonError(400, "invalid_segment");
    }

    const savedSegments = await upsertTranscriptSegments({
      meetingId,
      ownerUserId: user.id,
      segments
    });

    if (!savedSegments) {
      return jsonError(404, "meeting_not_found", "Meeting not found.");
    }

    return NextResponse.json({ segments: savedSegments });
  } catch (error) {
    return jsonRouteError(error, "sync_segments_failed", "Could not sync transcript segments.");
  }
}

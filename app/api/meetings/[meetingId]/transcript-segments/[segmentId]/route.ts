import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { editTranscriptSegment } from "@/lib/server/transcripts";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string; segmentId: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId, segmentId } = await params;
    const body = await readJson(request);

    if (!isRecord(body)) {
      return jsonError(400, "invalid_request", "Request body must be JSON.");
    }

    const segment = await editTranscriptSegment({
      meetingId,
      segmentId,
      ownerUserId: user.id,
      editedText:
        body.editedText === null ? null : asString(body.editedText, "")
    });

    if (!segment) {
      return jsonError(404, "segment_not_found", "Transcript segment not found.");
    }

    return NextResponse.json({ segment });
  } catch (error) {
    return jsonRouteError(error, "edit_segment_failed", "Could not edit transcript segment.");
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asNumber, asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { stopMeeting } from "@/lib/server/meetings";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const body = await readJson(request);

    if (!isRecord(body)) {
      return jsonError(400, "invalid_request", "Request body must be JSON.");
    }

    const transcriptStatus = asString(body.transcriptStatus, "complete");

    if (!["complete", "partial", "failed"].includes(transcriptStatus)) {
      return jsonError(400, "invalid_transcript_status");
    }

    const meeting = await stopMeeting({
      meetingId,
      ownerUserId: user.id,
      endedAt: asString(body.endedAt, new Date().toISOString()),
      durationSeconds: asNumber(body.durationSeconds) ?? 0,
      transcriptStatus: transcriptStatus as "complete" | "partial" | "failed"
    });

    if (!meeting) {
      return jsonError(404, "meeting_not_found", "Meeting not found.");
    }

    return NextResponse.json({
      meetingId: meeting.id,
      status: meeting.status,
      transcriptStatus: meeting.transcriptStatus
    });
  } catch (error) {
    return jsonRouteError(error, "stop_meeting_failed", "Could not stop meeting.");
  }
}

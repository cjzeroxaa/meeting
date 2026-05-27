import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { startMeeting } from "@/lib/server/meetings";

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

    const meeting = await startMeeting({
      meetingId,
      ownerUserId: user.id,
      startedAt: asString(body.startedAt, new Date().toISOString())
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
    return jsonRouteError(error, "start_meeting_failed", "Could not start meeting.");
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { getMeetingDetail, updateMeetingTitle } from "@/lib/server/meetings";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const detail = await getMeetingDetail(meetingId, user.id);

    if (!detail) {
      return jsonError(404, "meeting_not_found", "Meeting not found.");
    }

    return NextResponse.json(detail);
  } catch (error) {
    return jsonRouteError(error, "get_meeting_failed", "Could not get meeting.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const body = await readJson(request);

    if (!isRecord(body)) {
      return jsonError(400, "invalid_request", "Request body must be JSON.");
    }

    const meeting = await updateMeetingTitle({
      meetingId,
      ownerUserId: user.id,
      title: asString(body.title, "Untitled meeting")
    });

    if (!meeting) {
      return jsonError(404, "meeting_not_found", "Meeting not found.");
    }

    return NextResponse.json({ meeting });
  } catch (error) {
    return jsonRouteError(error, "update_meeting_failed", "Could not update meeting.");
  }
}

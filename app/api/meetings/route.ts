import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asNumber, asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { createMeetingForUser, listMeetingsForUser } from "@/lib/server/meetings";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const limit = asNumber(request.nextUrl.searchParams.get("limit")) ?? 30;
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const result = await listMeetingsForUser({
      ownerUserId: user.id,
      limit,
      cursor
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonRouteError(error, "list_meetings_failed", "Could not list meetings.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);

    if (!isRecord(body)) {
      return jsonError(400, "invalid_request", "Request body must be JSON.");
    }

    const result = await createMeetingForUser({
      ownerUserId: user.id,
      title: asString(body.title, "Untitled meeting"),
      recordingMode: asString(body.recordingMode, "microphone_only")
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonRouteError(error, "create_meeting_failed", "Could not create meeting.");
  }
}

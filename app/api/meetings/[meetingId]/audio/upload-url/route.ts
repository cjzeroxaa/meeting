import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asNumber, asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { createAudioUploadTarget } from "@/lib/server/audio";

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

    const result = await createAudioUploadTarget({
      meetingId,
      ownerUserId: user.id,
      mimeType: asString(body.mimeType, "audio/webm"),
      sizeBytes: asNumber(body.sizeBytes) ?? null
    });

    if (!result) {
      return jsonError(404, "meeting_not_found", "Meeting not found.");
    }

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      uploadHeaders: result.uploadHeaders,
      objectPath: result.objectPath,
      expiresInSeconds: result.expiresInSeconds,
      audio: result.audio
    });
  } catch (error) {
    return jsonRouteError(error, "audio_upload_url_failed", "Could not create audio upload URL.");
  }
}

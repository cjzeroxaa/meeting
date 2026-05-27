import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asNumber, asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { completeAudioUpload } from "@/lib/server/audio";

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

    const audio = await completeAudioUpload({
      meetingId,
      ownerUserId: user.id,
      objectPath: asString(body.objectPath),
      sizeBytes: asNumber(body.sizeBytes) ?? null,
      durationSeconds: asNumber(body.durationSeconds) ?? null,
      mimeType: asString(body.mimeType, "audio/webm")
    });

    if (!audio) {
      return jsonError(404, "audio_asset_not_found", "Audio asset not found.");
    }

    return NextResponse.json({ audioStatus: audio.status, audio });
  } catch (error) {
    return jsonRouteError(error, "audio_complete_failed", "Could not complete audio upload.");
  }
}

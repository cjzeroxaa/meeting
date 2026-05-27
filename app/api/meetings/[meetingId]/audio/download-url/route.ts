import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { createAudioDownloadTarget } from "@/lib/server/audio";
import { jsonError, jsonRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const result = await createAudioDownloadTarget({
      meetingId,
      ownerUserId: user.id
    });

    if (!result) {
      return jsonError(404, "audio_asset_not_found", "Audio asset not found.");
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonRouteError(
      error,
      "audio_download_url_failed",
      "Could not create audio download URL."
    );
  }
}

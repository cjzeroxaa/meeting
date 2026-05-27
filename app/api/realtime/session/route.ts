import { type NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser } from "@/lib/server/auth";
import { asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { getOwnedMeeting } from "@/lib/server/meetings";

const OPENAI_REALTIME_CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

export const runtime = "nodejs";

function createSafetyIdentifier(userId: string) {
  const salt = process.env.MEETING_AUTH_SECRET || "meeting-v2";
  const digest = createHash("sha256")
    .update(`${salt}:${userId}`)
    .digest("hex");

  return `meeting_user_${digest.slice(0, 48)}`;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);

    if (!isRecord(body)) {
      return jsonError(400, "invalid_request", "Request body must be JSON.");
    }

    const meetingId = asString(body.meetingId);

    if (!meetingId) {
      return jsonError(400, "meeting_id_required");
    }

    const meeting = await getOwnedMeeting(meetingId, user.id);

    if (!meeting) {
      return jsonError(404, "meeting_not_found", "Meeting not found.");
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return jsonError(
        503,
        "openai_key_missing",
        "OPENAI_API_KEY is not configured."
      );
    }

    const response = await fetch(OPENAI_REALTIME_CLIENT_SECRET_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": createSafetyIdentifier(user.id)
      },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              turn_detection: null,
              transcription: {
                model: "gpt-realtime-whisper",
                language: "en",
                delay: "low"
              }
            }
          }
        }
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Failed to create OpenAI realtime client secret.",
          details: payload
        },
        { status: response.status }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    return jsonRouteError(error, "realtime_session_failed", "Could not create realtime session.");
  }
}

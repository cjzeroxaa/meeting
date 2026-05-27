import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateInternalUser,
  createSessionCookie
} from "@/lib/server/auth";
import { asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);

    if (!isRecord(body)) {
      return jsonError(400, "invalid_request", "Request body must be JSON.");
    }

    const user = await authenticateInternalUser(asString(body.password));
    const response = NextResponse.json({ user });
    response.headers.set("Set-Cookie", createSessionCookie(user));

    return response;
  } catch (error) {
    return jsonRouteError(error, "login_failed", "Could not sign in.");
  }
}

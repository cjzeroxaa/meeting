import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { jsonRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);

    return NextResponse.json({ user });
  } catch (error) {
    return jsonRouteError(error, "current_user_failed", "Could not get current user.");
  }
}

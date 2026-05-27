import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());

  return response;
}

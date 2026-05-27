import { NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/errors";

export function jsonError(
  status: number,
  error: string,
  message = error,
  details?: unknown
) {
  return NextResponse.json({ error, message, details }, { status });
}

export function jsonRouteError(
  error: unknown,
  fallbackError: string,
  fallbackMessage = fallbackError,
  status = 500
) {
  if (isAuthError(error)) {
    return jsonError(error.status, error.code, error.message);
  }

  return jsonError(
    status,
    fallbackError,
    fallbackMessage,
    error instanceof Error ? error.message : undefined
  );
}

export async function readJson(request: Request) {
  return request.json().catch(() => null);
}

export function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

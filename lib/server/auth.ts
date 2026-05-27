import { type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { query } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";

export type CurrentUser = {
  id: string;
  email: string | null;
  name: string | null;
};

const SESSION_COOKIE_NAME = "meeting_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  id: string;
  email: string | null;
  name: string | null;
  exp: number;
};

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);

  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function getAuthSecret() {
  return process.env.MEETING_AUTH_SECRET?.trim() || "";
}

function signValue(value: string) {
  const secret = getAuthSecret();

  if (!secret) {
    throw new AuthError("MEETING_AUTH_SECRET is not configured.");
  }

  return base64UrlEncode(createHmac("sha256", secret).update(value).digest());
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookieUser(request: NextRequest): CurrentUser | null {
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
      return null;
    }

    const [payloadValue, signature] = token.split(".");

    if (!payloadValue || !signature || !safeEqual(signature, signValue(payloadValue))) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(payloadValue)) as SessionPayload;

    if (!payload.id || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      id: payload.id,
      email: payload.email ?? null,
      name: payload.name ?? null
    };
  } catch {
    return null;
  }
}

function shouldTrustHeaderAuth() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.MEETING_TRUSTED_AUTH_HEADERS === "1"
  );
}

function getHeaderUser(request: NextRequest): CurrentUser | null {
  if (!shouldTrustHeaderAuth()) {
    return null;
  }

  const id = request.headers.get("x-user-id")?.trim();

  if (!id) {
    return null;
  }

  return {
    id,
    email: request.headers.get("x-user-email")?.trim() || null,
    name: request.headers.get("x-user-name")?.trim() || null
  };
}

function getDevUser(): CurrentUser | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return {
    id: process.env.MEETING_DEV_USER_ID?.trim() || "dev_user",
    email: process.env.MEETING_DEV_USER_EMAIL?.trim() || null,
    name: process.env.MEETING_DEV_USER_NAME?.trim() || null
  };
}

async function upsertUser(user: CurrentUser) {
  await query(
    `
      INSERT INTO users (id, email, name, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (id)
      DO UPDATE SET
        email = COALESCE(EXCLUDED.email, users.email),
        name = COALESCE(EXCLUDED.name, users.name),
        updated_at = now()
    `,
    [user.id, user.email, user.name]
  );
}

export async function requireUser(request: NextRequest): Promise<CurrentUser> {
  const user = getHeaderUser(request) ?? getCookieUser(request) ?? getDevUser();

  if (!user) {
    throw new AuthError();
  }

  await upsertUser(user);

  return user;
}

export async function authenticateInternalUser(password: string) {
  const expectedPassword = process.env.MEETING_INTERNAL_PASSWORD?.trim();

  if (!expectedPassword || !getAuthSecret()) {
    throw new AuthError("Internal password authentication is not configured.");
  }

  if (!safeEqual(password, expectedPassword)) {
    throw new AuthError("Invalid password.");
  }

  const user: CurrentUser = {
    id: process.env.MEETING_INTERNAL_USER_ID?.trim() || "internal_user",
    email: process.env.MEETING_INTERNAL_USER_EMAIL?.trim() || null,
    name: process.env.MEETING_INTERNAL_USER_NAME?.trim() || "Internal User"
  };

  await upsertUser(user);

  return user;
}

export function createSessionCookie(user: CurrentUser) {
  const payload = base64UrlEncode(
    JSON.stringify({
      ...user,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
    } satisfies SessionPayload)
  );
  const token = `${payload}.${signValue(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";

  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS};${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";

  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;
}

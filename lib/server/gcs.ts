import { createHash } from "crypto";
import { GoogleAuth } from "google-auth-library";

const STORAGE_HOST = "storage.googleapis.com";
const SIGNING_SCOPE_REGION = "auto";
const SIGNING_SERVICE = "storage";
const SIGNING_REQUEST_TYPE = "goog4_request";

function encodePathSegment(segment: string) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeQueryValue(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function hashHex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toTimestamp(date: Date) {
  return date
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "")
    .replace("Z", "Z");
}

function toDateStamp(timestamp: string) {
  return timestamp.slice(0, 8);
}

function objectCanonicalUri(bucketName: string, objectPath: string) {
  return `/${encodePathSegment(bucketName)}/${objectPath
    .split("/")
    .map(encodePathSegment)
    .join("/")}`;
}

async function signBlob(serviceAccountEmail: string, value: string) {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = tokenResponse.token;

  if (!accessToken) {
    throw new Error("Could not obtain Google access token for URL signing.");
  }

  const response = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
      serviceAccountEmail
    )}:signBlob`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        payload: Buffer.from(value).toString("base64")
      })
    }
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok || typeof payload?.signedBlob !== "string") {
    throw new Error(
      `Could not sign Cloud Storage URL: ${
        payload?.error?.message ?? response.status
      }`
    );
  }

  return Buffer.from(payload.signedBlob, "base64").toString("hex");
}

export async function createSignedUploadUrl({
  bucketName,
  objectPath,
  contentType,
  expiresInSeconds = 900
}: {
  bucketName: string;
  objectPath: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const serviceAccountEmail = process.env.GCS_SIGNING_SERVICE_ACCOUNT;

  if (!serviceAccountEmail) {
    throw new Error("GCS_SIGNING_SERVICE_ACCOUNT is not configured.");
  }

  const now = new Date();
  const timestamp = toTimestamp(now);
  const dateStamp = toDateStamp(timestamp);
  const credentialScope = `${dateStamp}/${SIGNING_SCOPE_REGION}/${SIGNING_SERVICE}/${SIGNING_REQUEST_TYPE}`;
  const credential = `${serviceAccountEmail}/${credentialScope}`;
  const signedHeaders = "content-type;host";
  const canonicalUri = objectCanonicalUri(bucketName, objectPath);
  const canonicalQuery = [
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", credential],
    ["X-Goog-Date", timestamp],
    ["X-Goog-Expires", String(expiresInSeconds)],
    ["X-Goog-SignedHeaders", signedHeaders]
  ]
    .map(([key, value]) => `${key}=${encodeQueryValue(value)}`)
    .join("&");
  const canonicalHeaders = `content-type:${contentType}\nhost:${STORAGE_HOST}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    timestamp,
    credentialScope,
    hashHex(canonicalRequest)
  ].join("\n");
  const signature = await signBlob(serviceAccountEmail, stringToSign);

  return {
    uploadUrl: `https://${STORAGE_HOST}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`,
    uploadHeaders: {
      "Content-Type": contentType
    },
    expiresInSeconds
  };
}

export async function createSignedDownloadUrl({
  bucketName,
  objectPath,
  expiresInSeconds = 900
}: {
  bucketName: string;
  objectPath: string;
  expiresInSeconds?: number;
}) {
  const serviceAccountEmail = process.env.GCS_SIGNING_SERVICE_ACCOUNT;

  if (!serviceAccountEmail) {
    throw new Error("GCS_SIGNING_SERVICE_ACCOUNT is not configured.");
  }

  const now = new Date();
  const timestamp = toTimestamp(now);
  const dateStamp = toDateStamp(timestamp);
  const credentialScope = `${dateStamp}/${SIGNING_SCOPE_REGION}/${SIGNING_SERVICE}/${SIGNING_REQUEST_TYPE}`;
  const credential = `${serviceAccountEmail}/${credentialScope}`;
  const signedHeaders = "host";
  const canonicalUri = objectCanonicalUri(bucketName, objectPath);
  const canonicalQuery = [
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", credential],
    ["X-Goog-Date", timestamp],
    ["X-Goog-Expires", String(expiresInSeconds)],
    ["X-Goog-SignedHeaders", signedHeaders]
  ]
    .map(([key, value]) => `${key}=${encodeQueryValue(value)}`)
    .join("&");
  const canonicalHeaders = `host:${STORAGE_HOST}\n`;
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    timestamp,
    credentialScope,
    hashHex(canonicalRequest)
  ].join("\n");
  const signature = await signBlob(serviceAccountEmail, stringToSign);

  return {
    downloadUrl: `https://${STORAGE_HOST}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`,
    expiresInSeconds
  };
}

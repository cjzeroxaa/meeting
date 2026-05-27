import { query, withTransaction } from "@/lib/server/db";
import { createSignedDownloadUrl, createSignedUploadUrl } from "@/lib/server/gcs";
import { createServerId } from "@/lib/server/ids";
import { assertMeetingOwner } from "@/lib/server/meetings";
import { mapAudioAsset, type AudioAssetRow } from "@/lib/server/mappers";

const DEFAULT_AUDIO_MIME_TYPE = "audio/webm";

export async function createAudioUploadTarget({
  meetingId,
  ownerUserId,
  mimeType,
  sizeBytes
}: {
  meetingId: string;
  ownerUserId: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const target = await withTransaction(async (client) => {
    const owned = await assertMeetingOwner(client, meetingId, ownerUserId);

    if (!owned) {
      return null;
    }

    const bucketName = process.env.AUDIO_BUCKET_NAME;
    const contentType = mimeType || DEFAULT_AUDIO_MIME_TYPE;

    if (!bucketName) {
      throw new Error("AUDIO_BUCKET_NAME is not configured.");
    }

    const objectPath = `users/${ownerUserId}/meetings/${meetingId}/audio.webm`;

    const result = await client.query<AudioAssetRow>(
      `
        INSERT INTO audio_assets (
          id,
          meeting_id,
          bucket_name,
          object_path,
          mime_type,
          size_bytes,
          upload_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        ON CONFLICT (meeting_id)
        DO UPDATE SET
          bucket_name = EXCLUDED.bucket_name,
          object_path = EXCLUDED.object_path,
          mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes,
          upload_status = 'pending',
          updated_at = now()
        RETURNING *
      `,
      [
        createServerId("aud"),
        meetingId,
        bucketName,
        objectPath,
        contentType,
        sizeBytes ?? null
      ]
    );

    await client.query(
      `
        UPDATE meetings
        SET audio_status = 'uploading',
            updated_at = now()
        WHERE id = $1
      `,
      [meetingId]
    );

    return {
      audio: mapAudioAsset(result.rows[0]),
      bucketName,
      objectPath,
      contentType
    };
  });

  if (!target) {
    return null;
  }

  const upload = await createSignedUploadUrl({
    bucketName: target.bucketName,
    objectPath: target.objectPath,
    contentType: target.contentType
  });

  return {
    audio: target.audio,
    uploadUrl: upload.uploadUrl,
    uploadHeaders: upload.uploadHeaders,
    objectPath: target.objectPath,
    expiresInSeconds: upload.expiresInSeconds
  };
}

export async function completeAudioUpload({
  meetingId,
  ownerUserId,
  objectPath,
  sizeBytes,
  durationSeconds,
  mimeType
}: {
  meetingId: string;
  ownerUserId: string;
  objectPath: string;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  mimeType?: string | null;
}) {
  const result = await query<AudioAssetRow>(
    `
      UPDATE audio_assets
      SET size_bytes = COALESCE($4, audio_assets.size_bytes),
          duration_seconds = COALESCE($5, audio_assets.duration_seconds),
          mime_type = COALESCE($6, audio_assets.mime_type),
          upload_status = 'uploaded',
          updated_at = now()
      FROM meetings
      WHERE audio_assets.meeting_id = $1
        AND meetings.id = audio_assets.meeting_id
        AND meetings.owner_user_id = $2
        AND meetings.deleted_at IS NULL
        AND audio_assets.object_path = $3
      RETURNING audio_assets.*
    `,
    [meetingId, ownerUserId, objectPath, sizeBytes ?? null, durationSeconds ?? null, mimeType ?? null]
  );

  if (!result.rows[0]) {
    return null;
  }

  await query(
    `
      UPDATE meetings
      SET audio_status = 'uploaded',
          updated_at = now()
      WHERE id = $1
        AND owner_user_id = $2
    `,
    [meetingId, ownerUserId]
  );

  return mapAudioAsset(result.rows[0]);
}

export async function failAudioUpload({
  meetingId,
  ownerUserId,
  objectPath
}: {
  meetingId: string;
  ownerUserId: string;
  objectPath?: string | null;
}) {
  const result = await query<AudioAssetRow>(
    `
      UPDATE audio_assets
      SET upload_status = 'failed',
          updated_at = now()
      FROM meetings
      WHERE audio_assets.meeting_id = $1
        AND meetings.id = audio_assets.meeting_id
        AND meetings.owner_user_id = $2
        AND meetings.deleted_at IS NULL
        AND ($3::text IS NULL OR audio_assets.object_path = $3)
      RETURNING audio_assets.*
    `,
    [meetingId, ownerUserId, objectPath ?? null]
  );

  if (!result.rows[0]) {
    return null;
  }

  await query(
    `
      UPDATE meetings
      SET audio_status = 'failed',
          updated_at = now()
      WHERE id = $1
        AND owner_user_id = $2
    `,
    [meetingId, ownerUserId]
  );

  return mapAudioAsset(result.rows[0]);
}

export async function createAudioDownloadTarget({
  meetingId,
  ownerUserId
}: {
  meetingId: string;
  ownerUserId: string;
}) {
  const result = await query<AudioAssetRow>(
    `
      SELECT audio_assets.*
      FROM audio_assets
      JOIN meetings ON meetings.id = audio_assets.meeting_id
      WHERE audio_assets.meeting_id = $1
        AND meetings.owner_user_id = $2
        AND meetings.deleted_at IS NULL
        AND audio_assets.upload_status = 'uploaded'
    `,
    [meetingId, ownerUserId]
  );

  const audio = result.rows[0];

  if (!audio) {
    return null;
  }

  const signed = await createSignedDownloadUrl({
    bucketName: audio.bucket_name,
    objectPath: audio.object_path
  });

  return {
    audio: mapAudioAsset(audio),
    downloadUrl: signed.downloadUrl,
    expiresInSeconds: signed.expiresInSeconds
  };
}

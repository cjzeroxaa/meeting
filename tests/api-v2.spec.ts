import { expect, test } from "@playwright/test";

const userId = `api_user_${Date.now()}`;
const headers = {
  "x-user-id": userId,
  "x-user-email": `${userId}@example.com`,
  "x-user-name": "API Test User"
};

test("v2 backend meeting lifecycle uses postgres", async ({ request }) => {
  const createResponse = await request.post("/api/meetings", {
    headers,
    data: {
      title: "Customer Interview API",
      recordingMode: "microphone_only"
    }
  });
  expect(createResponse.status()).toBe(201);

  const created = await createResponse.json();
  const meetingId = created.meeting.id as string;
  const noteVersion = created.noteDocument.version as number;

  expect(created.meeting.status).toBe("draft");
  expect(created.noteDocument.contentJson.type).toBe("doc");

  const startResponse = await request.post(`/api/meetings/${meetingId}/start`, {
    headers,
    data: { startedAt: "2026-05-27T18:00:00.000Z" }
  });
  expect(startResponse.status()).toBe(200);
  await expect(startResponse).toBeOK();
  expect((await startResponse.json()).status).toBe("recording");

  const batchResponse = await request.post(
    `/api/meetings/${meetingId}/transcript-segments/batch`,
    {
      headers,
      data: {
        segments: [
          {
            id: `seg_${meetingId}_0`,
            providerItemId: "item_abc:0",
            sequenceIndex: 0,
            startMs: 0,
            endMs: 4200,
            rawText: "Hello from the API test.",
            isFinal: true
          }
        ]
      }
    }
  );
  expect(batchResponse.status()).toBe(200);
  const batch = await batchResponse.json();
  expect(batch.segments[0].rawText).toBe("Hello from the API test.");

  const editResponse = await request.patch(
    `/api/meetings/${meetingId}/transcript-segments/${batch.segments[0].id}`,
    {
      headers,
      data: { editedText: "Hello from the edited transcript." }
    }
  );
  expect(editResponse.status()).toBe(200);
  expect((await editResponse.json()).segment.text).toBe(
    "Hello from the edited transcript."
  );

  const noteResponse = await request.patch(
    `/api/meetings/${meetingId}/note-document`,
    {
      headers,
      data: {
        expectedVersion: noteVersion,
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Customer API note" }]
            }
          ]
        },
        contentText: "Customer API note"
      }
    }
  );
  expect(noteResponse.status()).toBe(200);
  expect((await noteResponse.json()).version).toBe(noteVersion + 1);

  const conflictResponse = await request.patch(
    `/api/meetings/${meetingId}/note-document`,
    {
      headers,
      data: {
        expectedVersion: noteVersion,
        contentJson: { type: "doc", content: [] },
        contentText: ""
      }
    }
  );
  expect(conflictResponse.status()).toBe(409);
  expect((await conflictResponse.json()).error).toBe("version_conflict");

  const audioBytes = Buffer.from("api v2 audio bytes");
  const uploadResponse = await request.post(
    `/api/meetings/${meetingId}/audio/upload-url`,
    {
      headers,
      data: { mimeType: "audio/webm", sizeBytes: audioBytes.length }
    }
  );
  expect(uploadResponse.status()).toBe(200);
  const upload = await uploadResponse.json();
  expect(upload.uploadUrl).toContain("https://storage.googleapis.com/");
  expect(upload.uploadHeaders["Content-Type"]).toBe("audio/webm");
  expect(upload.objectPath).toContain(meetingId);

  const badCompleteResponse = await request.post(
    `/api/meetings/${meetingId}/audio/complete`,
    {
      headers,
      data: {
        objectPath: `users/${userId}/meetings/${meetingId}/wrong.webm`,
        sizeBytes: audioBytes.length,
        durationSeconds: 12,
        mimeType: "audio/webm"
      }
    }
  );
  expect(badCompleteResponse.status()).toBe(404);

  const putResponse = await request.put(upload.uploadUrl, {
    headers: upload.uploadHeaders,
    data: audioBytes
  });
  expect(putResponse.status()).toBe(200);

  const completeAudioResponse = await request.post(
    `/api/meetings/${meetingId}/audio/complete`,
    {
      headers,
      data: {
        objectPath: upload.objectPath,
        sizeBytes: audioBytes.length,
        durationSeconds: 12,
        mimeType: "audio/webm"
      }
    }
  );
  expect(completeAudioResponse.status()).toBe(200);
  expect((await completeAudioResponse.json()).audioStatus).toBe("uploaded");

  const downloadResponse = await request.post(
    `/api/meetings/${meetingId}/audio/download-url`,
    { headers }
  );
  expect(downloadResponse.status()).toBe(200);
  const download = await downloadResponse.json();
  expect(download.downloadUrl).toContain("https://storage.googleapis.com/");

  const audioDownload = await request.get(download.downloadUrl);
  expect(audioDownload.status()).toBe(200);
  expect(await audioDownload.body()).toEqual(audioBytes);

  const otherUserDownloadResponse = await request.post(
    `/api/meetings/${meetingId}/audio/download-url`,
    {
      headers: {
        "x-user-id": `${userId}_other`
      }
    }
  );
  expect(otherUserDownloadResponse.status()).toBe(404);

  const stopResponse = await request.post(`/api/meetings/${meetingId}/stop`, {
    headers,
    data: {
      endedAt: "2026-05-27T18:01:00.000Z",
      durationSeconds: 60,
      transcriptStatus: "complete"
    }
  });
  expect(stopResponse.status()).toBe(200);
  expect((await stopResponse.json()).status).toBe("saved");

  const revisionsResponse = await request.get(
    `/api/meetings/${meetingId}/note-document/revisions`,
    { headers }
  );
  expect(revisionsResponse.status()).toBe(200);
  const revisions = await revisionsResponse.json();
  expect(
    revisions.revisions.some(
      (revision: { changeSource: string }) =>
        revision.changeSource === "recording_stop"
    )
  ).toBe(true);

  const detailResponse = await request.get(`/api/meetings/${meetingId}`, {
    headers
  });
  expect(detailResponse.status()).toBe(200);
  const detail = await detailResponse.json();
  expect(detail.meeting.audioStatus).toBe("uploaded");
  expect(detail.transcriptSegments[0].editedText).toBe(
    "Hello from the edited transcript."
  );

  const searchResponse = await request.get("/api/search?q=Customer%20API", {
    headers
  });
  expect(searchResponse.status()).toBe(200);
  const search = await searchResponse.json();
  expect(search.items.some((item: { id: string }) => item.id === meetingId)).toBe(
    true
  );
});

test("v2 backend can mark audio upload failed for retry", async ({ request }) => {
  const createResponse = await request.post("/api/meetings", {
    headers,
    data: {
      title: "Audio Failure API",
      recordingMode: "microphone_only"
    }
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();
  const meetingId = created.meeting.id as string;

  const uploadResponse = await request.post(
    `/api/meetings/${meetingId}/audio/upload-url`,
    {
      headers,
      data: { mimeType: "audio/webm", sizeBytes: 99 }
    }
  );
  expect(uploadResponse.status()).toBe(200);
  const upload = await uploadResponse.json();

  const failedResponse = await request.post(
    `/api/meetings/${meetingId}/audio/failed`,
    {
      headers,
      data: { objectPath: upload.objectPath }
    }
  );
  expect(failedResponse.status()).toBe(200);
  expect((await failedResponse.json()).audioStatus).toBe("failed");

  const detailResponse = await request.get(`/api/meetings/${meetingId}`, {
    headers
  });
  expect(detailResponse.status()).toBe(200);
  const detail = await detailResponse.json();
  expect(detail.meeting.audioStatus).toBe("failed");
  expect(detail.audio.status).toBe("failed");

  const retryResponse = await request.post(
    `/api/meetings/${meetingId}/audio/upload-url`,
    {
      headers,
      data: { mimeType: "audio/webm", sizeBytes: 100 }
    }
  );
  expect(retryResponse.status()).toBe(200);
  expect((await retryResponse.json()).audio.status).toBe("pending");
});

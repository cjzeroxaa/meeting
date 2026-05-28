import { expect, test } from "@playwright/test";

const MOCK_TRANSCRIPT_SEGMENTS_LENGTH = 4;

test("real UI creates and renames a backend meeting", async ({
  page,
  request
}) => {
  const title = `Backend Sync ${Date.now()}`;

  await page.goto("/");
  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("meeting-title-input").fill(title);

  await expect(page.getByTestId("meeting-list")).toContainText(title);

  await expect
    .poll(async () => {
      const searchResponse = await request.get(
        `/api/search?q=${encodeURIComponent(title)}`
      );
      expect(searchResponse.status()).toBe(200);
      const search = await searchResponse.json();

      return search.items.some((item: { title: string }) => item.title === title);
    })
    .toBe(true);
});

test("sidebar meeting titles stay on one line", async ({ page }) => {
  const title = `Cloud Run Smoke ${Date.now()} with a very long sidebar title`;

  await page.goto("/?e2e=1");
  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("meeting-title-input").fill(title);

  const item = page
    .getByTestId("meeting-list")
    .locator(".sidebar-item")
    .filter({ hasText: title })
    .first();

  await expect(item).toBeVisible();

  const metrics = await item.evaluate((element) => {
    const span = element.querySelector("span");
    const rowStyle = window.getComputedStyle(element);
    const spanStyle = span ? window.getComputedStyle(span) : null;
    const rowRect = element.getBoundingClientRect();

    return {
      rowHeight: rowRect.height,
      rowWhiteSpace: rowStyle.whiteSpace,
      iconWidth: element.querySelector("svg")?.getBoundingClientRect().width,
      iconHeight: element.querySelector("svg")?.getBoundingClientRect().height,
      spanWhiteSpace: spanStyle?.whiteSpace,
      spanOverflow: spanStyle?.overflowX,
      spanTextOverflow: spanStyle?.textOverflow
    };
  });

  expect(metrics.rowHeight).toBeLessThanOrEqual(32);
  expect(metrics.rowWhiteSpace).toBe("nowrap");
  expect(metrics.iconWidth).toBe(16);
  expect(metrics.iconHeight).toBe(16);
  expect(metrics.spanWhiteSpace).toBe("nowrap");
  expect(metrics.spanOverflow).toBe("hidden");
  expect(metrics.spanTextOverflow).toBe("ellipsis");
});

test("sidebar can be collapsed and expanded", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto("/?e2e=1");

  const openMetrics = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]');
    const main = document.querySelector("main");

    return {
      sidebarLeft: sidebar?.getBoundingClientRect().left,
      mainMarginLeft: window.getComputedStyle(main as Element).marginLeft
    };
  });

  expect(openMetrics.sidebarLeft).toBe(0);
  expect(openMetrics.mainMarginLeft).toBe("240px");

  await page.getByTestId("sidebar-collapse-button").click();
  await expect(page.getByTestId("sidebar-expand-button")).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sidebar = document.querySelector('[data-testid="app-sidebar"]');
        return sidebar?.getBoundingClientRect().right ?? 999;
      })
    )
    .toBeLessThanOrEqual(1);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const main = document.querySelector("main");
        return window.getComputedStyle(main as Element).marginLeft;
      })
    )
    .toBe("0px");

  await page.getByTestId("sidebar-expand-button").click();
  await expect(page.getByTestId("sidebar-collapse-button")).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sidebar = document.querySelector('[data-testid="app-sidebar"]');
        return sidebar?.getBoundingClientRect().left ?? -999;
      })
    )
    .toBe(0);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const main = document.querySelector("main");
        return window.getComputedStyle(main as Element).marginLeft;
      })
    )
    .toBe("240px");
});

test("mobile layout uses a sidebar drawer without search or settings", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/?e2e=1");

  await expect(page.getByTestId("meeting-search-input")).toHaveCount(0);
  await expect(page.getByText("Settings")).toHaveCount(0);

  await expect
    .poll(async () =>
      page
        .getByTestId("app-sidebar")
        .evaluate((element) => element.getBoundingClientRect().right)
    )
    .toBeLessThanOrEqual(1);

  await page.getByTestId("mobile-sidebar-button").click();

  await expect
    .poll(async () =>
      page
        .getByTestId("app-sidebar")
        .evaluate((element) => element.getBoundingClientRect().left)
    )
    .toBe(0);
  await expect(page.getByTestId("sidebar-backdrop")).toBeVisible();

  const openMetrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(openMetrics.scrollWidth).toBeLessThanOrEqual(
    openMetrics.viewportWidth
  );

  await page.getByTestId("sidebar-collapse-button").click();

  await expect
    .poll(async () =>
      page
        .getByTestId("app-sidebar")
        .evaluate((element) => element.getBoundingClientRect().right)
    )
    .toBeLessThanOrEqual(1);
});

test("saved backend meetings autosave notes and transcript corrections", async ({
  page,
  request
}) => {
  const title = `Editable Backend ${Date.now()}`;
  const createResponse = await request.post("/api/meetings", {
    data: {
      title,
      recordingMode: "microphone_only"
    }
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();
  const meetingId = created.meeting.id as string;

  await request.post(`/api/meetings/${meetingId}/start`, {
    data: { startedAt: "2026-05-27T19:00:00.000Z" }
  });
  await request.post(`/api/meetings/${meetingId}/transcript-segments/batch`, {
    data: {
      segments: [
        {
          id: `seg_${meetingId}_0`,
          providerItemId: "item_editable:0",
          sequenceIndex: 0,
          startMs: 0,
          endMs: 3200,
          rawText: "Original transcript paragraph.",
          isFinal: true
        }
      ]
    }
  });
  await request.post(`/api/meetings/${meetingId}/stop`, {
    data: {
      endedAt: "2026-05-27T19:01:00.000Z",
      durationSeconds: 60,
      transcriptStatus: "complete"
    }
  });

  await page.goto("/");
  await page.getByTestId("meeting-list").getByText(title).click();
  await expect(page.getByTestId("summary-editor")).toBeVisible();
  await expect(page.getByText("Click to add summary...")).toBeVisible();
  await expect(page.getByText("Click to add action items...")).toBeVisible();
  await expect(page.getByText("Click to add notes...")).toBeVisible();

  await page.getByTestId("summary-editor").fill("Decision summary");
  await page.getByTestId("action-items-editor").fill("Follow up with Jane");
  await page.getByTestId("notes-editor").fill("Customer asked about pricing.");
  await expect(page.getByTestId("note-save-status")).toContainText("Saved", {
    timeout: 5000
  });

  const noteResponse = await request.get(
    `/api/meetings/${meetingId}/note-document`
  );
  expect(noteResponse.status()).toBe(200);
  const note = await noteResponse.json();
  expect(note.contentText).toContain("Decision summary");
  expect(note.contentText).toContain("Follow up with Jane");
  expect(note.contentText).toContain("Customer asked about pricing.");

  await page
    .getByTestId("transcript-segment-editor")
    .first()
    .fill("Corrected transcript paragraph.");
  await page.getByTestId("transcript-segment-editor").first().blur();

  await expect
    .poll(async () => {
      const detailResponse = await request.get(`/api/meetings/${meetingId}`);
      const detail = await detailResponse.json();

      return detail.transcriptSegments[0].editedText;
    })
    .toBe("Corrected transcript paragraph.");
});

test("transcript reads like document blocks with quiet timestamps", async ({
  page
}) => {
  await page.goto("/?e2e=1&mockMic=1&mockTranscription=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("live-transcript")).toContainText(
    "Action item: follow up with the customer tomorrow."
  );

  const blockCount = await page.getByTestId("transcript-segment").count();
  expect(blockCount).toBeGreaterThan(0);
  expect(blockCount).toBeLessThan(MOCK_TRANSCRIPT_SEGMENTS_LENGTH);

  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("transcript-timestamp")
          .first()
          .evaluate((element) => getComputedStyle(element).opacity)
      )
    )
    .toBe(0);

  await page.getByTestId("transcript-segment").first().hover();

  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("transcript-timestamp")
          .first()
          .evaluate((element) => getComputedStyle(element).opacity)
      )
    )
    .toBeGreaterThan(0.5);
});

test("user can record, see transcript, stop, and save meeting", async ({
  page
}) => {
  await page.goto("/?e2e=1&mockMic=1&mockTranscription=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("recording-status")).toContainText("Recording");
  await expect(page.getByTestId("recording-wave")).toBeVisible();
  await expect(page.getByTestId("recording-timer")).not.toContainText("00:00");
  await expect(page.getByTestId("live-transcript")).toContainText(
    "Hello, this is a test meeting."
  );

  await page.getByTestId("stop-recording-button").click();

  await expect(page.getByTestId("save-status")).toContainText("Meeting saved.");
  await expect(page.getByTestId("meeting-list")).toContainText(
    "Untitled meeting"
  );
  await expect(page.getByTestId("download-transcript-button")).toBeEnabled();
  await expect(page.getByTestId("download-audio-button")).toBeEnabled();
});

test("recording controls stay visible while live transcript follows the bottom", async ({
  page
}) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto("/?e2e=1&mockMic=1&mockTranscription=1&mockLongTranscription=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect
    .poll(async () => page.getByTestId("transcript-segment").count())
    .toBeGreaterThan(16);

  const metrics = await page.evaluate(() => {
    const controls = document.querySelector(
      '[data-testid="recording-controls"]'
    );
    const segments = Array.from(
      document.querySelectorAll('[data-testid="transcript-segment"]')
    );
    const controlsRect = controls?.getBoundingClientRect();
    const lastSegmentRect = segments.at(-1)?.getBoundingClientRect();

    return {
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      controlsTop: controlsRect?.top ?? -1,
      controlsBottom: controlsRect?.bottom ?? -1,
      lastSegmentBottom: lastSegmentRect?.bottom ?? -1
    };
  });

  expect(metrics.scrollY).toBeGreaterThan(0);
  expect(metrics.controlsTop).toBeGreaterThanOrEqual(0);
  expect(metrics.controlsBottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.lastSegmentBottom).toBeLessThanOrEqual(
    metrics.viewportHeight + 2
  );
});

test("shows a clear error when microphone permission is denied", async ({
  page
}) => {
  await page.goto("/?e2e=1&mockMicDenied=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("recording-status")).not.toContainText(
    "Recording"
  );
  await expect(page.getByTestId("mic-permission-error")).toContainText(
    "Microphone access is required"
  );
  await expect(page.getByTestId("recording-timer")).toContainText("00:00");
});

test("continues local recording when live transcription fails", async ({
  page
}) => {
  await page.goto("/?e2e=1&mockMic=1&mockTranscriptionFailure=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("recording-status")).toContainText("Recording");
  await expect(page.getByTestId("transcription-error")).toContainText(
    "Live transcription is unavailable"
  );
  await expect(page.getByTestId("recording-timer")).not.toContainText("00:00");

  await page.getByTestId("stop-recording-button").click();
  await expect(page.getByTestId("save-status")).toContainText("Meeting saved.");
  await expect(page.getByTestId("download-audio-button")).toBeEnabled();
});

test("accumulates realtime fragments when item ids are missing", async ({
  page
}) => {
  await page.goto("/?e2e=1&mockMic=1&mockRealtimeFragments=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("live-transcript")).toContainText(
    "Hello, this is a longer live transcript."
  );
  await expect(page.getByTestId("live-transcript")).toContainText(
    "It should keep previous text instead of replacing it."
  );
});

test("keeps realtime content indexes as separate transcript segments", async ({
  page
}) => {
  await page.goto(
    "/?e2e=1&mockMic=1&mockRealtimeContentIndexes=1&debugRealtime=1"
  );

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("live-transcript")).toContainText(
    "Opening context survives."
  );
  await expect(page.getByTestId("live-transcript")).toContainText(
    "Follow-up detail also remains."
  );
  await expect(page.getByTestId("realtime-debug-panel")).toContainText(
    "Completed"
  );
  await expect(page.getByTestId("realtime-debug-event-count")).toContainText(
    "4"
  );
  await expect(page.getByTestId("realtime-debug-segment-count")).toContainText(
    "2"
  );

  const debugSnapshot = await page.evaluate(() => {
    const debug = (
      window as typeof window & {
        __meetingRealtimeDebug?: {
          events: unknown[];
          segments: unknown[];
        };
      }
    ).__meetingRealtimeDebug;

    return {
      events: debug?.events.length ?? 0,
      segments: debug?.segments.length ?? 0,
      segmentTimes:
        debug?.segments.map((segment) => {
          const typed = segment as { startMs?: number };

          return typed.startMs;
        }) ?? []
    };
  });

  expect(debugSnapshot.events).toBe(4);
  expect(debugSnapshot.segments).toBe(2);
  expect(debugSnapshot.segmentTimes.every((time) => typeof time === "number")).toBe(
    true
  );
  expect(debugSnapshot.segmentTimes[1]).toBeGreaterThanOrEqual(
    debugSnapshot.segmentTimes[0] ?? 0
  );
});

test("auto-stops at the configured duration limit", async ({ page }) => {
  await page.goto(
    "/?e2e=1&mockMic=1&mockTranscription=1&maxDurationSeconds=3"
  );

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("recording-status")).toContainText("Recording");
  await expect(page.getByTestId("save-status")).toContainText(
    "Recording limit reached. Your meeting has been saved."
  );
});

test("meeting title can be edited and appears in history", async ({ page }) => {
  await page.goto("/?e2e=1&mockMic=1&mockTranscription=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();
  await expect(page.getByTestId("live-transcript")).toContainText(
    "Hello, this is a test meeting."
  );
  await page.getByTestId("stop-recording-button").click();

  await page.getByTestId("meeting-title-input").fill("Customer Interview Test");

  await expect(page.getByTestId("meeting-list")).toContainText(
    "Customer Interview Test"
  );
});

test("copy transcript shows confirmation", async ({ page }) => {
  await page.goto("/?e2e=1&mockMic=1&mockTranscription=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();
  await expect(page.getByTestId("live-transcript")).toContainText(
    "Hello, this is a test meeting."
  );
  await page.getByTestId("stop-recording-button").click();
  await page.getByTestId("copy-transcript-button").click();

  await expect(page.getByText("Transcript copied.")).toBeVisible();
});

test("unfinished recording can be recovered after refresh", async ({ page }) => {
  await page.goto("/?e2e=1&mockMic=1&mockTranscription=1");

  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("start-recording-button").click();
  await expect(page.getByTestId("live-transcript")).toContainText(
    "Hello, this is a test meeting."
  );

  await page.reload();

  await expect(page.getByTestId("recovery-callout")).toContainText(
    "We found an unfinished recording."
  );
  await page.getByTestId("recover-meeting-button").click();
  await expect(page.getByTestId("live-transcript")).toContainText(
    "Hello, this is a test meeting."
  );
});

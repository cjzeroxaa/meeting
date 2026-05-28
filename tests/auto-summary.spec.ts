import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream"
    ]
  }
});

test("finished recording auto-generates visible notes", async ({ page }) => {
  const title = `Auto Summary ${Date.now()}`;

  await page.goto("/?mockTranscription=1&mockSummary=1");
  await page.getByTestId("new-meeting-button").click();
  await page.getByTestId("meeting-title-input").fill(title);
  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("live-transcript")).toContainText(
    "Action item: follow up with the customer tomorrow."
  );

  await page.getByTestId("stop-recording-button").click();

  await expect(page.getByTestId("note-save-status")).toContainText(
    "Notes generated",
    { timeout: 15_000 }
  );
  await expect(page.getByTestId("summary-editor")).toContainText(
    `Generated summary for ${title}`
  );
  await expect(page.getByTestId("action-items-editor")).toContainText(
    "No explicit action items identified."
  );
  await expect(page.getByTestId("notes-editor")).toContainText(
    "Generated notes from transcript"
  );
});

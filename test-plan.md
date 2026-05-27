Yes. Below is a simple **browser-agent test pack** for your web app MVP. These are designed so an automated browser agent can click through the app and verify expected results.

I’m assuming your app has this basic flow:

```text
Home → New Meeting → Start Recording → Live Transcript → Stop → Saved Meeting
```

## 1. Add stable test selectors first

Browser agents are much more reliable if your app has `data-testid` attributes.

Add these to your UI:

```tsx
<button data-testid="new-meeting-button">New Meeting</button>

<select data-testid="mic-device-select" />

<button data-testid="start-recording-button">Start Recording</button>

<div data-testid="recording-status">Idle</div>

<div data-testid="recording-timer">00:00</div>

<div data-testid="live-transcript" />

<button data-testid="stop-recording-button">Stop Recording</button>

<div data-testid="save-status" />

<input data-testid="meeting-title-input" />

<div data-testid="meeting-list" />

<button data-testid="copy-transcript-button">Copy</button>

<button data-testid="download-transcript-button">Download Transcript</button>

<button data-testid="download-audio-button">Download Audio</button>

<div data-testid="mic-permission-error" />

<div data-testid="transcription-error" />
```

Avoid relying on button position, CSS class names, or exact layout. Browser agents should target text or `data-testid`.

---

# Simple Browser Agent Test Cases

## Test Case 1: Start and stop a basic meeting

### Goal

Verify that the user can start recording, see a live transcript, stop recording, and save the meeting.

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1.

Click "New Meeting".

Click "Start Recording".

Wait until the recording status says "Recording".

Wait until the timer is greater than 00:03.

Check that the live transcript contains the text:
"Hello, this is a test meeting."

Click "Stop Recording".

Check that the save status says "Saved".

Check that the meeting appears in the meeting list.
```

### Expected result

```text
- Recording starts successfully.
- Timer increments.
- Live transcript appears.
- Stop button works.
- Meeting is saved.
- Meeting appears in meeting history.
```

---

## Test Case 2: Mic permission denied

### Goal

Verify that the app handles microphone denial gracefully.

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMicDenied=1.

Click "New Meeting".

Click "Start Recording".

Check that the app does not start recording.

Check that a microphone permission error is shown.
```

### Expected result

```text
- Recording does not start.
- User sees a clear mic permission message.
- App does not crash.
- Timer remains at 00:00.
```

Suggested error text:

```text
Microphone access is required to record a meeting.
```

---

## Test Case 3: Transcription fails but local recording continues

### Goal

Verify the most important reliability rule: recording should continue even if live AI transcription fails.

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMic=1&mockTranscriptionFailure=1.

Click "New Meeting".

Click "Start Recording".

Wait until recording status says "Recording".

Check that a transcription error is shown.

Check that the timer continues past 00:05.

Click "Stop Recording".

Check that the meeting is saved.

Check that an audio recording is available.
```

### Expected result

```text
- App starts recording.
- Live transcription shows an error.
- Local recording continues.
- User can stop and save the meeting.
- Audio file is still available.
```

Suggested error text:

```text
Live transcription is unavailable, but recording is still active.
```

---

## Test Case 4: Stop button finalizes transcript and audio

### Goal

Verify that stopping a meeting finalizes both transcript and audio.

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1.

Click "New Meeting".

Click "Start Recording".

Wait for transcript text to appear.

Click "Stop Recording".

Check that recording status says "Stopped" or "Saved".

Check that the transcript is still visible.

Check that the "Download Transcript" button is enabled.

Check that the "Download Audio" button is enabled.
```

### Expected result

```text
- Recording stops cleanly.
- Transcript does not disappear.
- Transcript export is available.
- Audio export is available.
```

---

## Test Case 5: Meeting title can be edited

### Goal

Verify that the user can name a meeting after recording.

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1.

Click "New Meeting".

Click "Start Recording".

Wait 3 seconds.

Click "Stop Recording".

Find the meeting title input.

Type:
Customer Interview Test

Check that the meeting list contains:
Customer Interview Test
```

### Expected result

```text
- Title input works.
- Meeting title is persisted.
- Meeting list shows the updated title.
```

---

## Test Case 6: Transcript copy works

### Goal

Verify that users can copy transcript text.

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1.

Click "New Meeting".

Click "Start Recording".

Wait until transcript contains:
Hello, this is a test meeting.

Click "Stop Recording".

Click "Copy Transcript".

Check that the app shows a success message.
```

### Expected result

```text
- Copy button works.
- User sees confirmation.
```

Suggested success text:

```text
Transcript copied.
```

---

## Test Case 7: Meeting survives page refresh while recording

### Goal

Verify browser-local recovery.

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1.

Click "New Meeting".

Click "Start Recording".

Wait until timer is greater than 00:05.

Refresh the page.

Check whether the app shows a recoverable meeting warning.

Click "Recover Meeting".

Check that the previous transcript or recording draft is available.
```

### Expected result

```text
- App does not lose all meeting state.
- User can recover a draft meeting.
- Partial transcript or audio chunks are preserved.
```

Suggested recovery text:

```text
We found an unfinished recording.
```

---

## Test Case 8: 60-minute limit auto-stops

For real browser tests, do not actually wait 60 minutes. Add a test override.

Example:

```text
http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1&maxDurationSeconds=10
```

### Agent instruction

```text
Open the app at http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1&maxDurationSeconds=10.

Click "New Meeting".

Click "Start Recording".

Wait until the timer reaches 00:10.

Check that recording automatically stops.

Check that save status says "Saved".

Check that the app shows a message saying the recording limit was reached.
```

### Expected result

```text
- Recording auto-stops at the configured limit.
- Meeting is saved.
- User sees a clear message.
```

Suggested message:

```text
Recording limit reached. Your meeting has been saved.
```

---

# Recommended E2E Test Mode

To make browser-agent testing easy, add a test mode like this:

```text
?e2e=1
```

Then support these flags:

```text
?mockMic=1
?mockMicDenied=1
?mockTranscription=1
?mockTranscriptionFailure=1
?maxDurationSeconds=10
```

Example URLs:

```text
http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1
```

```text
http://localhost:3000?e2e=1&mockMicDenied=1
```

```text
http://localhost:3000?e2e=1&mockMic=1&mockTranscriptionFailure=1
```

This lets your browser agent test the product without needing a real mic, real OpenAI connection, or real 60-minute wait.

---

# Simple Mock Transcript

Use a deterministic transcript for tests:

```ts
const MOCK_TRANSCRIPT_SEGMENTS = [
  "Hello, this is a test meeting.",
  "We are testing the live transcript feature.",
  "The meeting recorder should save this transcript after recording stops.",
  "Action item: follow up with the customer tomorrow."
];
```

During E2E mode, emit one segment every second.

Expected transcript after 4 seconds:

```text
Hello, this is a test meeting.
We are testing the live transcript feature.
The meeting recorder should save this transcript after recording stops.
Action item: follow up with the customer tomorrow.
```

---

# Example Browser Agent Prompt

You can give your browser agent this:

```text
You are testing a web app called AI Meeting Recorder.

Open:
http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1

Test the happy path:
1. Start a new meeting.
2. Start recording.
3. Confirm the status changes to Recording.
4. Confirm the timer increments.
5. Confirm the live transcript contains "Hello, this is a test meeting."
6. Stop recording.
7. Confirm the meeting is saved.
8. Confirm transcript download is available.
9. Confirm audio download is available.

Report any failed step with the visible error message and the page state.
```

---

# Optional Playwright Test

If you are using Playwright, here is a simple starter test.

```ts
import { test, expect } from "@playwright/test";

test("user can record, see transcript, stop, and save meeting", async ({ page }) => {
  await page.goto("http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1");

  await page.getByTestId("new-meeting-button").click();

  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("recording-status")).toContainText("Recording");

  await expect(page.getByTestId("recording-timer")).not.toContainText("00:00");

  await expect(page.getByTestId("live-transcript")).toContainText(
    "Hello, this is a test meeting."
  );

  await page.getByTestId("stop-recording-button").click();

  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await expect(page.getByTestId("download-transcript-button")).toBeEnabled();

  await expect(page.getByTestId("download-audio-button")).toBeEnabled();
});
```

Mic permission denied test:

```ts
import { test, expect } from "@playwright/test";

test("shows error when microphone permission is denied", async ({ page }) => {
  await page.goto("http://localhost:3000?e2e=1&mockMicDenied=1");

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
```

Transcription failure test:

```ts
import { test, expect } from "@playwright/test";

test("continues local recording when transcription fails", async ({ page }) => {
  await page.goto(
    "http://localhost:3000?e2e=1&mockMic=1&mockTranscriptionFailure=1"
  );

  await page.getByTestId("new-meeting-button").click();

  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("recording-status")).toContainText("Recording");

  await expect(page.getByTestId("transcription-error")).toContainText(
    "Live transcription is unavailable"
  );

  await page.waitForTimeout(5000);

  await expect(page.getByTestId("recording-status")).toContainText("Recording");

  await page.getByTestId("stop-recording-button").click();

  await expect(page.getByTestId("save-status")).toContainText("Saved");
});
```

Auto-stop test:

```ts
import { test, expect } from "@playwright/test";

test("recording auto-stops at meeting duration limit", async ({ page }) => {
  await page.goto(
    "http://localhost:3000?e2e=1&mockMic=1&mockTranscription=1&maxDurationSeconds=10"
  );

  await page.getByTestId("new-meeting-button").click();

  await page.getByTestId("start-recording-button").click();

  await expect(page.getByTestId("recording-status")).toContainText("Recording");

  await page.waitForTimeout(12_000);

  await expect(page.getByTestId("recording-status")).not.toContainText(
    "Recording"
  );

  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await expect(page.getByText("Recording limit reached")).toBeVisible();
});
```

---

# The 5 most important tests for your MVP

Start with these:

```text
1. Happy path:
   Start recording → see transcript → stop → saved.

2. Mic denied:
   Permission denied → clear error → no recording.

3. Transcription failure:
   Recording continues even if AI transcript fails.

4. Auto-stop:
   Meeting ends at duration limit and saves.

5. Recovery:
   Refresh during recording → unfinished meeting can be recovered.
```

Those five tests cover the main product promise: **record reliably, show live transcript when possible, and do not lose the meeting.**


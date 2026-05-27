You’re right — for a **web app**, the design changes a lot. Drop the Electron/Desktop assumptions. The correct design is a **browser-first recorder + small backend + OpenAI Realtime transcription**.

The biggest shift is this:

> In a web app, your reliability boundary is the browser. You can request mic access, keep a screen wake lock, record chunks, and store data locally, but you cannot control the operating system as strongly as a desktop app.

## Corrected web-app architecture

```text
Browser Web App
├── React / Next.js UI
│   ├── Record / stop button
│   ├── 60-minute timer
│   ├── Mic permission state
│   ├── Audio level meter
│   ├── Live transcript panel
│   ├── Meeting history
│   └── Transcript search / copy / export
│
├── Browser Audio Layer
│   ├── getUserMedia microphone capture
│   ├── MediaRecorder local audio chunks
│   ├── WebRTC stream to OpenAI Realtime
│   └── Wake Lock request while recording
│
├── Browser Storage
│   ├── IndexedDB for draft meetings
│   ├── Audio chunks / blobs
│   ├── Transcript segments
│   └── Recovery state
│
├── Backend API
│   ├── Auth
│   ├── Create OpenAI ephemeral realtime token
│   ├── Usage limits
│   ├── Meeting metadata
│   └── Optional cloud backup
│
└── OpenAI
    ├── Realtime transcription for live transcript
    └── Optional post-meeting cleanup transcription
```

Use the browser’s `getUserMedia()` API to request microphone access, and remember that the browser must prompt the user for permission before opening the mic. ([MDN Web Docs][1]) Use `MediaRecorder` to record the captured `MediaStream` into chunks, since the MediaRecorder API is specifically designed to record media streams in web apps. ([MDN Web Docs][2])

## Recommended MVP stack

```text
Frontend:
  Next.js / React
  TypeScript
  Tailwind or shadcn/ui
  Zustand or Redux Toolkit
  Dexie.js wrapper over IndexedDB

Backend:
  Next.js API routes, Fastify, Express, or NestJS
  PostgreSQL for user + meeting metadata
  Redis for rate limits
  S3 / R2 / Supabase Storage only if cloud backup is enabled

AI:
  OpenAI Realtime API via WebRTC for live transcription
  Optional speech-to-text pass after meeting for cleaner final transcript

Browser APIs:
  navigator.mediaDevices.getUserMedia()
  MediaRecorder
  IndexedDB
  Screen Wake Lock API
  WebRTC
  Web Audio API for mic level meter
```

For OpenAI, do **not** put your normal OpenAI API key in the frontend. The browser should ask your backend for a short-lived client secret or ephemeral token, and your backend should create that token using your real API key. OpenAI’s WebRTC guide describes this server-minted ephemeral-token pattern for browser clients. ([OpenAI Developers][3])

## Recording flow

The web app should split the mic stream into two paths:

```text
Microphone
├── Path A: Local browser recording
│   └── MediaRecorder → audio chunks → IndexedDB
│
└── Path B: Live transcription
    └── WebRTC → OpenAI Realtime → transcript deltas
```

The critical rule is the same as before:

> Local recording must not depend on live transcription.

So the start flow should be:

```text
1. User clicks Record.
2. Browser requests mic permission.
3. App creates local meeting session in IndexedDB.
4. App starts MediaRecorder.
5. App requests Wake Lock.
6. App requests ephemeral OpenAI token from your backend.
7. App opens WebRTC connection to OpenAI.
8. Transcript deltas stream into the UI.
9. Audio chunks are saved locally every few seconds.
10. User stops or 60-minute timer auto-stops.
11. App finalizes transcript + recording.
12. App uploads/backs up only if product requires it.
```

Do **not** wait for the OpenAI connection before recording. Start `MediaRecorder` first.

## OpenAI realtime design

For the browser version, use **WebRTC**, not a raw WebSocket from the browser. OpenAI’s realtime docs recommend WebRTC for browser/mobile clients that directly capture audio, while WebSocket is better when a trusted server already receives raw audio. ([OpenAI Developers][4])

For transcription-only use, configure the realtime session as a transcription session. OpenAI’s realtime transcription docs say realtime transcription streams transcript deltas as audio arrives, and identify `gpt-realtime-whisper` as the low-latency streaming transcription model. ([OpenAI Developers][5])

Conceptually:

```text
Browser:
  get microphone stream
  create RTCPeerConnection
  add mic track
  create data channel for OpenAI events
  receive transcript deltas
  render provisional transcript
  replace with finalized transcript when complete

Backend:
  POST /api/realtime-token
  authenticate user
  check usage limits
  call OpenAI to create ephemeral client secret
  return ephemeral token to browser
```

Store transcript as segments, not one huge string:

```ts
type TranscriptSegment = {
  id: string;
  meetingId: string;
  providerItemId?: string;
  sequenceIndex: number;
  startMs?: number;
  endMs?: number;
  text: string;
  isFinal: boolean;
  createdAt: string;
  updatedAt: string;
};
```

OpenAI’s transcription events include incremental delta events and completed transcript events; the docs also warn that completion events from different turns may not arrive in strict order, so use `item_id` or your own segment IDs to reconcile transcript state. ([OpenAI Developers][5])

## Browser storage design

For a web app, “local recording” means **local to the browser**, not automatically a normal file on the user’s desktop.

Use IndexedDB for recoverable draft storage:

```text
IndexedDB
├── meetings
│   ├── id
│   ├── title
│   ├── startedAt
│   ├── endedAt
│   ├── status
│   ├── durationMs
│   └── uploadStatus
│
├── audio_chunks
│   ├── id
│   ├── meetingId
│   ├── sequenceIndex
│   ├── blob
│   ├── mimeType
│   └── createdAt
│
└── transcript_segments
    ├── id
    ├── meetingId
    ├── sequenceIndex
    ├── text
    ├── isFinal
    └── createdAt
```

IndexedDB is the right browser storage primitive here because it can persist structured data and larger objects such as audio/video blobs, while still supporting offline-capable web applications. ([MDN Web Docs][6]) But browser storage is not the same as a guaranteed filesystem; browsers have storage quotas and eviction rules, so for important meetings you should offer export, download, or optional cloud backup. ([MDN Web Docs][7])

## Wake lock behavior

Use the **Screen Wake Lock API**, but treat it as best-effort. It can help prevent the screen from dimming or locking while recording, but it is not equivalent to a native desktop sleep-prevention API. MDN describes the Screen Wake Lock API as a way to prevent devices from dimming or locking the screen when the app needs to keep running. ([MDN Web Docs][8])

Implementation behavior:

```text
On recording start:
  request wake lock

On tab visibility change:
  if recording and wake lock released:
    try to reacquire

On recording stop:
  release wake lock

If wake lock fails:
  continue recording
  show warning: “Keep this tab open during recording.”
```

This should be in your UX:

> “Keep this tab open while recording. Closing the tab or putting your device to sleep may stop recording.”

## Corrected MVP scope for web app

Your MVP should be:

```text
Must-have:
- Web record button
- Browser mic permission flow
- Audio device selector
- Mic level meter
- 60-minute recording timer
- MediaRecorder local audio chunks
- IndexedDB draft recovery
- OpenAI Realtime live transcription
- Transcript segment persistence
- Meeting history
- Copy transcript
- Download transcript as .txt / .md
- Download audio as .webm
- Clear warning for mic-only recording
```

Cut from the first MVP:

```text
Not yet:
- Desktop sleep prevention
- True system audio capture
- Speaker diarization
- Bot joining
- Calendar integration
- Team collaboration
- Full Notion-style docs workspace
- Automatic action items
- Long-meeting support
```

## Important limitation: mic-only web capture

Your current MVP says microphone-based transcription. For a web app, this limitation is even more important.

If the user joins a Zoom/Meet/Teams call with headphones, the browser mic may capture only the user’s own voice. Remote participants may be quiet or missing. That is not an OpenAI issue; it is an input-source issue.

You should say this directly in the UI:

> “This version records your selected microphone. For online calls, remote speakers may not be captured well if you use headphones.”

Future system/tab audio capture can use `getDisplayMedia()`, which prompts the user to select a screen, window, or tab and returns a media stream that can be recorded or sent over WebRTC. ([MDN Web Docs][9]) But it is more awkward UX, browser-dependent, and not as clean as microphone recording. MDN also marks the Screen Capture API as limited availability in some contexts, so I would not make it part of your first MVP. ([MDN Web Docs][10])

## Recommended user flow

```text
Landing / App Home
  ↓
New Meeting
  ↓
Choose microphone
  ↓
Show recording notice / consent reminder
  ↓
Start Recording
  ↓
Live transcript view
  ↓
Stop or auto-stop at 60 minutes
  ↓
Save meeting
  ↓
Review transcript + audio
  ↓
Copy / download / optionally upload
```

## Backend API design

Minimal endpoints:

```http
POST /api/realtime-token
```

Creates a short-lived OpenAI realtime token.

```http
POST /api/meetings
```

Creates meeting metadata.

```http
PATCH /api/meetings/:id
```

Updates title, status, duration, transcript metadata.

```http
POST /api/meetings/:id/upload-audio
```

Optional. Uploads final audio if cloud backup is enabled.

```http
POST /api/meetings/:id/transcript
```

Optional. Persists transcript to your backend.

```http
GET /api/meetings
```

Lists user’s meetings.

```http
GET /api/meetings/:id
```

Loads meeting metadata and transcript.

For the MVP, I would store the full meeting locally first and only sync metadata/transcript to your backend if the user is logged in.

## Failure handling

Design these explicitly:

| Failure                        | Web-app behavior                                                              |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Mic permission denied          | Show permission instructions; do not start                                    |
| OpenAI token request fails     | Continue local recording; show “Live transcript unavailable”                  |
| Realtime connection drops      | Keep recording locally; retry transcription connection                        |
| Tab is closed                  | Recover saved chunks from IndexedDB next time, if chunks were already written |
| Browser storage quota exceeded | Stop safely; ask user to download or clear storage                            |
| Wake Lock denied/released      | Continue recording; warn user to keep tab active                              |
| 60-minute limit reached        | Auto-stop and finalize                                                        |
| Upload fails                   | Keep local copy; retry later                                                  |

## Product copy correction

Change the description from this:

> “Keeps your computer awake during the session.”

To this:

> “Helps keep the screen awake while recording, when supported by your browser.”

And change this:

> “Saves a local audio file.”

To this:

> “Saves a recoverable browser-local recording and lets you download the final audio file.”

That wording is more accurate for a web app.

## Best MVP technical design

The cleanest version is:

```text
Frontend:
  Next.js web app

Recording:
  getUserMedia microphone capture
  MediaRecorder chunks saved every 2–5 seconds
  IndexedDB recovery storage

Live transcription:
  OpenAI Realtime over WebRTC
  Backend-minted ephemeral token
  Transcript segment model

Persistence:
  Browser-local first
  Optional backend sync after recording
  Optional audio upload only after user opts in

Reliability:
  Local recording starts before transcription
  Wake Lock best-effort
  Crash/tab-close recovery via IndexedDB
  60-minute hard stop
```

This gives you a realistic web MVP: lightweight, browser-native, live transcript, local recovery, no meeting bot, and a clear path toward system audio, summaries, action items, and speaker labeling later.

[1]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia?utm_source=chatgpt.com "MediaDevices: getUserMedia() method - Web APIs | MDN"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder?utm_source=chatgpt.com "MediaRecorder - Web APIs | MDN"
[3]: https://developers.openai.com/api/docs/guides/realtime-webrtc "Realtime API with WebRTC | OpenAI API"
[4]: https://developers.openai.com/api/docs/guides/realtime "Realtime and audio | OpenAI API"
[5]: https://developers.openai.com/api/docs/guides/realtime-transcription?utm_source=chatgpt.com "Realtime transcription | OpenAI API"
[6]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB?utm_source=chatgpt.com "Using IndexedDB - Web APIs - MDN Web Docs"
[7]: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria?utm_source=chatgpt.com "Storage quotas and eviction criteria - Web APIs | MDN"
[8]: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API?utm_source=chatgpt.com "Screen Wake Lock API - MDN Web Docs - Mozilla"
[9]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia?utm_source=chatgpt.com "MediaDevices: getDisplayMedia() method - Web APIs | MDN"
[10]: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture?utm_source=chatgpt.com "Using the Screen Capture API - MDN Web Docs"


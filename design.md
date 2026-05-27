Yes — use a **Notion-inspired meeting notes UI**, but do not make it a direct clone. The style should feel like a clean document workspace: calm, minimal, block-based, searchable, and focused on the meeting record.

Notion’s own AI Meeting Notes is positioned around capturing, transcribing, summarizing, and organizing meetings inside a workspace; its browser experience is more limited for audio capture because browser use is mic-only, while the desktop app can capture system audio. That reinforces the right direction for your web MVP: make the UI feel like a document-first meeting workspace, but be explicit that the browser app records the selected microphone. ([Notion][1])

Below is a paste-ready UI style brief for your coding agent.

---

# UI Style Brief: Notion-Inspired AI Meeting Recorder

## Product feel

Build a **clean, document-first meeting recorder** inspired by Notion-style workspaces.

The app should feel like:

```text
Not a dashboard.
Not a call bot.
Not a noisy recorder.

It should feel like a calm workspace page where a meeting turns into a structured note.
```

The main experience should be:

```text
Open app → create meeting page → press record → transcript appears as blocks → stop → meeting becomes a searchable note
```

Use a **minimal, editorial, block-based UI** with subtle borders, off-white backgrounds, small controls, and lots of whitespace.

---

# Core style principles

## 1. Document-first, not recorder-first

The recording controls should be important but not visually huge. The main object is the **meeting note page**.

The live transcript should look like a document being written in real time.

Bad direction:

```text
Big colorful dashboard
Huge waveform
Lots of cards
Heavy gradients
Dark SaaS UI
```

Good direction:

```text
Calm document canvas
Small recording pill
Subtle timer
Transcript blocks
Inline metadata
Clean left sidebar
```

---

## 2. Calm, monochrome interface

Use mostly neutral colors.

The only strong color should be the recording state.

```text
Default UI:
  off-white
  white
  gray text
  light borders

Recording state:
  soft red dot
  subtle red text
  no aggressive flashing
```

Avoid bright purple AI branding, gradients, glassmorphism, heavy shadows, or dashboard-style charts.

---

## 3. Block-based content

Everything on the meeting page should feel like editable blocks:

```text
Title block
Meeting metadata block
Recording status block
Live transcript block
Summary block
Action items block
Transcript block
```

Even if the MVP does not support full block editing, the UI should visually suggest a document workspace.

---

## 4. Lightweight workspace navigation

Use a simple left sidebar similar to a productivity app:

```text
Sidebar
├── New meeting
├── Recent meetings
├── Search
└── Settings
```

The sidebar should be quiet and functional. It should not dominate the screen.

---

# Layout

## App shell

```text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar      │ Main meeting document                         │
│              │                                               │
│ New Meeting  │ Untitled Meeting                              │
│ Search       │ May 27, 2026 · 00:04 · Mic only               │
│              │                                               │
│ Recent       │ [● Recording] [00:04] [Stop]                  │
│ meetings     │                                               │
│              │ Live transcript                               │
│              │ Hello, this is a test meeting...              │
│              │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

## Dimensions

Use these defaults:

```css
Sidebar width: 240px
Top bar height: 48px
Main content max width: 820px
Document padding top: 48px
Document side padding: 32px
Border radius: 6px to 10px
```

Main document should be centered inside the available space.

```text
Left sidebar fixed.
Main document scrolls.
Controls stay near top of document.
```

---

# Color system

Use this palette.

```css
:root {
  --bg-app: #f7f7f5;
  --bg-sidebar: #fbfbfa;
  --bg-page: #ffffff;
  --bg-hover: #efefed;
  --bg-active: #e9e9e6;

  --text-primary: #2f3437;
  --text-secondary: #6f7377;
  --text-tertiary: #9b9a97;

  --border-subtle: #e6e4df;
  --border-strong: #d8d6d0;

  --recording-red: #eb5757;
  --recording-red-soft: #fff1f0;

  --success-green: #2f8f5b;
  --warning-yellow: #b7791f;

  --shadow-soft: 0 1px 2px rgba(15, 15, 15, 0.06);
}
```

Do not use many accent colors. The product should feel restrained.

---

# Typography

Use a clean system font stack.

```css
body {
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  color: var(--text-primary);
  background: var(--bg-app);
}
```

Typography scale:

```css
Page title:
  font-size: 40px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.03em;

Section heading:
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;

Body:
  font-size: 15px;
  line-height: 1.65;
  font-weight: 400;

Small metadata:
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);

Button:
  font-size: 14px;
  font-weight: 500;
```

The transcript should be easy to read for a long time. Use generous line height.

---

# Main screens

## 1. Empty home screen

Purpose: help the user start quickly.

Layout:

```text
Sidebar on left
Centered empty state in main area
Small title
Short explanation
Primary button: New meeting
```

Copy:

```text
AI Meeting Recorder

Record a meeting, see the transcript live, and save a searchable note.

[New meeting]
```

Secondary note:

```text
Browser version records your selected microphone.
```

---

## 2. New meeting setup screen

Before recording, show a simple meeting page.

```text
Untitled meeting

Today · Mic only

Microphone
[Built-in Microphone ▼]

This browser version records your selected microphone. Remote speakers may not be captured clearly if you use headphones.

[Start recording]
```

The warning should be subtle, not scary.

Use a pale yellow or gray callout.

```css
.callout {
  background: #faf6ea;
  border: 1px solid #eee2bd;
  border-radius: 8px;
  padding: 12px 14px;
  color: #6f5d2e;
}
```

---

## 3. Recording screen

This is the most important screen.

The recording state should be visible but calm.

```text
Customer Interview

May 27, 2026 · Mic only

[● Recording] [00:04] [Stop]

Live transcript

Hello, this is a test meeting.
We are testing the live transcript feature.
The meeting recorder should save this transcript after recording stops.
```

Recording pill:

```css
.recording-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--recording-red-soft);
  color: var(--recording-red);
  font-size: 13px;
  font-weight: 500;
}
```

Recording dot:

```css
.recording-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--recording-red);
}
```

Do not use an aggressive blinking animation. A subtle pulse is acceptable.

```css
.recording-dot {
  animation: pulse 1.8s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
```

---

## 4. Saved meeting screen

After stop, the page becomes a clean note.

```text
Customer Interview

May 27, 2026 · 14 min · Saved

Summary
No summary generated yet.

Action items
No action items generated yet.

Transcript
Hello, this is a test meeting...
```

For MVP, summary and action items can be placeholder sections. They make the product feel expandable without requiring you to build summarization immediately.

Buttons:

```text
[Copy transcript] [Download .md] [Download audio]
```

Keep these buttons small and secondary.

---

# Component style

## Sidebar

```text
Width: 240px
Background: #fbfbfa
Right border: #e6e4df
Padding: 12px
```

Sidebar item style:

```css
.sidebar-item {
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}

.sidebar-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-item.active {
  background: var(--bg-active);
  color: var(--text-primary);
}
```

Sidebar example:

```text
＋ New meeting

Search

Recent
  Customer Interview
  Product Standup
  Research Sync

Settings
```

---

## Buttons

Primary button should be understated.

```css
.button-primary {
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #2f3437;
  background: #2f3437;
  color: white;
  font-size: 14px;
  font-weight: 500;
}

.button-primary:hover {
  background: #1f2326;
}
```

Secondary button:

```css
.button-secondary {
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: white;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

.button-secondary:hover {
  background: var(--bg-hover);
}
```

Danger/stop button:

```css
.button-stop {
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #f0c4c0;
  background: #fff7f6;
  color: var(--recording-red);
  font-size: 14px;
  font-weight: 500;
}

.button-stop:hover {
  background: #fff1f0;
}
```

---

## Transcript block

The transcript should look like readable document content, not a chat log.

```css
.transcript {
  margin-top: 24px;
}

.transcript-segment {
  position: relative;
  padding: 4px 0;
  font-size: 15px;
  line-height: 1.65;
  color: var(--text-primary);
}

.transcript-segment.provisional {
  color: var(--text-tertiary);
}

.transcript-segment.final {
  color: var(--text-primary);
}
```

Optional hover behavior:

```text
When hovering over a transcript paragraph:
  show timestamp on the left
```

Example:

```text
00:12  Hello, this is a test meeting.
00:18  We are testing the live transcript feature.
00:25  Action item: follow up with the customer tomorrow.
```

Keep timestamps subtle.

---

## Metadata row

Use small gray inline pills.

```css
.metadata-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  margin-top: 8px;
}

.metadata-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #f1f1ef;
  color: var(--text-secondary);
}
```

Example:

```text
May 27, 2026 · 14 min · Mic only · Saved locally
```

---

## Callouts

Use callouts for limitations, errors, and recovery.

Mic-only callout:

```text
Browser recording uses your selected microphone. Remote speakers may be quieter if you use headphones.
```

Transcription failure callout:

```text
Live transcription is unavailable, but local recording is still active.
```

Recovery callout:

```text
We found an unfinished recording. You can recover the draft meeting.
```

Callout style:

```css
.callout {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: #fafafa;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
}
```

---

# Meeting page structure

Use this exact hierarchy:

```text
Page
├── Title
├── Metadata row
├── Recording controls
├── Optional warning/callout
├── Live transcript section
├── Summary section
├── Action items section
└── Full transcript section
```

For MVP while recording:

```text
Title
Metadata
Recording controls
Live transcript
```

For saved meeting:

```text
Title
Metadata
Summary placeholder
Action items placeholder
Transcript
Export buttons
```

---

# UX copy

Use short, calm copy.

## Buttons

```text
New meeting
Start recording
Stop
Copy transcript
Download transcript
Download audio
Recover meeting
Discard
```

## Status labels

```text
Idle
Preparing microphone
Recording
Transcribing live
Saving
Saved
Live transcription unavailable
Recording limit reached
```

## Empty transcript

```text
Transcript will appear here once recording starts.
```

## Mic-only notice

```text
This browser version records your selected microphone.
```

## Headphones warning

```text
Remote speakers may not be captured clearly if you use headphones.
```

## Saved confirmation

```text
Meeting saved.
```

## Limit reached

```text
Recording limit reached. Your meeting has been saved.
```

---

# Animation and interaction

Keep motion minimal.

```text
Hover transitions: 120ms
Panel transitions: 160ms
No bouncy animations
No large modals unless necessary
No confetti
No dramatic loading spinners
```

Use skeletons sparingly.

For recording, use a small pulsing red dot only.

---

# Responsive behavior

## Desktop

```text
Sidebar visible
Document centered
Max width 820px
```

## Tablet

```text
Sidebar collapses to icon rail or drawer
Document takes full width
```

## Mobile

```text
No persistent sidebar
Top bar with New / Meetings
Recording controls sticky at bottom
Transcript full width
```

Mobile recording controls:

```text
[● 00:14 Recording]              [Stop]
```

---

# Accessibility requirements

Make the app keyboard-friendly.

```text
Tab reaches all controls.
Enter/Space activates buttons.
Recording state is announced with aria-live.
Errors are visible and screen-reader readable.
Buttons have clear labels.
Color is not the only recording indicator.
```

Examples:

```tsx
<div aria-live="polite" data-testid="recording-status">
  Recording
</div>

<button aria-label="Stop recording">
  Stop
</button>
```

---

# Suggested test IDs

Keep these for your browser agent tests:

```tsx
data-testid="app-sidebar"
data-testid="new-meeting-button"
data-testid="meeting-search-input"
data-testid="meeting-list"
data-testid="meeting-title-input"
data-testid="meeting-metadata"
data-testid="mic-device-select"
data-testid="mic-only-warning"
data-testid="start-recording-button"
data-testid="stop-recording-button"
data-testid="recording-status"
data-testid="recording-timer"
data-testid="recording-pill"
data-testid="live-transcript"
data-testid="transcript-segment"
data-testid="summary-section"
data-testid="action-items-section"
data-testid="copy-transcript-button"
data-testid="download-transcript-button"
data-testid="download-audio-button"
data-testid="save-status"
data-testid="transcription-error"
data-testid="mic-permission-error"
data-testid="recovery-callout"
data-testid="recover-meeting-button"
```

---

# Tailwind-style direction

Use this general Tailwind look:

```tsx
<div className="min-h-screen bg-[#f7f7f5] text-[#2f3437]">
  <aside className="fixed left-0 top-0 h-screen w-60 border-r border-[#e6e4df] bg-[#fbfbfa] p-3">
    Sidebar
  </aside>

  <main className="ml-60 px-8 py-12">
    <article className="mx-auto max-w-[820px]">
      Meeting page
    </article>
  </main>
</div>
```

Page title:

```tsx
<input
  data-testid="meeting-title-input"
  className="w-full border-none bg-transparent text-[40px] font-bold leading-tight tracking-[-0.03em] outline-none placeholder:text-[#c1bfba]"
  placeholder="Untitled meeting"
/>
```

Metadata row:

```tsx
<div
  data-testid="meeting-metadata"
  className="mt-2 flex items-center gap-2 text-sm text-[#6f7377]"
>
  <span>May 27, 2026</span>
  <span>·</span>
  <span>Mic only</span>
  <span>·</span>
  <span>Saved locally</span>
</div>
```

Recording controls:

```tsx
<div className="mt-8 flex items-center gap-3">
  <div
    data-testid="recording-pill"
    className="inline-flex h-7 items-center gap-2 rounded-full bg-[#fff1f0] px-3 text-sm font-medium text-[#eb5757]"
  >
    <span className="h-2 w-2 rounded-full bg-[#eb5757]" />
    Recording
  </div>

  <div
    data-testid="recording-timer"
    className="text-sm tabular-nums text-[#6f7377]"
  >
    00:14
  </div>

  <button
    data-testid="stop-recording-button"
    className="h-8 rounded-md border border-[#f0c4c0] bg-[#fff7f6] px-3 text-sm font-medium text-[#eb5757] hover:bg-[#fff1f0]"
  >
    Stop
  </button>
</div>
```

Transcript section:

```tsx
<section className="mt-10">
  <h2 className="text-[15px] font-semibold text-[#2f3437]">
    Live transcript
  </h2>

  <div
    data-testid="live-transcript"
    className="mt-4 space-y-2 text-[15px] leading-[1.65] text-[#2f3437]"
  >
    <p data-testid="transcript-segment">
      Hello, this is a test meeting.
    </p>
  </div>
</section>
```

---

# Browser-agent style validation

Your browser agent can validate style with simple checks:

```text
1. App has a left sidebar.
2. Main meeting content is centered and document-like.
3. Page title is large and editable.
4. Recording state appears as a small red pill, not a giant banner.
5. Transcript appears as document text, not chat bubbles.
6. UI uses neutral/off-white background.
7. Buttons are small and understated.
8. Mic-only warning is visible before recording.
9. Saved meeting page keeps transcript visible.
10. Export buttons are available after stop.
```

---

# Paste-ready prompt for your coding agent

Use this directly:

```text
Build the UI for a web app called AI Meeting Recorder.

Style direction:
Create a Notion-inspired meeting notes interface. Do not clone Notion exactly. The UI should feel like a clean document workspace where a meeting becomes a structured note.

Use:
- off-white app background
- white document canvas
- subtle gray borders
- compact sidebar
- centered document content
- large editable page title
- small metadata row
- understated buttons
- small red recording pill
- transcript displayed as document paragraphs, not chat bubbles
- calm, minimal, block-based layout

Avoid:
- gradients
- heavy shadows
- colorful SaaS dashboard style
- big waveforms
- chat UI
- large modals
- flashy animations

Core layout:
Left sidebar width 240px.
Main document max width 820px.
Document padding top 48px.
Use neutral colors:
#f7f7f5 background
#fbfbfa sidebar
#ffffff page
#2f3437 primary text
#6f7377 secondary text
#e6e4df border
#eb5757 recording red

Screens:
1. Empty home screen with New Meeting button.
2. New meeting setup screen with title, mic selector, mic-only warning, and Start Recording button.
3. Recording screen with title, metadata, small red Recording pill, timer, Stop button, and live transcript.
4. Saved meeting screen with title, metadata, transcript, Copy Transcript, Download Transcript, and Download Audio buttons.

Add data-testid attributes:
new-meeting-button
meeting-title-input
mic-device-select
mic-only-warning
start-recording-button
stop-recording-button
recording-status
recording-timer
recording-pill
live-transcript
transcript-segment
save-status
copy-transcript-button
download-transcript-button
download-audio-button
meeting-list

UX copy:
- New meeting
- Start recording
- Stop
- Recording
- Live transcript
- Transcript will appear here once recording starts.
- This browser version records your selected microphone.
- Remote speakers may not be captured clearly if you use headphones.
- Meeting saved.
- Live transcription is unavailable, but local recording is still active.

Make the interface responsive:
Desktop uses sidebar.
Mobile uses top navigation and sticky bottom recording controls.
```

---

The main design rule: **make recording feel like creating a document, not operating a machine.** That is the Notion-style feeling you want.

[1]: https://www.notion.com/help/ai-meeting-notes?utm_source=chatgpt.com "AI Meeting Notes (beta) – Notion Help Center"


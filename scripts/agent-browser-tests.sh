#!/usr/bin/env bash
set -euo pipefail

ROOT_URL="${ROOT_URL:-http://127.0.0.1:3000}"
OUT_DIR="${OUT_DIR:-agent-browser-results}"
export ROOT_URL
mkdir -p "$OUT_DIR"

test_index=0

run_case() {
  local name="$1"
  local fn="$2"
  test_index=$((test_index + 1))
  export AB_SESSION="meeting-e2e-${test_index}"
  echo "agent-browser test ${test_index}: ${name}"
  agent-browser --session "$AB_SESSION" close >/dev/null 2>&1 || true
  "$fn"
  agent-browser --session "$AB_SESSION" screenshot --full "$OUT_DIR/${test_index}-${name// /-}.png" >/dev/null
  agent-browser --session "$AB_SESSION" close >/dev/null 2>&1 || true
}

ab() {
  agent-browser --session "$AB_SESSION" "$@"
}

assert_page() {
  local js="$1"
  cat <<EOF | ab eval --stdin >/dev/null
(() => {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  ${js}
  return "ok";
})()
EOF
}

open_app() {
  ab open "$ROOT_URL/$1" >/dev/null
}

start_mock_meeting() {
  ab find testid new-meeting-button click >/dev/null
  ab find testid start-recording-button click >/dev/null
}

case_happy_path() {
  open_app "?e2e=1&mockMic=1&mockTranscription=1"
  start_mock_meeting
  ab wait --text "Hello, this is a test meeting." >/dev/null
  ab wait --fn "document.querySelector(\"[data-testid=recording-timer]\")?.textContent !== \"00:00\"" >/dev/null
  assert_page "
    assert(document.querySelector(\"[data-testid=recording-wave]\"), \"recording wave missing while recording\");
  "
  ab find testid stop-recording-button click >/dev/null
  ab wait --text "Meeting saved." >/dev/null
  assert_page "
    assert(document.querySelector(\"[data-testid=recording-status]\")?.textContent.includes(\"Saved\"), \"recording status did not save\");
    assert(document.querySelector(\"[data-testid=meeting-list]\")?.textContent.includes(\"Untitled meeting\"), \"meeting list missing saved meeting\");
    assert(!document.querySelector(\"[data-testid=download-transcript-button]\")?.disabled, \"transcript download disabled\");
    assert(!document.querySelector(\"[data-testid=download-audio-button]\")?.disabled, \"audio download disabled\");
  "
}

case_mic_denied() {
  open_app "?e2e=1&mockMicDenied=1"
  ab find testid new-meeting-button click >/dev/null
  ab find testid start-recording-button click >/dev/null
  ab wait --text "Microphone access is required to record a meeting." >/dev/null
  assert_page "
    assert(!document.querySelector(\"[data-testid=recording-status]\")?.textContent.includes(\"Recording\"), \"recording started after denied mic\");
    assert(document.querySelector(\"[data-testid=recording-timer]\")?.textContent === \"00:00\", \"timer advanced after denied mic\");
  "
}

case_transcription_failure_continues() {
  open_app "?e2e=1&mockMic=1&mockTranscriptionFailure=1"
  start_mock_meeting
  ab wait --text "Live transcription is unavailable" >/dev/null
  ab wait --fn "document.querySelector(\"[data-testid=recording-timer]\")?.textContent !== \"00:00\"" >/dev/null
  ab find testid stop-recording-button click >/dev/null
  ab wait --text "Meeting saved." >/dev/null
  assert_page "
    assert(!document.querySelector(\"[data-testid=download-audio-button]\")?.disabled, \"audio unavailable after transcription failure\");
  "
}

case_stop_finalizes_transcript_and_audio() {
  open_app "?e2e=1&mockMic=1&mockTranscription=1"
  start_mock_meeting
  ab wait --text "Hello, this is a test meeting." >/dev/null
  ab find testid stop-recording-button click >/dev/null
  ab wait --text "Meeting saved." >/dev/null
  assert_page "
    const transcript = document.querySelector(\"[data-testid=live-transcript]\")?.textContent || \"\";
    assert(transcript.includes(\"Hello, this is a test meeting.\"), \"transcript disappeared after stop\");
    assert(!document.querySelector(\"[data-testid=download-transcript-button]\")?.disabled, \"transcript export disabled after stop\");
    assert(!document.querySelector(\"[data-testid=download-audio-button]\")?.disabled, \"audio export disabled after stop\");
  "
}

case_title_edit_persists() {
  open_app "?e2e=1&mockMic=1&mockTranscription=1"
  start_mock_meeting
  ab wait --text "Hello, this is a test meeting." >/dev/null
  ab find testid stop-recording-button click >/dev/null
  ab wait --text "Meeting saved." >/dev/null
  ab find testid meeting-title-input fill "Customer Interview Test" >/dev/null
  ab wait --text "Customer Interview Test" >/dev/null
  assert_page "
    assert(document.querySelector(\"[data-testid=meeting-list]\")?.textContent.includes(\"Customer Interview Test\"), \"meeting list did not show edited title\");
  "
}

case_copy_transcript() {
  open_app "?e2e=1&mockMic=1&mockTranscription=1"
  start_mock_meeting
  ab wait --text "Hello, this is a test meeting." >/dev/null
  ab find testid stop-recording-button click >/dev/null
  ab wait --text "Meeting saved." >/dev/null
  assert_page "
    const copyButton = document.querySelector(\"[data-testid=copy-transcript-button]\");
    assert(copyButton, \"copy transcript button missing\");
    copyButton.click();
  "
  ab wait --text "Transcript copied." >/dev/null
}

case_recovery_after_refresh() {
  open_app "?e2e=1&mockMic=1&mockTranscription=1"
  start_mock_meeting
  ab wait --text "Hello, this is a test meeting." >/dev/null
  ab reload >/dev/null
  ab wait --text "We found an unfinished recording." >/dev/null
  ab find testid recover-meeting-button click >/dev/null
  ab wait --text "Hello, this is a test meeting." >/dev/null
}

case_duration_limit_auto_stop() {
  open_app "?e2e=1&mockMic=1&mockTranscription=1&maxDurationSeconds=3"
  start_mock_meeting
  ab wait --text "Recording limit reached. Your meeting has been saved." >/dev/null
  assert_page "
    assert(!document.querySelector(\"[data-testid=recording-status]\")?.textContent.includes(\"Recording\"), \"still recording after duration limit\");
    assert(document.querySelector(\"[data-testid=save-status]\")?.textContent.includes(\"Recording limit reached\"), \"limit message missing\");
  "
}

case_realtime_fragments_debug() {
  open_app "?e2e=1&mockMic=1&mockRealtimeContentIndexes=1&debugRealtime=1"
  start_mock_meeting
  ab wait --text "Opening context survives." >/dev/null
  ab wait --text "Follow-up detail also remains." >/dev/null
  ab wait --text "Realtime debug" >/dev/null
  assert_page "
    const debug = window.__meetingRealtimeDebug || { events: [], segments: [] };
    const transcript = document.querySelector(\"[data-testid=live-transcript]\")?.textContent || \"\";
    assert(transcript.includes(\"Opening context survives.\"), \"first realtime content index missing\");
    assert(transcript.includes(\"Follow-up detail also remains.\"), \"second realtime content index missing\");
    assert(debug.events.length === 4, \"debug realtime event count mismatch\");
    assert(debug.segments.length === 2, \"debug realtime segment count mismatch\");
  "
}

run_case "happy path" case_happy_path
run_case "mic denied" case_mic_denied
run_case "transcription failure continues" case_transcription_failure_continues
run_case "stop finalizes transcript and audio" case_stop_finalizes_transcript_and_audio
run_case "title edit persists" case_title_edit_persists
run_case "copy transcript" case_copy_transcript
run_case "recovery after refresh" case_recovery_after_refresh
run_case "realtime fragments debug" case_realtime_fragments_debug
run_case "duration limit auto stop" case_duration_limit_auto_stop

echo "agent-browser tests passed: ${test_index}"

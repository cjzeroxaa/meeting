"use client";

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type EditorState
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  Menu,
  Mic,
  Plus,
  Square,
  TimerReset,
  X
} from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { formatDuration, formatMeetingDate, formatTimer } from "@/lib/format";
import {
  deleteNoteDraft,
  getAudioChunks,
  getMeetings,
  getNoteDraft,
  getTranscriptSegments,
  putAudioChunk,
  putMeeting,
  putNoteDraft,
  putTranscriptSegment,
  type StoredMeeting,
  type TranscriptSegment
} from "@/lib/meeting-store";

const MOCK_TRANSCRIPT_SEGMENTS = [
  "Hello, this is a test meeting.",
  "We are testing the live transcript feature.",
  "The meeting recorder should save this transcript after recording stops.",
  "Action item: follow up with the customer tomorrow."
];

type DeviceOption = {
  id: string;
  label: string;
};

type RealtimeConnection = {
  close: () => void;
};

const REALTIME_COMMIT_INTERVAL_MS = 5_000;

type RealtimeServerEvent = {
  type?: string;
  item_id?: string;
  content_index?: number;
  delta?: string;
  transcript?: string;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
};

type RealtimeDebugEvent = {
  id: string;
  at: string;
  type: string;
  itemKey?: string;
  itemId?: string;
  contentIndex?: number;
  textLength?: number;
  preview?: string;
};

type NoteFields = {
  summary: string;
  actionItems: string;
  notes: string;
};

type TranscriptBlock = {
  id: string;
  segmentIds: string[];
  startMs?: number;
  endMs?: number;
  text: string;
  isFinal: boolean;
  isEdited: boolean;
};

type NoteDocumentState = {
  id: string;
  meetingId: string;
  version: number;
  contentJson: {
    type: string;
    content?: unknown[];
  };
  contentText: string;
};

const EMPTY_NOTE_FIELDS: NoteFields = {
  summary: "",
  actionItems: "",
  notes: ""
};

const NOTE_PLACEHOLDERS: Record<keyof NoteFields, string> = {
  summary: "Click to add summary...",
  actionItems: "Click to add action items...",
  notes: "Click to add notes..."
};

const LEGACY_EMPTY_NOTE_TEXT: Partial<Record<keyof NoteFields, string>> = {
  summary: "No summary generated yet.",
  actionItems: "No action items yet."
};

declare global {
  interface Window {
    __meetingRealtimeDebug?: {
      events: RealtimeDebugEvent[];
      segments: TranscriptSegment[];
    };
  }
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getSearchParams() {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }

  return new URLSearchParams(window.location.search);
}

function isE2EFlag(flag: string) {
  return getSearchParams().get(flag) === "1";
}

function shouldUseBackendSync() {
  return !isE2EFlag("e2e");
}

function getMaxDurationSeconds() {
  const raw = getSearchParams().get("maxDurationSeconds");
  const parsed = raw ? Number(raw) : 60 * 60;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60;
}

class RequestJsonError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "RequestJsonError";
    this.status = status;
    this.payload = payload;
  }
}

function isUnauthorized(error: unknown) {
  return error instanceof RequestJsonError && error.status === 401;
}

function buildMarkdownTranscript(meeting: StoredMeeting, segments: TranscriptSegment[]) {
  const title = meeting.title.trim() || "Untitled meeting";
  const transcript = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n\n");

  return `# ${title}\n\n${formatMeetingDate(meeting.startedAt)} · ${formatDuration(
    meeting.durationMs
  )} · Mic only\n\n## Summary\n\nNo summary generated yet.\n\n## Action items\n\nNo action items generated yet.\n\n## Transcript\n\n${transcript}\n`;
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : `Request failed: ${response.status}`;
    throw new RequestJsonError(response.status, message, payload);
  }

  return response.json() as Promise<T>;
}

function mapBackendMeeting(input: {
  id: string;
  title: string;
  startedAt?: string | null;
  endedAt?: string | null;
  status: string;
  durationSeconds?: number | null;
}) {
  const status =
    input.status === "recording"
      ? "recording"
      : input.status === "saved"
        ? "saved"
        : "idle";

  return {
    id: input.id,
    title: input.title,
    startedAt: input.startedAt ?? new Date().toISOString(),
    endedAt: input.endedAt ?? undefined,
    status,
    durationMs: (input.durationSeconds ?? 0) * 1000,
    uploadStatus: "synced" as const
  } satisfies StoredMeeting;
}

function mapBackendSegment(input: {
  id: string;
  meetingId: string;
  providerItemId?: string | null;
  sequenceIndex: number;
  startMs?: number | null;
  endMs?: number | null;
  text: string;
  rawText?: string | null;
  editedText?: string | null;
  isFinal: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}) {
  const now = new Date().toISOString();

  return {
    id: input.id,
    meetingId: input.meetingId,
    providerItemId: input.providerItemId ?? undefined,
    sequenceIndex: input.sequenceIndex,
    startMs: input.startMs ?? undefined,
    endMs: input.endMs ?? undefined,
    text: input.text,
    rawText: input.rawText ?? input.text,
    editedText: input.editedText ?? null,
    isFinal: input.isFinal,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  } satisfies TranscriptSegment;
}

function getNodeText(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }

  if ("text" in node && typeof node.text === "string") {
    return node.text;
  }

  if ("content" in node && Array.isArray(node.content)) {
    return node.content.map(getNodeText).filter(Boolean).join("\n");
  }

  return "";
}

function fieldsFromNoteDocument(
  noteDocument: NoteDocumentState | null
): NoteFields {
  if (!noteDocument?.contentJson?.content) {
    return { ...EMPTY_NOTE_FIELDS };
  }

  const fields: NoteFields = { summary: "", actionItems: "", notes: "" };
  const seen = { summary: false, actionItems: false, notes: false };
  let currentField: keyof NoteFields | null = null;

  for (const block of noteDocument.contentJson.content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const blockType = "type" in block ? block.type : null;

    if (blockType === "heading") {
      const heading = getNodeText(block).trim().toLowerCase();
      currentField =
        heading === "summary"
          ? "summary"
          : heading === "action items"
            ? "actionItems"
            : heading === "notes"
              ? "notes"
              : null;
      if (currentField) {
        seen[currentField] = true;
      }
      continue;
    }

    if (blockType === "paragraph" && currentField) {
      const text = getNodeText(block).trim();
      const normalizedText =
        text === LEGACY_EMPTY_NOTE_TEXT[currentField] ? "" : text;

      if (normalizedText) {
        fields[currentField] =
          fields[currentField]
            ? `${fields[currentField]}\n${normalizedText}`
            : normalizedText;
      }
    }
  }

  return {
    summary: seen.summary ? fields.summary : EMPTY_NOTE_FIELDS.summary,
    actionItems: seen.actionItems
      ? fields.actionItems
      : EMPTY_NOTE_FIELDS.actionItems,
    notes: seen.notes ? fields.notes : EMPTY_NOTE_FIELDS.notes
  };
}

function textBlock(text: string) {
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text }] : []
  };
}

function headingBlock(text: string, level: number) {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }]
  };
}

function buildNoteContent(title: string, fields: NoteFields) {
  return {
    type: "doc",
    content: [
      headingBlock(title.trim() || "Untitled meeting", 1),
      textBlock("This browser version records your selected microphone."),
      headingBlock("Summary", 2),
      textBlock(fields.summary.trim()),
      headingBlock("Action items", 2),
      textBlock(fields.actionItems.trim()),
      headingBlock("Notes", 2),
      textBlock(fields.notes.trim())
    ]
  };
}

function noteFieldsToText(title: string, fields: NoteFields) {
  return [
    title.trim() || "Untitled meeting",
    "Summary",
    fields.summary.trim(),
    "Action items",
    fields.actionItems.trim(),
    "Notes",
    fields.notes.trim()
  ]
    .filter(Boolean)
    .join("\n");
}

function hasTranscriptText(segments: TranscriptSegment[]) {
  return segments.some((segment) =>
    Boolean(
      segment.text.trim() ||
        segment.editedText?.trim() ||
        segment.rawText?.trim()
    )
  );
}

function hasEditedSegment(segment: TranscriptSegment) {
  return segment.editedText !== undefined && segment.editedText !== null;
}

function shouldMergeIntoTranscriptBlock(
  block: TranscriptBlock,
  segment: TranscriptSegment
) {
  if (!block.isFinal || !segment.isFinal || block.isEdited || hasEditedSegment(segment)) {
    return false;
  }

  if (block.segmentIds.length >= 3 || block.text.length > 280) {
    return false;
  }

  if (
    typeof block.endMs === "number" &&
    typeof segment.startMs === "number" &&
    segment.startMs - block.endMs > 20_000
  ) {
    return false;
  }

  return true;
}

function buildTranscriptBlocks(segments: TranscriptSegment[]) {
  const blocks: TranscriptBlock[] = [];

  for (const segment of segments) {
    const text = segment.text.trim();

    if (!text) {
      continue;
    }

    const previous = blocks[blocks.length - 1];

    if (previous && shouldMergeIntoTranscriptBlock(previous, segment)) {
      previous.segmentIds.push(segment.id);
      previous.endMs = segment.endMs ?? previous.endMs;
      previous.text = `${previous.text} ${text}`;
      previous.isFinal = previous.isFinal && segment.isFinal;
      continue;
    }

    blocks.push({
      id: segment.id,
      segmentIds: [segment.id],
      startMs: segment.startMs,
      endMs: segment.endMs,
      text,
      isFinal: segment.isFinal,
      isEdited: hasEditedSegment(segment)
    });
  }

  return blocks;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function copyWithLegacySelection(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function MeetingApp() {
  const [meetings, setMeetings] = useState<StoredMeeting[]>([]);
  const [currentMeeting, setCurrentMeeting] = useState<StoredMeeting | null>(
    null
  );
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [devices, setDevices] = useState<DeviceOption[]>([
    { id: "default", label: "Built-in Microphone" }
  ]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("default");
  const [authRequired, setAuthRequired] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [statusLabel, setStatusLabel] = useState("Idle");
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [micError, setMicError] = useState("");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [recoveryMeeting, setRecoveryMeeting] = useState<StoredMeeting | null>(
    null
  );
  const [noteDocument, setNoteDocument] = useState<NoteDocumentState | null>(
    null
  );
  const [noteFields, setNoteFields] = useState<NoteFields>({
    ...EMPTY_NOTE_FIELDS
  });
  const [noteSaveStatus, setNoteSaveStatus] = useState("");
  const [debugRealtimeEnabled, setDebugRealtimeEnabled] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [realtimeDebugEvents, setRealtimeDebugEvents] = useState<
    RealtimeDebugEvent[]
  >([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const transcriptIntervalRef = useRef<number | null>(null);
  const chunkIntervalRef = useRef<number | null>(null);
  const realtimeRef = useRef<RealtimeConnection | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const startedAtRef = useRef<number>(0);
  const currentMeetingRef = useRef<StoredMeeting | null>(null);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const audioWritePromisesRef = useRef<Promise<void>[]>([]);
  const noteDocumentRef = useRef<NoteDocumentState | null>(null);
  const noteFieldsRef = useRef<NoteFields>({ ...EMPTY_NOTE_FIELDS });
  const noteAutosaveTimerRef = useRef<number | null>(null);
  const livePartialSegmentIdRef = useRef<string | null>(null);
  const liveTranscriptEndRef = useRef<HTMLDivElement | null>(null);
  const pendingTranscriptSyncIdsRef = useRef<Set<string>>(new Set());
  const realtimeDebugEventsRef = useRef<RealtimeDebugEvent[]>([]);

  const isRecording = currentMeeting?.status === "recording";
  const isSaved = currentMeeting?.status === "saved";
  const transcriptText = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n\n");

  useEffect(() => {
    currentMeetingRef.current = currentMeeting;
  }, [currentMeeting]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    noteDocumentRef.current = noteDocument;
  }, [noteDocument]);

  useEffect(() => {
    noteFieldsRef.current = noteFields;
  }, [noteFields]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    liveTranscriptEndRef.current?.scrollIntoView({
      block: "end",
      inline: "nearest"
    });
  }, [isRecording, segments]);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const syncSidebarForViewport = () => {
      setIsSidebarOpen(!mobileQuery.matches);
    };

    syncSidebarForViewport();
    mobileQuery.addEventListener("change", syncSidebarForViewport);

    return () => {
      mobileQuery.removeEventListener("change", syncSidebarForViewport);
    };
  }, []);

  useEffect(() => {
    setDebugRealtimeEnabled(isE2EFlag("debugRealtime"));
  }, []);

  useEffect(() => {
    if (!debugRealtimeEnabled) {
      return;
    }

    window.__meetingRealtimeDebug = {
      events: realtimeDebugEvents,
      segments
    };
  }, [debugRealtimeEnabled, realtimeDebugEvents, segments]);

  useEffect(() => {
    loadInitialState();
    loadDevices();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    const syncRetryInterval = window.setInterval(() => {
      void flushPendingTranscriptSync();
    }, 5_000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(syncRetryInterval);
      if (noteAutosaveTimerRef.current) {
        window.clearTimeout(noteAutosaveTimerRef.current);
      }
      stopRuntimeResources();
    };
  }, []);

  async function loadInitialState() {
    const storedMeetings = await getMeetings().catch(() => []);
    const storedRecording = storedMeetings.find(
      (meeting) => meeting.status === "recording"
    );

    if (shouldUseBackendSync()) {
      const backendMeetings = await requestJson<{
        items: Array<{
          id: string;
          title: string;
          startedAt?: string | null;
          endedAt?: string | null;
          status: string;
          durationSeconds?: number | null;
        }>;
      }>("/api/meetings?limit=100").catch((error) => {
        if (isUnauthorized(error)) {
          setAuthRequired(true);
        }

        return null;
      });

      if (backendMeetings) {
        setAuthRequired(false);
        setMeetings(backendMeetings.items.map(mapBackendMeeting));
      } else {
        setMeetings(storedMeetings);
      }
    } else {
      setMeetings(storedMeetings);
    }

    if (storedRecording) {
      setRecoveryMeeting(storedRecording);
    }
  }

  async function login() {
    setAuthError("");

    try {
      await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: authPassword })
      });
      setAuthPassword("");
      setAuthRequired(false);
      await loadInitialState();
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Could not sign in."
      );
    }
  }

  async function loadDevices() {
    if (isE2EFlag("e2e")) {
      setDevices([{ id: "mock-mic", label: "Built-in Microphone" }]);
      setSelectedDeviceId("mock-mic");
      return;
    }

    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      const microphoneOptions = mediaDevices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          id: device.deviceId || "default",
          label: device.label || `Microphone ${index + 1}`
        }));

      if (microphoneOptions.length > 0) {
        setDevices(microphoneOptions);
        setSelectedDeviceId(microphoneOptions[0].id);
      }
    } catch {
      setDevices([{ id: "default", label: "Built-in Microphone" }]);
    }
  }

  async function handleVisibilityChange() {
    if (
      document.visibilityState === "visible" &&
      currentMeetingRef.current?.status === "recording" &&
      !wakeLockRef.current
    ) {
      await requestWakeLock();
    }
  }

  async function createMeeting() {
    const now = new Date().toISOString();
    let meeting: StoredMeeting = {
      id: createId("meeting"),
      title: "Untitled meeting",
      startedAt: now,
      status: "idle",
      durationMs: 0,
      uploadStatus: "local"
    };

    if (shouldUseBackendSync()) {
      const created = await requestJson<{
        meeting: {
          id: string;
          title: string;
          startedAt?: string | null;
          status: string;
          durationSeconds?: number | null;
        };
        noteDocument: NoteDocumentState;
      }>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          title: "Untitled meeting",
          recordingMode: "microphone_only"
        })
      }).catch((error) => {
        if (isUnauthorized(error)) {
          setAuthRequired(true);
          return "unauthorized" as const;
        }

        return null;
      });

      if (created === "unauthorized") {
        return;
      }

      if (created) {
        meeting = mapBackendMeeting(created.meeting);
        setNoteDocument(created.noteDocument);
        setNoteFields(fieldsFromNoteDocument(created.noteDocument));
      } else {
        setNoteDocument(null);
        setNoteFields({ ...EMPTY_NOTE_FIELDS });
      }
    } else {
      setNoteDocument(null);
      setNoteFields({ ...EMPTY_NOTE_FIELDS });
    }

    await putMeeting(meeting);
    setCurrentMeeting(meeting);
    setSegments([]);
    livePartialSegmentIdRef.current = null;
    resetRealtimeDebugEvents();
    setTimerSeconds(0);
    setStatusLabel("Idle");
    setMicError("");
    setTranscriptionError("");
    setSaveStatus("");
    setNoteSaveStatus("");
    setCopyStatus("");
    setMeetings((existing) => [meeting, ...existing]);
  }

  async function selectMeeting(meeting: StoredMeeting) {
    let selectedMeeting = meeting;
    let selectedSegments = await getTranscriptSegments(meeting.id);
    let selectedNoteDocument: NoteDocumentState | null = null;

    if (shouldUseBackendSync() && meeting.id.startsWith("mtg_")) {
      const detail = await requestJson<{
        meeting: {
          id: string;
          title: string;
          startedAt?: string | null;
          endedAt?: string | null;
          status: string;
          durationSeconds?: number | null;
        };
        transcriptSegments: Array<{
          id: string;
          meetingId: string;
          providerItemId?: string | null;
          sequenceIndex: number;
          startMs?: number | null;
          endMs?: number | null;
          text: string;
          rawText?: string | null;
          editedText?: string | null;
          isFinal: boolean;
          createdAt?: string | null;
          updatedAt?: string | null;
        }>;
        noteDocument: NoteDocumentState;
      }>(`/api/meetings/${meeting.id}`).catch((error) => {
        if (isUnauthorized(error)) {
          setAuthRequired(true);
        }

        return null;
      });

      if (detail) {
        selectedMeeting = mapBackendMeeting(detail.meeting);
        selectedSegments = detail.transcriptSegments.map(mapBackendSegment);
        selectedNoteDocument = detail.noteDocument;
      }
    }

    setCurrentMeeting(selectedMeeting);
    setSegments(selectedSegments);
    setNoteDocument(selectedNoteDocument);
    const localNoteDraft = await getNoteDraft<NoteFields>(meeting.id).catch(
      () => null
    );
    const selectedNoteFields = localNoteDraft
      ? localNoteDraft.fields
      : fieldsFromNoteDocument(selectedNoteDocument);

    setNoteFields(selectedNoteFields);
    setTimerSeconds(Math.floor(selectedMeeting.durationMs / 1000));
    setStatusLabel(selectedMeeting.status === "saved" ? "Saved" : "Idle");
    setMicError("");
    setTranscriptionError("");
    setSaveStatus(selectedMeeting.status === "saved" ? "Meeting saved." : "");
    setNoteSaveStatus(localNoteDraft ? "Offline draft saved" : "");
    setCopyStatus("");
  }

  async function recoverMeeting() {
    if (!recoveryMeeting) {
      return;
    }

    const recoveredMeeting: StoredMeeting = {
      ...recoveryMeeting,
      status: "saved",
      endedAt: recoveryMeeting.endedAt ?? new Date().toISOString()
    };

    await putMeeting(recoveredMeeting);
    const recoveredSegments = await getTranscriptSegments(recoveredMeeting.id);

    setRecoveryMeeting(null);
    setCurrentMeeting(recoveredMeeting);
    setSegments(recoveredSegments);
    setNoteDocument(null);
    setNoteFields({ ...EMPTY_NOTE_FIELDS });
    setNoteSaveStatus("");
    setTimerSeconds(Math.floor(recoveredMeeting.durationMs / 1000));
    setStatusLabel("Saved");
    setSaveStatus("Meeting saved.");
    await refreshMeetings();
  }

  async function refreshMeetings() {
    setMeetings(await getMeetings());
  }

  async function updateMeeting(updates: Partial<StoredMeeting>) {
    const meeting = currentMeetingRef.current;

    if (!meeting) {
      return;
    }

    const updated = { ...meeting, ...updates };
    currentMeetingRef.current = updated;
    setCurrentMeeting(updated);
    setMeetings((existing) =>
      existing.map((item) => (item.id === updated.id ? updated : item))
    );
    await putMeeting(updated);

    if (shouldUseBackendSync() && updated.id.startsWith("mtg_") && updates.title) {
      await requestJson(`/api/meetings/${updated.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: updates.title })
      }).catch(() => undefined);
    }
  }

  async function renameMeeting(title: string) {
    await updateMeeting({ title });
  }

  function updateNoteField(field: keyof NoteFields, value: string) {
    const nextFields = { ...noteFieldsRef.current, [field]: value };

    noteFieldsRef.current = nextFields;
    setNoteFields(nextFields);
    setNoteSaveStatus("Saving...");
    const meeting = currentMeetingRef.current;

    if (meeting) {
      void putNoteDraft({
        meetingId: meeting.id,
        fields: nextFields,
        updatedAt: new Date().toISOString()
      }).catch(() => undefined);
    }

    scheduleNoteAutosave(nextFields);
  }

  function scheduleNoteAutosave(fields: NoteFields) {
    if (noteAutosaveTimerRef.current) {
      window.clearTimeout(noteAutosaveTimerRef.current);
    }

    noteAutosaveTimerRef.current = window.setTimeout(() => {
      void saveNoteFields(fields);
    }, 1200);
  }

  async function saveNoteFields(fields: NoteFields) {
    const meeting = currentMeetingRef.current;
    const document = noteDocumentRef.current;

    if (!meeting || !document || !shouldUseBackendSync() || !meeting.id.startsWith("mtg_")) {
      setNoteSaveStatus("Offline draft saved");
      return;
    }

    try {
      const response = await requestJson<{
        status: "saved";
        version: number;
        noteDocument: NoteDocumentState;
      }>(`/api/meetings/${meeting.id}/note-document`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: document.version,
          contentJson: buildNoteContent(meeting.title, fields),
          contentText: noteFieldsToText(meeting.title, fields)
        })
      });

      setNoteDocument(response.noteDocument);
      await deleteNoteDraft(meeting.id).catch(() => undefined);
      setNoteSaveStatus("Saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNoteSaveStatus(
        message.includes("changed elsewhere")
          ? "Version conflict. Reload this meeting to continue."
          : "Could not save"
      );
    }
  }

  async function editTranscriptBlock(segmentIds: string[], editedText: string) {
    const meeting = currentMeetingRef.current;
    const blockSegments = segmentIds
      .map((segmentId) =>
        segmentsRef.current.find((item) => item.id === segmentId)
      )
      .filter((segment): segment is TranscriptSegment => Boolean(segment));
    const normalizedText = editedText.trim();
    const currentBlockText = blockSegments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ");

    if (
      !meeting ||
      blockSegments.length === 0 ||
      normalizedText === currentBlockText
    ) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const updatedSegmentById = new Map(
      blockSegments.map((segment, index) => [
        segment.id,
        {
          ...segment,
          text: index === 0 ? normalizedText : "",
          editedText: index === 0 ? normalizedText : "",
          updatedAt
        } satisfies TranscriptSegment
      ])
    );
    const updatedSegments = segmentsRef.current.map((item) =>
      updatedSegmentById.get(item.id) ?? item
    );

    segmentsRef.current = updatedSegments;
    setSegments(updatedSegments);
    await Promise.all(
      [...updatedSegmentById.values()].map((segment) =>
        putTranscriptSegment(segment)
      )
    );

    if (shouldUseBackendSync() && meeting.id.startsWith("mtg_")) {
      await Promise.all(
        blockSegments.map((segment, index) =>
          requestJson(
            `/api/meetings/${meeting.id}/transcript-segments/${segment.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                editedText: index === 0 ? normalizedText : ""
              })
            }
          ).catch(() => undefined)
        )
      );
    }
  }

  async function startRecording() {
    const meeting = currentMeetingRef.current;

    if (!meeting) {
      return;
    }

    setMicError("");
    setTranscriptionError("");
    setSaveStatus("");
    setCopyStatus("");

    if (isE2EFlag("mockMicDenied")) {
      setStatusLabel("Idle");
      setMicError("Microphone access is required to record a meeting.");
      return;
    }

    setStatusLabel("Preparing microphone");
    const recordingStarted = await startLocalRecording(meeting);

    if (!recordingStarted) {
      return;
    }

    const startedAt = Date.now();
    startedAtRef.current = startedAt;

    const updatedMeeting: StoredMeeting = {
      ...meeting,
      status: "recording",
      startedAt: meeting.startedAt || new Date().toISOString()
    };

    await putMeeting(updatedMeeting);
    if (shouldUseBackendSync() && updatedMeeting.id.startsWith("mtg_")) {
      await requestJson(`/api/meetings/${updatedMeeting.id}/start`, {
        method: "POST",
        body: JSON.stringify({ startedAt: updatedMeeting.startedAt })
      }).catch(() => undefined);
    }
    currentMeetingRef.current = updatedMeeting;
    setCurrentMeeting(updatedMeeting);
    setMeetings((existing) =>
      existing.map((item) =>
        item.id === updatedMeeting.id ? updatedMeeting : item
      )
    );
    setStatusLabel("Recording");
    setTimerSeconds(0);
    startTimer();
    await requestWakeLock();
    await startTranscription(updatedMeeting);
  }

  async function startLocalRecording(meeting: StoredMeeting) {
    chunkIndexRef.current = 0;

    if (isE2EFlag("e2e")) {
      const initialChunk = new Blob(["mock audio chunk 0"], {
        type: "audio/webm"
      });
      await persistAudioChunk(meeting.id, initialChunk, "audio/webm");

      chunkIntervalRef.current = window.setInterval(() => {
        const chunk = new Blob([`mock audio chunk ${chunkIndexRef.current}`], {
          type: "audio/webm"
        });
        void persistAudioChunk(meeting.id, chunk, "audio/webm");
      }, 2_000);

      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusLabel("Idle");
      setMicError("Microphone access is required to record a meeting.");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio:
          selectedDeviceId === "default"
            ? true
            : { deviceId: { exact: selectedDeviceId } }
      });

      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          void persistAudioChunk(meeting.id, event.data, event.data.type);
        }
      };

      recorder.start(3_000);
      mediaRecorderRef.current = recorder;

      return true;
    } catch {
      setStatusLabel("Idle");
      setMicError("Microphone access is required to record a meeting.");
      return false;
    }
  }

  async function persistAudioChunk(
    meetingId: string,
    blob: Blob,
    mimeType: string
  ) {
    const sequenceIndex = chunkIndexRef.current;
    chunkIndexRef.current += 1;

    const writePromise = putAudioChunk({
      id: createId("chunk"),
      meetingId,
      sequenceIndex,
      blob,
      mimeType,
      createdAt: new Date().toISOString()
    }).catch(() => {
      setMicError(
        "Browser storage is full. Download this meeting or clear local storage."
      );
    });

    audioWritePromisesRef.current = [
      ...audioWritePromisesRef.current,
      writePromise
    ];

    try {
      await writePromise;
    } finally {
      audioWritePromisesRef.current = audioWritePromisesRef.current.filter(
        (promise) => promise !== writePromise
      );
    }
  }

  function startTimer() {
    const maxDurationSeconds = getMaxDurationSeconds();

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }

    timerRef.current = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const meeting = currentMeetingRef.current;

      setTimerSeconds(elapsedSeconds);

      if (meeting?.status === "recording") {
        const durationMs = elapsedSeconds * 1000;
        const updated = { ...meeting, durationMs };
        currentMeetingRef.current = updated;
        setCurrentMeeting(updated);
        void putMeeting(updated);
      }

      if (elapsedSeconds >= maxDurationSeconds) {
        void stopRecording(true);
      }
    }, 1_000);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      return;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      wakeLockRef.current.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      setMicError("Keep this tab open while recording.");
    }
  }

  async function startTranscription(meeting: StoredMeeting) {
    const recordDebug =
      debugRealtimeEnabled || isE2EFlag("debugRealtime")
        ? recordRealtimeDebugEvent
        : undefined;

    if (isE2EFlag("mockTranscriptionFailure")) {
      setTranscriptionError(
        "Live transcription is unavailable, but local recording is still active."
      );
      return;
    }

    if (isE2EFlag("mockRealtimeFragments")) {
      const events = [
        {
          type: "conversation.item.input_audio_transcription.delta",
          delta: "Hello, "
        },
        {
          type: "conversation.item.input_audio_transcription.delta",
          delta: "this is a longer live transcript."
        },
        {
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "Hello, this is a longer live transcript."
        },
        {
          type: "conversation.item.input_audio_transcription.delta",
          delta: " It should keep previous text "
        },
        {
          type: "conversation.item.input_audio_transcription.delta",
          delta: "instead of replacing it."
        }
      ];
      let index = 0;

      transcriptIntervalRef.current = window.setInterval(() => {
        if (index >= events.length) {
          if (transcriptIntervalRef.current) {
            window.clearInterval(transcriptIntervalRef.current);
            transcriptIntervalRef.current = null;
          }
          return;
        }

        handleRealtimeServerEvent(
          events[index],
          reconcileRealtimeSegment,
          recordDebug
        );
        index += 1;
      }, 400);
      return;
    }

    if (isE2EFlag("mockRealtimeContentIndexes")) {
      const events: RealtimeServerEvent[] = [
        {
          type: "conversation.item.input_audio_transcription.delta",
          item_id: "shared-item",
          content_index: 0,
          delta: "Opening context "
        },
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "shared-item",
          content_index: 0,
          transcript: "Opening context survives."
        },
        {
          type: "conversation.item.input_audio_transcription.delta",
          item_id: "shared-item",
          content_index: 1,
          delta: "Follow-up detail "
        },
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "shared-item",
          content_index: 1,
          transcript: "Follow-up detail also remains."
        }
      ];
      let index = 0;

      transcriptIntervalRef.current = window.setInterval(() => {
        if (index >= events.length) {
          if (transcriptIntervalRef.current) {
            window.clearInterval(transcriptIntervalRef.current);
            transcriptIntervalRef.current = null;
          }
          return;
        }

        handleRealtimeServerEvent(
          events[index],
          reconcileRealtimeSegment,
          recordDebug
        );
        index += 1;
      }, 400);
      return;
    }

    if (isE2EFlag("mockTranscription")) {
      let index = 0;
      const mockSegments = isE2EFlag("mockLongTranscription")
        ? Array.from({ length: 24 }, (_, segmentIndex) =>
            `Long transcript line ${segmentIndex + 1}: the meeting keeps adding live notes while the recorder stays available.`
          )
        : MOCK_TRANSCRIPT_SEGMENTS;
      const intervalMs = isE2EFlag("mockLongTranscription") ? 80 : 900;

      transcriptIntervalRef.current = window.setInterval(() => {
        if (index >= mockSegments.length) {
          if (transcriptIntervalRef.current) {
            window.clearInterval(transcriptIntervalRef.current);
            transcriptIntervalRef.current = null;
          }
          return;
        }

        void appendTranscriptSegment({
          meetingId: meeting.id,
          text: mockSegments[index],
          sequenceIndex: index,
          startMs: index * 6_000,
          isFinal: true
        });
        index += 1;
      }, intervalMs);
      return;
    }

    if (!streamRef.current) {
      return;
    }

    try {
      realtimeRef.current = await startRealtimeTranscription(
        streamRef.current,
        meeting.id,
        appendTranscriptSegment,
        reconcileRealtimeSegment,
        recordDebug
      );
    } catch (error) {
      setTranscriptionError(
        getTranscriptionFailureMessage(error)
      );
    }
  }

  async function appendTranscriptSegment({
    meetingId,
    text,
    sequenceIndex,
    startMs,
    isFinal
  }: {
    meetingId: string;
    text: string;
    sequenceIndex: number;
    startMs?: number;
    isFinal: boolean;
  }) {
    const now = new Date().toISOString();
    const elapsedMs = getRecordingElapsedMs();
    const segment: TranscriptSegment = {
      id: createId("segment"),
      meetingId,
      sequenceIndex,
      startMs: startMs ?? elapsedMs,
      endMs: isFinal ? elapsedMs : undefined,
      text,
      isFinal,
      createdAt: now,
      updatedAt: now
    };

    segmentsRef.current = [...segmentsRef.current, segment];
    setSegments(segmentsRef.current);
    await putTranscriptSegment(segment);
    await syncTranscriptSegmentsToBackend([segment]);
  }

  async function reconcileRealtimeSegment(event: {
    itemKey?: string;
    text: string;
    isFinal: boolean;
  }) {
    const meeting = currentMeetingRef.current;

    if (!meeting) {
      return;
    }

    const now = new Date().toISOString();
    const existing = event.itemKey
      ? segmentsRef.current.find(
          (segment) =>
            segment.providerItemId === event.itemKey && !segment.isFinal
        )
      : segmentsRef.current.find(
          (segment) => segment.id === livePartialSegmentIdRef.current
        );

    if (existing) {
      const elapsedMs = getRecordingElapsedMs();
      const updated = {
        ...existing,
        text: event.isFinal
          ? event.text || existing.text
          : mergeTranscriptDelta(existing.text, event.text),
        isFinal: event.isFinal,
        endMs: event.isFinal ? elapsedMs : existing.endMs,
        updatedAt: now
      };

      segmentsRef.current = segmentsRef.current.map((segment) =>
        segment.id === updated.id ? updated : segment
      );
      setSegments(segmentsRef.current);
      await putTranscriptSegment(updated);
      await syncTranscriptSegmentsToBackend([updated]);

      if (event.isFinal && !event.itemKey) {
        livePartialSegmentIdRef.current = null;
      }

      return;
    }

    const segment: TranscriptSegment = {
      id: createId("segment"),
      meetingId: meeting.id,
      providerItemId: event.itemKey,
      sequenceIndex: segmentsRef.current.length,
      startMs: getRecordingElapsedMs(),
      endMs: event.isFinal ? getRecordingElapsedMs() : undefined,
      text: event.text,
      isFinal: event.isFinal,
      createdAt: now,
      updatedAt: now
    };

    if (!event.itemKey && !event.isFinal) {
      livePartialSegmentIdRef.current = segment.id;
    }

    segmentsRef.current = [...segmentsRef.current, segment];
    setSegments(segmentsRef.current);
    await putTranscriptSegment(segment);
    await syncTranscriptSegmentsToBackend([segment]);
  }

  function getRecordingElapsedMs() {
    if (!startedAtRef.current) {
      return 0;
    }

    return Math.max(0, Date.now() - startedAtRef.current);
  }

  async function syncTranscriptSegmentsToBackend(
    transcriptSegments: TranscriptSegment[]
  ) {
    const meeting = currentMeetingRef.current;

    if (!meeting || !shouldUseBackendSync() || !meeting.id.startsWith("mtg_")) {
      return;
    }

    const finalSegments = transcriptSegments.filter((segment) => segment.isFinal);

    if (finalSegments.length === 0) {
      return;
    }

    try {
      await requestJson(`/api/meetings/${meeting.id}/transcript-segments/batch`, {
        method: "POST",
        body: JSON.stringify({
          segments: finalSegments.map((segment) => ({
            id: segment.id,
            providerItemId: segment.providerItemId,
            sequenceIndex: segment.sequenceIndex,
            startMs: segment.startMs,
            endMs: segment.endMs,
            rawText: segment.text,
            isFinal: segment.isFinal
          }))
        })
      });

      finalSegments.forEach((segment) =>
        pendingTranscriptSyncIdsRef.current.delete(segment.id)
      );
    } catch {
      finalSegments.forEach((segment) =>
        pendingTranscriptSyncIdsRef.current.add(segment.id)
      );
    }
  }

  async function flushPendingTranscriptSync() {
    const pendingIds = pendingTranscriptSyncIdsRef.current;

    if (pendingIds.size === 0) {
      return;
    }

    const pendingSegments = segmentsRef.current.filter((segment) =>
      pendingIds.has(segment.id)
    );

    if (pendingSegments.length === 0) {
      pendingIds.clear();
      return;
    }

    await syncTranscriptSegmentsToBackend(pendingSegments);
  }

  function resetRealtimeDebugEvents() {
    realtimeDebugEventsRef.current = [];
    setRealtimeDebugEvents([]);
  }

  function recordRealtimeDebugEvent(event: RealtimeDebugEvent) {
    const nextEvents = [...realtimeDebugEventsRef.current, event].slice(-80);
    realtimeDebugEventsRef.current = nextEvents;
    setRealtimeDebugEvents(nextEvents);
    window.__meetingRealtimeDebug = {
      events: nextEvents,
      segments: segmentsRef.current
    };
  }

  async function generateFinishedMeetingNotes(meeting: StoredMeeting) {
    if (!hasTranscriptText(segmentsRef.current)) {
      return;
    }

    setNoteSaveStatus("Generating notes...");

    try {
      const response = await requestJson<{
        status: "generated";
        noteDocument: NoteDocumentState;
      }>(`/api/meetings/${meeting.id}/generate-note`, {
        method: "POST",
        headers: isE2EFlag("mockSummary")
          ? { "x-meeting-summary-mock": "1" }
          : undefined
      });

      setNoteDocument(response.noteDocument);
      setNoteFields(fieldsFromNoteDocument(response.noteDocument));
      await deleteNoteDraft(meeting.id).catch(() => undefined);
      setNoteSaveStatus("Notes generated");
    } catch (error) {
      if (error instanceof RequestJsonError && error.status === 422) {
        setNoteSaveStatus("");
        return;
      }

      setNoteSaveStatus("Could not generate notes");
    }
  }

  async function stopRecording(limitReached = false) {
    const meeting = currentMeetingRef.current;

    if (!meeting || meeting.status !== "recording") {
      return;
    }

    await stopRuntimeResources();

    const durationMs = Math.max(0, Date.now() - startedAtRef.current);
    const savedMeeting: StoredMeeting = {
      ...meeting,
      status: "saved",
      endedAt: new Date().toISOString(),
      durationMs,
      limitReached
    };

    currentMeetingRef.current = savedMeeting;
    setCurrentMeeting(savedMeeting);
    setMeetings((existing) =>
      existing.map((item) => (item.id === savedMeeting.id ? savedMeeting : item))
    );
    setTimerSeconds(Math.floor(durationMs / 1000));
    setStatusLabel("Saved");
    setSaveStatus(
      limitReached
        ? "Recording limit reached. Your meeting has been saved."
        : "Meeting saved."
    );

    await putMeeting(savedMeeting);
    await syncTranscriptSegmentsToBackend(segmentsRef.current);
    await flushPendingTranscriptSync();

    if (shouldUseBackendSync() && savedMeeting.id.startsWith("mtg_")) {
      const stopSynced = await requestJson(`/api/meetings/${savedMeeting.id}/stop`, {
        method: "POST",
        body: JSON.stringify({
          endedAt: savedMeeting.endedAt,
          durationSeconds: Math.floor(durationMs / 1000),
          transcriptStatus:
            segmentsRef.current.length > 0 ? "complete" : "partial"
        })
      })
        .then(async () => {
          const latestNote = await requestJson<NoteDocumentState>(
            `/api/meetings/${savedMeeting.id}/note-document`
          ).catch(() => null);

          if (latestNote) {
            setNoteDocument(latestNote);
            setNoteFields(fieldsFromNoteDocument(latestNote));
          }

          return true;
        })
        .catch(() => false);

      if (stopSynced) {
        await Promise.allSettled([
          generateFinishedMeetingNotes(savedMeeting),
          uploadMeetingAudio(savedMeeting, durationMs).catch(() => {
            setSaveStatus(
              "Meeting saved. Audio upload failed; local audio is still available."
            );
          })
        ]);
      }
    }

    const latestMeeting = currentMeetingRef.current;
    if (
      latestMeeting?.id === savedMeeting.id &&
      latestMeeting.title !== savedMeeting.title
    ) {
      await putMeeting({ ...savedMeeting, title: latestMeeting.title });
    }
  }

  async function uploadMeetingAudio(meeting: StoredMeeting, durationMs: number) {
    const chunks = await getAudioChunks(meeting.id).catch(() => []);
    const mimeType = chunks[0]?.mimeType || "audio/webm";
    const blob = new Blob(
      chunks.map((chunk) => chunk.blob),
      { type: mimeType }
    );
    const upload = await requestJson<{
      objectPath: string;
      uploadUrl: string;
      uploadHeaders?: Record<string, string>;
    }>(`/api/meetings/${meeting.id}/audio/upload-url`, {
      method: "POST",
      body: JSON.stringify({ mimeType, sizeBytes: blob.size })
    });

    try {
      const uploadResponse = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.uploadHeaders ?? { "Content-Type": mimeType },
        body: blob
      });

      if (!uploadResponse.ok) {
        throw new Error(`Audio upload failed: ${uploadResponse.status}`);
      }

      await requestJson(`/api/meetings/${meeting.id}/audio/complete`, {
        method: "POST",
        body: JSON.stringify({
          objectPath: upload.objectPath,
          sizeBytes: blob.size,
          durationSeconds: Math.floor(durationMs / 1000),
          mimeType
        })
      });
    } catch (error) {
      await requestJson(`/api/meetings/${meeting.id}/audio/failed`, {
        method: "POST",
        body: JSON.stringify({ objectPath: upload.objectPath })
      }).catch(() => undefined);

      throw error;
    }
  }

  async function stopRuntimeResources() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (transcriptIntervalRef.current) {
      window.clearInterval(transcriptIntervalRef.current);
      transcriptIntervalRef.current = null;
    }

    if (chunkIntervalRef.current) {
      window.clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1200);

        recorder.addEventListener(
          "stop",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true }
        );

        try {
          recorder.requestData();
          recorder.stop();
        } catch {
          window.clearTimeout(timeout);
          resolve();
        }
      });
    }

    await Promise.allSettled(audioWritePromisesRef.current);

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    realtimeRef.current?.close();
    realtimeRef.current = null;

    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }

  async function copyTranscript() {
    const text = transcriptText.trim();

    if (!text) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(text),
          new Promise((resolve) => window.setTimeout(resolve, 700))
        ]);
      } else {
        copyWithLegacySelection(text);
      }
    } catch {
      copyWithLegacySelection(text);
    }

    setCopyStatus("Transcript copied.");
  }

  async function downloadTranscript() {
    if (!currentMeeting) {
      return;
    }

    const markdown = buildMarkdownTranscript(currentMeeting, segments);
    downloadBlob(
      new Blob([markdown], { type: "text/markdown" }),
      `${currentMeeting.title || "meeting"}.md`
    );
  }

  async function downloadAudio() {
    if (!currentMeeting) {
      return;
    }

    const chunks = await getAudioChunks(currentMeeting.id);

    if (chunks.length === 0 && shouldUseBackendSync() && currentMeeting.id.startsWith("mtg_")) {
      const signedDownload = await requestJson<{ downloadUrl: string }>(
        `/api/meetings/${currentMeeting.id}/audio/download-url`,
        { method: "POST" }
      ).catch(() => null);

      if (signedDownload?.downloadUrl) {
        window.location.assign(signedDownload.downloadUrl);
        return;
      }

      setSaveStatus("Audio is not available for this meeting.");
      return;
    }

    const type = chunks[0]?.mimeType || "audio/webm";
    const blob = new Blob(chunks.map((chunk) => chunk.blob), { type });
    downloadBlob(blob, `${currentMeeting.title || "meeting"}.webm`);
  }

  if (authRequired && shouldUseBackendSync()) {
    return (
      <AuthGate
        error={authError}
        onPasswordChange={setAuthPassword}
        onSubmit={() => void login()}
        password={authPassword}
      />
    );
  }

  return (
    <div className={`app-shell ${isSidebarOpen ? "" : "sidebar-collapsed"}`}>
      <button
        aria-label="Open sidebar"
        className="sidebar-expand-button"
        data-testid="sidebar-expand-button"
        onClick={() => setIsSidebarOpen(true)}
        type="button"
      >
        <Menu size={16} aria-hidden="true" />
      </button>
      <button
        aria-label="Close sidebar"
        className="sidebar-backdrop"
        data-testid="sidebar-backdrop"
        onClick={() => setIsSidebarOpen(false)}
        type="button"
      />
      <aside className="sidebar" data-testid="app-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="brand-mark">
              <FileText size={14} aria-hidden="true" />
            </span>
            <span>AI Meeting Recorder</span>
          </div>
          <button
            aria-label="Collapse sidebar"
            className="sidebar-icon-button"
            data-testid="sidebar-collapse-button"
            onClick={() => setIsSidebarOpen(false)}
            type="button"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <button
          className="sidebar-button"
          data-testid="new-meeting-button"
          onClick={createMeeting}
          type="button"
        >
          <Plus size={16} aria-hidden="true" />
          New meeting
        </button>

        <div className="sidebar-section-title">Recent</div>
        <div className="meeting-list" data-testid="meeting-list">
          {meetings.length === 0 ? (
            <div className="meeting-list-empty">No meetings yet.</div>
          ) : (
            meetings.map((meeting) => (
              <button
                className={`sidebar-item ${
                  currentMeeting?.id === meeting.id ? "active" : ""
                }`}
                key={meeting.id}
                onClick={() => {
                  void selectMeeting(meeting);
                  if (window.matchMedia("(max-width: 760px)").matches) {
                    setIsSidebarOpen(false);
                  }
                }}
                type="button"
              >
                <FileText size={15} aria-hidden="true" />
                <span>{meeting.title || "Untitled meeting"}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <header className="mobile-topbar">
        <button
          aria-label="Open sidebar"
          className="mobile-menu-button"
          data-testid="mobile-sidebar-button"
          onClick={() => setIsSidebarOpen(true)}
          type="button"
        >
          <Menu size={17} aria-hidden="true" />
        </button>
        <strong>AI Meeting Recorder</strong>
        <div className="mobile-topbar-actions">
          <button className="button-secondary" onClick={createMeeting} type="button">
            <Plus size={15} aria-hidden="true" />
            New
          </button>
        </div>
      </header>

      <main className="main">
        <article className="document">
          {currentMeeting ? (
            <MeetingDocument
              copyStatus={copyStatus}
              currentMeeting={currentMeeting}
              devices={devices}
              isRecording={isRecording}
              isSaved={isSaved}
              micError={micError}
              noteFields={noteFields}
              noteSaveStatus={noteSaveStatus}
              onCopyTranscript={() => void copyTranscript()}
              onDownloadAudio={() => void downloadAudio()}
              onDownloadTranscript={() => void downloadTranscript()}
              onEditNoteField={updateNoteField}
              onEditTranscriptBlock={(segmentIds, text) =>
                void editTranscriptBlock(segmentIds, text)
              }
              onRename={(title) => void renameMeeting(title)}
              onSelectedDevice={(id) => setSelectedDeviceId(id)}
              onStart={() => void startRecording()}
              onStop={() => void stopRecording()}
              recoveryMeeting={recoveryMeeting}
              onRecover={() => void recoverMeeting()}
              saveStatus={saveStatus}
              selectedDeviceId={selectedDeviceId}
              segments={segments}
              realtimeDebugEvents={realtimeDebugEvents}
              statusLabel={statusLabel}
              timerSeconds={timerSeconds}
              transcriptionError={transcriptionError}
              liveTranscriptEndRef={liveTranscriptEndRef}
              showRealtimeDebug={debugRealtimeEnabled}
            />
          ) : (
            <HomeEmptyState
              onNewMeeting={() => void createMeeting()}
              recoveryMeeting={recoveryMeeting}
              onRecover={() => void recoverMeeting()}
            />
          )}
        </article>
      </main>
    </div>
  );
}

function AuthGate({
  error,
  onPasswordChange,
  onSubmit,
  password
}: {
  error: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  password: string;
}) {
  return (
    <main className="auth-shell">
      <form
        className="auth-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div>
          <div className="sidebar-brand auth-brand">
            <span className="brand-mark">
              <FileText size={14} aria-hidden="true" />
            </span>
            AI Meeting Recorder
          </div>
          <h1>Sign in</h1>
        </div>

        <label className="auth-field">
          <span>Password</span>
          <input
            autoFocus
            data-testid="auth-password-input"
            onChange={(event) => onPasswordChange(event.target.value)}
            type="password"
            value={password}
          />
        </label>

        {error ? (
          <div className="auth-error" data-testid="auth-error">
            {error}
          </div>
        ) : null}

        <button className="button-primary" data-testid="auth-login-button" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}

function HomeEmptyState({
  onNewMeeting,
  recoveryMeeting,
  onRecover
}: {
  onNewMeeting: () => void;
  recoveryMeeting: StoredMeeting | null;
  onRecover: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <h1>AI Meeting Recorder</h1>
        <p>Record a meeting, see the transcript live, and save a searchable note.</p>
        <div className="controls" style={{ justifyContent: "center" }}>
          <button className="button-primary" onClick={onNewMeeting} type="button">
            <Plus size={15} aria-hidden="true" />
            New meeting
          </button>
        </div>
        <p>Browser version records your selected microphone.</p>
        {recoveryMeeting ? (
          <div className="callout" data-testid="recovery-callout">
            <TimerReset size={16} aria-hidden="true" />
            <span>
              We found an unfinished recording.{" "}
              <button
                className="button-secondary"
                data-testid="recover-meeting-button"
                onClick={onRecover}
                type="button"
              >
                Recover meeting
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MeetingDocument({
  copyStatus,
  currentMeeting,
  devices,
  isRecording,
  isSaved,
  micError,
  noteFields,
  noteSaveStatus,
  onCopyTranscript,
  onDownloadAudio,
  onDownloadTranscript,
  onEditNoteField,
  onEditTranscriptBlock,
  onRename,
  onRecover,
  onSelectedDevice,
  onStart,
  onStop,
  recoveryMeeting,
  saveStatus,
  selectedDeviceId,
  segments,
  realtimeDebugEvents,
  statusLabel,
  timerSeconds,
  transcriptionError,
  liveTranscriptEndRef,
  showRealtimeDebug
}: {
  copyStatus: string;
  currentMeeting: StoredMeeting;
  devices: DeviceOption[];
  isRecording: boolean;
  isSaved: boolean;
  micError: string;
  noteFields: NoteFields;
  noteSaveStatus: string;
  onCopyTranscript: () => void;
  onDownloadAudio: () => void;
  onDownloadTranscript: () => void;
  onEditNoteField: (field: keyof NoteFields, value: string) => void;
  onEditTranscriptBlock: (segmentIds: string[], text: string) => void;
  onRename: (title: string) => void;
  onRecover: () => void;
  onSelectedDevice: (id: string) => void;
  onStart: () => void;
  onStop: () => void;
  recoveryMeeting: StoredMeeting | null;
  saveStatus: string;
  selectedDeviceId: string;
  segments: TranscriptSegment[];
  realtimeDebugEvents: RealtimeDebugEvent[];
  statusLabel: string;
  timerSeconds: number;
  transcriptionError: string;
  liveTranscriptEndRef: RefObject<HTMLDivElement | null>;
  showRealtimeDebug: boolean;
}) {
  const metadataParts = [
    formatMeetingDate(currentMeeting.startedAt),
    isSaved ? formatDuration(currentMeeting.durationMs) : null,
    "Mic only",
    isSaved ? "Saved locally" : "Browser-local draft"
  ].filter(Boolean);

  return (
    <>
      <input
        aria-label="Meeting title"
        className="page-title-input"
        data-testid="meeting-title-input"
        onChange={(event) => onRename(event.target.value)}
        placeholder="Untitled meeting"
        value={currentMeeting.title}
      />

      <div className="metadata-row" data-testid="meeting-metadata">
        {metadataParts.map((part, index) => (
          <span key={`${part}-${index}`}>
            {index > 0 ? "· " : ""}
            {part}
          </span>
        ))}
        <span className="metadata-pill">{statusLabel}</span>
      </div>

      <div aria-live="polite" className="sr-status" data-testid="recording-status">
        {statusLabel}
      </div>

      {recoveryMeeting && recoveryMeeting.id !== currentMeeting.id ? (
        <div className="callout" data-testid="recovery-callout">
          <TimerReset size={16} aria-hidden="true" />
          <span>
            We found an unfinished recording.{" "}
            <button
              className="button-secondary"
              data-testid="recover-meeting-button"
              onClick={onRecover}
              type="button"
            >
              Recover meeting
            </button>
          </span>
        </div>
      ) : null}

      {!isSaved ? (
        <div className="field-group">
          <label className="field-label" htmlFor="mic-device-select">
            Microphone
          </label>
          <select
            className="select"
            data-testid="mic-device-select"
            disabled={isRecording}
            id="mic-device-select"
            onChange={(event) => onSelectedDevice(event.target.value)}
            value={selectedDeviceId}
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!isSaved ? (
        <div className="callout warning" data-testid="mic-only-warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            This browser version records your selected microphone. Remote speakers
            may not be captured clearly if you use headphones.
          </span>
        </div>
      ) : null}

      <div
        className={`controls ${isRecording ? "recording" : ""}`}
        data-testid="recording-controls"
      >
        {isRecording ? (
          <>
            <div className="controls-wrap">
              <div className="recording-pill" data-testid="recording-pill">
                <span className="recording-dot" />
                Recording
              </div>
              <div className="timer" data-testid="recording-timer">
                {formatTimer(timerSeconds)}
              </div>
              <div
                aria-hidden="true"
                className="recording-wave"
                data-testid="recording-wave"
              >
                {Array.from({ length: 18 }).map((_, index) => (
                  <span key={index} />
                ))}
              </div>
            </div>
            <button
              aria-label="Stop recording"
              className="button-stop"
              data-testid="stop-recording-button"
              onClick={onStop}
              type="button"
            >
              <Square size={14} aria-hidden="true" />
              Stop
            </button>
          </>
        ) : !isSaved ? (
          <>
            <button
              className="button-primary"
              data-testid="start-recording-button"
              onClick={onStart}
              type="button"
            >
              <Mic size={15} aria-hidden="true" />
              Start recording
            </button>
            <div className="timer" data-testid="recording-timer">
              {formatTimer(timerSeconds)}
            </div>
          </>
        ) : null}
      </div>

      {micError ? (
        <div className="callout danger" data-testid="mic-permission-error">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{micError}</span>
        </div>
      ) : null}

      {transcriptionError ? (
        <div className="callout danger" data-testid="transcription-error">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{transcriptionError}</span>
        </div>
      ) : null}

      {saveStatus ? (
        <div className="callout success" data-testid="save-status">
          <Check size={16} aria-hidden="true" />
          <span>{saveStatus}</span>
        </div>
      ) : (
        <div className="status-line" data-testid="save-status" />
      )}

      {!isSaved ? (
        <>
          <TranscriptSection
            endRef={liveTranscriptEndRef}
            emptyText="Transcript will appear here once recording starts."
            heading="Live transcript"
            segments={segments}
          />
          {showRealtimeDebug ? (
            <RealtimeDebugPanel
              events={realtimeDebugEvents}
              segments={segments}
            />
          ) : null}
        </>
      ) : (
        <>
          <NoteEditor
            fields={noteFields}
            meetingId={currentMeeting.id}
            onChange={onEditNoteField}
            saveStatus={noteSaveStatus}
          />

          <TranscriptSection
            editable
            emptyText="No transcript was captured."
            heading="Transcript"
            onEditBlock={onEditTranscriptBlock}
            segments={segments}
          />
          {showRealtimeDebug ? (
            <RealtimeDebugPanel
              events={realtimeDebugEvents}
              segments={segments}
            />
          ) : null}

          <div className="export-row">
            <button
              className="button-secondary"
              data-testid="copy-transcript-button"
              disabled={segments.length === 0}
              onClick={onCopyTranscript}
              type="button"
            >
              <Copy size={15} aria-hidden="true" />
              Copy transcript
            </button>
            <button
              className="button-secondary"
              data-testid="download-transcript-button"
              disabled={segments.length === 0}
              onClick={onDownloadTranscript}
              type="button"
            >
              <Download size={15} aria-hidden="true" />
              Download transcript
            </button>
            <button
              className="button-secondary"
              data-testid="download-audio-button"
              onClick={onDownloadAudio}
              type="button"
            >
              <Download size={15} aria-hidden="true" />
              Download audio
            </button>
          </div>

          {copyStatus ? <div className="status-line">{copyStatus}</div> : null}
        </>
      )}
    </>
  );
}

function LexicalTextEditor({
  ariaLabel,
  className,
  editable = true,
  editorKey,
  onChange,
  onCommit,
  placeholder,
  testId,
  value
}: {
  ariaLabel: string;
  className: string;
  editable?: boolean;
  editorKey: string;
  onChange?: (text: string) => void;
  onCommit?: (text: string) => void;
  placeholder: string;
  testId?: string;
  value: string;
}) {
  const latestTextRef = useRef(value);
  const lastCommittedTextRef = useRef(value);
  const syncingExternalValueRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);

  const commitText = useCallback(
    (text: string) => {
      if (!onCommit || text === lastCommittedTextRef.current) {
        return;
      }

      lastCommittedTextRef.current = text;
      onCommit(text);
    },
    [onCommit]
  );

  const initialEditorState = useCallback(() => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();

    if (value) {
      paragraph.append($createTextNode(value));
    }

    root.append(paragraph);
  }, [value]);

  const initialConfig = useMemo(
    () => ({
      namespace: `meeting-${editorKey}`,
      editable,
      editorState: initialEditorState,
      onError(error: Error) {
        throw error;
      },
      theme: {
        paragraph: "lexical-paragraph"
      }
    }),
    [editable, editorKey, initialEditorState]
  );

  const handleEditorChange = useCallback(
    (editorState: EditorState) => {
      if (!editable || syncingExternalValueRef.current) {
        return;
      }

      let nextText = "";
      editorState.read(() => {
        nextText = $getRoot().getTextContent();
      });

      latestTextRef.current = nextText;
      onChange?.(nextText);

      if (onCommit) {
        if (commitTimerRef.current) {
          window.clearTimeout(commitTimerRef.current);
        }

        commitTimerRef.current = window.setTimeout(() => {
          commitText(latestTextRef.current);
        }, 700);
      }
    },
    [commitText, editable, onChange, onCommit]
  );

  useEffect(
    () => () => {
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
      }
    },
    []
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="lexical-shell">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={ariaLabel}
              className={className}
              data-testid={testId}
              onBlur={() => commitText(latestTextRef.current)}
              spellCheck
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
          placeholder={
            <div className={`${className} lexical-placeholder`}>
              {placeholder}
            </div>
          }
        />
        <ExternalValuePlugin
          lastCommittedTextRef={lastCommittedTextRef}
          latestTextRef={latestTextRef}
          syncingExternalValueRef={syncingExternalValueRef}
          value={value}
        />
        {editable ? (
          <>
            <HistoryPlugin />
            <OnChangePlugin
              ignoreSelectionChange
              onChange={handleEditorChange}
            />
          </>
        ) : null}
      </div>
    </LexicalComposer>
  );
}

function ExternalValuePlugin({
  lastCommittedTextRef,
  latestTextRef,
  syncingExternalValueRef,
  value
}: {
  lastCommittedTextRef: RefObject<string>;
  latestTextRef: RefObject<string>;
  syncingExternalValueRef: RefObject<boolean>;
  value: string;
}) {
  const [editor] = useLexicalComposerContext();
  const lastExternalValueRef = useRef(value);

  useEffect(() => {
    if (lastExternalValueRef.current === value) {
      return;
    }

    lastExternalValueRef.current = value;

    let currentText = "";
    editor.getEditorState().read(() => {
      currentText = $getRoot().getTextContent();
    });

    latestTextRef.current = value;
    lastCommittedTextRef.current = value;

    if (currentText === value) {
      return;
    }

    syncingExternalValueRef.current = true;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();

      if (value) {
        paragraph.append($createTextNode(value));
      }

      root.append(paragraph);
    });

    window.setTimeout(() => {
      syncingExternalValueRef.current = false;
    }, 0);
  }, [editor, lastCommittedTextRef, latestTextRef, syncingExternalValueRef, value]);

  return null;
}

function NoteEditor({
  fields,
  meetingId,
  onChange,
  saveStatus
}: {
  fields: NoteFields;
  meetingId: string;
  onChange: (field: keyof NoteFields, value: string) => void;
  saveStatus: string;
}) {
  return (
    <section className="section note-editor" data-testid="note-editor">
      <div className="section-heading-row">
        <h2>Notes</h2>
        <span className="note-save-status" data-testid="note-save-status">
          {saveStatus}
        </span>
      </div>

      <div className="note-field" data-testid="summary-section">
        <span>Summary</span>
        <LexicalTextEditor
          ariaLabel="Summary"
          className="note-lexical-editor"
          editorKey={`${meetingId}-summary`}
          key={`${meetingId}-summary`}
          onChange={(text) => onChange("summary", text)}
          placeholder={NOTE_PLACEHOLDERS.summary}
          testId="summary-editor"
          value={fields.summary}
        />
      </div>

      <div className="note-field" data-testid="action-items-section">
        <span>Action items</span>
        <LexicalTextEditor
          ariaLabel="Action items"
          className="note-lexical-editor"
          editorKey={`${meetingId}-action-items`}
          key={`${meetingId}-action-items`}
          onChange={(text) => onChange("actionItems", text)}
          placeholder={NOTE_PLACEHOLDERS.actionItems}
          testId="action-items-editor"
          value={fields.actionItems}
        />
      </div>

      <div className="note-field">
        <span>Notes</span>
        <LexicalTextEditor
          ariaLabel="Notes"
          className="note-lexical-editor"
          editorKey={`${meetingId}-notes`}
          key={`${meetingId}-notes`}
          onChange={(text) => onChange("notes", text)}
          placeholder={NOTE_PLACEHOLDERS.notes}
          testId="notes-editor"
          value={fields.notes}
        />
      </div>
    </section>
  );
}

function RealtimeDebugPanel({
  events,
  segments
}: {
  events: RealtimeDebugEvent[];
  segments: TranscriptSegment[];
}) {
  const deltaCount = events.filter((event) => event.type.endsWith(".delta"))
    .length;
  const completedCount = events.filter((event) =>
    event.type.endsWith(".completed")
  ).length;
  const lastEvent = events[events.length - 1];

  return (
    <section className="debug-panel" data-testid="realtime-debug-panel">
      <div className="debug-panel-title">Realtime debug</div>
      <div className="debug-grid">
        <div>
          <span>Events</span>
          <strong data-testid="realtime-debug-event-count">
            {events.length}
          </strong>
        </div>
        <div>
          <span>Deltas</span>
          <strong>{deltaCount}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>{completedCount}</strong>
        </div>
        <div>
          <span>Segments</span>
          <strong data-testid="realtime-debug-segment-count">
            {segments.length}
          </strong>
        </div>
      </div>
      <div className="debug-last-event" data-testid="realtime-debug-last-event">
        {lastEvent
          ? `${lastEvent.type} ${lastEvent.itemKey ?? ""} ${
              lastEvent.preview ?? ""
            }`
          : "Waiting for realtime events"}
      </div>
      <div className="debug-event-list" data-testid="realtime-debug-events">
        {events.slice(-6).map((event) => (
          <div className="debug-event" key={event.id}>
            <span>{event.type}</span>
            <code>{event.itemKey ?? "no-item"}</code>
            <span>{event.preview}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TranscriptSection({
  editable = false,
  endRef,
  emptyText,
  heading,
  onEditBlock,
  segments
}: {
  editable?: boolean;
  endRef?: RefObject<HTMLDivElement | null>;
  emptyText: string;
  heading: string;
  onEditBlock?: (segmentIds: string[], text: string) => void;
  segments: TranscriptSegment[];
}) {
  const blocks = useMemo(() => buildTranscriptBlocks(segments), [segments]);

  return (
    <section className="section">
      <h2>{heading}</h2>
      <div className="transcript" data-testid="live-transcript">
        {blocks.length === 0 ? (
          <div className="empty-transcript">{emptyText}</div>
        ) : (
          blocks.map((block) => (
            <div
              className={`transcript-block transcript-segment ${
                block.isFinal ? "final" : "provisional"
              }`}
              data-segment-ids={block.segmentIds.join(",")}
              data-testid="transcript-segment"
              data-transcript-block-id={block.id}
              key={block.id}
            >
              <span
                aria-hidden="true"
                className="segment-time transcript-timestamp"
                data-testid="transcript-timestamp"
              >
                {formatTimer(Math.floor((block.startMs ?? 0) / 1000))}
              </span>
              <LexicalTextEditor
                ariaLabel="Transcript paragraph"
                className="transcript-lexical-editor"
                editable={editable}
                editorKey={
                  editable
                    ? `transcript-${block.id}`
                    : `transcript-${block.id}-${block.text}`
                }
                key={
                  editable
                    ? `transcript-${block.id}`
                    : `transcript-${block.id}-${block.text}`
                }
                onCommit={(text) => onEditBlock?.(block.segmentIds, text)}
                placeholder=""
                testId={editable ? "transcript-segment-editor" : undefined}
                value={block.text}
              />
            </div>
          ))
        )}
        {endRef ? <div ref={endRef} className="transcript-end" /> : null}
      </div>
    </section>
  );
}

function mergeTranscriptDelta(existingText: string, deltaText: string) {
  if (!deltaText) {
    return existingText;
  }

  if (!existingText) {
    return deltaText;
  }

  if (deltaText.startsWith(existingText)) {
    return deltaText;
  }

  return `${existingText}${deltaText}`;
}

function getRealtimeItemKey(event: RealtimeServerEvent) {
  if (!event.item_id) {
    return undefined;
  }

  const contentIndex =
    typeof event.content_index === "number" ? event.content_index : 0;

  return `${event.item_id}:${contentIndex}`;
}

function getRealtimeText(event: RealtimeServerEvent) {
  if (event.type === "conversation.item.input_audio_transcription.delta") {
    return event.delta ?? "";
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    return event.transcript ?? "";
  }

  return event.error?.message ?? "";
}

function toRealtimeDebugEvent(event: RealtimeServerEvent): RealtimeDebugEvent {
  const text = getRealtimeText(event);
  const preview = text.length > 80 ? `${text.slice(0, 80)}...` : text;

  return {
    id: createId("debug"),
    at: new Date().toISOString(),
    type: event.type ?? "unknown",
    itemKey: getRealtimeItemKey(event),
    itemId: event.item_id,
    contentIndex: event.content_index,
    textLength: text.length,
    preview
  };
}

function handleRealtimeServerEvent(
  event: RealtimeServerEvent,
  reconcile: (event: {
    itemKey?: string;
    text: string;
    isFinal: boolean;
  }) => Promise<void>,
  recordDebug?: (event: RealtimeDebugEvent) => void
) {
  recordDebug?.(toRealtimeDebugEvent(event));

  if (event.type === "conversation.item.input_audio_transcription.delta") {
    void reconcile({
      itemKey: getRealtimeItemKey(event),
      text: event.delta ?? "",
      isFinal: false
    });
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    void reconcile({
      itemKey: getRealtimeItemKey(event),
      text: event.transcript ?? "",
      isFinal: true
    });
  }
}

async function startRealtimeTranscription(
  stream: MediaStream,
  meetingId: string,
  appendFallback: (input: {
    meetingId: string;
    text: string;
    sequenceIndex: number;
    isFinal: boolean;
  }) => Promise<void>,
  reconcile: (event: {
    itemKey?: string;
    text: string;
    isFinal: boolean;
  }) => Promise<void>,
  recordDebug?: (event: RealtimeDebugEvent) => void
): Promise<RealtimeConnection> {
  const tokenResponse = await fetch("/api/realtime/session", {
    method: "POST",
    body: JSON.stringify({ meetingId }),
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!tokenResponse.ok) {
    const errorPayload = await tokenResponse.json().catch(() => null);
    const errorMessage =
      typeof errorPayload?.error === "string"
        ? errorPayload.error
        : "Unable to create realtime token.";
    throw new Error(errorMessage);
  }

  const tokenPayload = await tokenResponse.json();
  const ephemeralKey = tokenPayload.value ?? tokenPayload.client_secret?.value;

  if (!ephemeralKey) {
    throw new Error("Realtime token response did not include a client secret.");
  }

  const peer = new RTCPeerConnection();
  const dataChannel = peer.createDataChannel("oai-events");
  let commitIntervalId: number | null = null;
  let isClosed = false;

  function recordClientEvent(type: string, preview: string) {
    recordDebug?.({
      id: createId("debug"),
      at: new Date().toISOString(),
      type,
      preview
    });
  }

  function commitInputAudioBuffer(reason: string) {
    if (dataChannel.readyState !== "open") {
      return;
    }

    dataChannel.send(
      JSON.stringify({
        type: "input_audio_buffer.commit"
      })
    );
    recordClientEvent("client.input_audio_buffer.commit", reason);
  }

  stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

  dataChannel.addEventListener("open", () => {
    recordClientEvent("client.data_channel_open", "Realtime data channel open");
    commitIntervalId = window.setInterval(() => {
      commitInputAudioBuffer("periodic commit");
    }, REALTIME_COMMIT_INTERVAL_MS);
  });

  dataChannel.addEventListener("message", (message) => {
    try {
      const event = JSON.parse(message.data) as RealtimeServerEvent;
      handleRealtimeServerEvent(event, reconcile, recordDebug);
    } catch {
      recordDebug?.({
        id: createId("debug"),
        at: new Date().toISOString(),
        type: "client.parse_error",
        preview: "Unable to parse realtime event"
      });
    }
  });

  dataChannel.addEventListener("error", () => {
    recordClientEvent(
      "client.data_channel_error",
      "Realtime data channel error"
    );
    void appendFallback({
      meetingId,
      text: "Live transcription is unavailable, but local recording is still active.",
      sequenceIndex: 0,
      isFinal: true
    });
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      "Content-Type": "application/sdp"
    }
  });

  if (!sdpResponse.ok) {
    peer.close();
    throw new Error("OpenAI realtime WebRTC call failed.");
  }

  await peer.setRemoteDescription({
    type: "answer",
    sdp: await sdpResponse.text()
  });

  return {
    close: () => {
      if (isClosed) {
        return;
      }

      isClosed = true;

      if (commitIntervalId) {
        window.clearInterval(commitIntervalId);
        commitIntervalId = null;
      }

      commitInputAudioBuffer("final commit before close");
      window.setTimeout(() => peer.close(), 1_200);
    }
  };
}

function getTranscriptionFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : "";
  const base =
    "Live transcription is unavailable, but local recording is still active.";

  return detail ? `${base} ${detail}` : base;
}

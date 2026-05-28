"use client";

export type MeetingStatus = "idle" | "recording" | "saved";

export type StoredMeeting = {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  status: MeetingStatus;
  durationMs: number;
  uploadStatus: "local" | "pending" | "synced";
  limitReached?: boolean;
};

export type TranscriptSegment = {
  id: string;
  meetingId: string;
  providerItemId?: string;
  sequenceIndex: number;
  startMs?: number;
  endMs?: number;
  text: string;
  rawText?: string;
  editedText?: string | null;
  isFinal: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AudioChunk = {
  id: string;
  meetingId: string;
  sequenceIndex: number;
  blob: Blob;
  mimeType: string;
  createdAt: string;
};

export type NoteDraft<TFields = unknown> = {
  meetingId: string;
  fields: TFields;
  updatedAt: string;
};

const DB_NAME = "ai-meeting-recorder";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("meetings")) {
        db.createObjectStore("meetings", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("audio_chunks")) {
        const store = db.createObjectStore("audio_chunks", { keyPath: "id" });
        store.createIndex("meetingId", "meetingId", { unique: false });
      }

      if (!db.objectStoreNames.contains("transcript_segments")) {
        const store = db.createObjectStore("transcript_segments", {
          keyPath: "id"
        });
        store.createIndex("meetingId", "meetingId", { unique: false });
      }

      if (!db.objectStoreNames.contains("note_drafts")) {
        db.createObjectStore("note_drafts", { keyPath: "meetingId" });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function putMeeting(meeting: StoredMeeting) {
  const db = await openDatabase();
  const transaction = db.transaction("meetings", "readwrite");
  transaction.objectStore("meetings").put(meeting);
  await transactionDone(transaction);
}

export async function getMeetings() {
  const db = await openDatabase();

  return new Promise<StoredMeeting[]>((resolve, reject) => {
    const transaction = db.transaction("meetings", "readonly");
    const request = transaction.objectStore("meetings").getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve(
        (request.result as StoredMeeting[]).sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        )
      );
  });
}

export async function putTranscriptSegment(segment: TranscriptSegment) {
  const db = await openDatabase();
  const transaction = db.transaction("transcript_segments", "readwrite");
  transaction.objectStore("transcript_segments").put(segment);
  await transactionDone(transaction);
}

export async function getTranscriptSegments(meetingId: string) {
  const db = await openDatabase();

  return new Promise<TranscriptSegment[]>((resolve, reject) => {
    const transaction = db.transaction("transcript_segments", "readonly");
    const index = transaction
      .objectStore("transcript_segments")
      .index("meetingId");
    const request = index.getAll(meetingId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve(
        (request.result as TranscriptSegment[]).sort(
          (a, b) => a.sequenceIndex - b.sequenceIndex
        )
      );
  });
}

export async function putAudioChunk(chunk: AudioChunk) {
  const db = await openDatabase();
  const transaction = db.transaction("audio_chunks", "readwrite");
  transaction.objectStore("audio_chunks").put(chunk);
  await transactionDone(transaction);
}

export async function getAudioChunks(meetingId: string) {
  const db = await openDatabase();

  return new Promise<AudioChunk[]>((resolve, reject) => {
    const transaction = db.transaction("audio_chunks", "readonly");
    const index = transaction.objectStore("audio_chunks").index("meetingId");
    const request = index.getAll(meetingId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve(
        (request.result as AudioChunk[]).sort(
          (a, b) => a.sequenceIndex - b.sequenceIndex
        )
      );
  });
}

export async function putNoteDraft<TFields>(draft: NoteDraft<TFields>) {
  const db = await openDatabase();
  const transaction = db.transaction("note_drafts", "readwrite");
  transaction.objectStore("note_drafts").put(draft);
  await transactionDone(transaction);
}

export async function getNoteDraft<TFields>(meetingId: string) {
  const db = await openDatabase();

  return new Promise<NoteDraft<TFields> | null>((resolve, reject) => {
    const transaction = db.transaction("note_drafts", "readonly");
    const request = transaction.objectStore("note_drafts").get(meetingId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve((request.result as NoteDraft<TFields> | undefined) ?? null);
  });
}

export async function deleteNoteDraft(meetingId: string) {
  const db = await openDatabase();
  const transaction = db.transaction("note_drafts", "readwrite");
  transaction.objectStore("note_drafts").delete(meetingId);
  await transactionDone(transaction);
}

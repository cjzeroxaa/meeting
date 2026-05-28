import { type NoteFields } from "@/lib/server/notes";

const RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_SUMMARY_MODEL = "gpt-5.5";
const MAX_TRANSCRIPT_CHARS = 120_000;

export class OpenAISummaryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAISummaryConfigError";
  }
}

export class OpenAISummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAISummaryError";
  }
}

type SummarySegment = {
  sequenceIndex: number;
  startMs?: number | null;
  text: string;
};

type GenerateMeetingNoteInput = {
  title: string;
  transcript: string;
};

type ResponsesApiPayload = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

export function getSummaryModel() {
  return process.env.OPENAI_SUMMARY_MODEL?.trim() || DEFAULT_SUMMARY_MODEL;
}

export function formatTranscriptForSummary(segments: SummarySegment[]) {
  return segments
    .slice()
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
    .map((segment) => {
      const text = segment.text.trim();

      if (!text) {
        return "";
      }

      return `[${formatOffset(segment.startMs)}] ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function createMockMeetingNoteFields({
  title,
  transcript
}: GenerateMeetingNoteInput): NoteFields {
  const firstLine =
    transcript
      .split("\n")
      .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
      .find(Boolean) ?? "No transcript text.";

  return {
    summary: `Generated summary for ${title}: ${firstLine}`,
    actionItems: "No explicit action items identified.",
    notes: `Generated notes from transcript: ${firstLine}`
  };
}

export async function generateMeetingNoteFields(
  input: GenerateMeetingNoteInput
): Promise<{ fields: NoteFields; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new OpenAISummaryConfigError("OPENAI_API_KEY is not configured.");
  }

  const model = getSummaryModel();
  const transcript = input.transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  const response = await fetch(RESPONSES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions:
        "Generate concise meeting notes from a transcript. Use only the transcript and existing title. Do not invent owners, dates, decisions, or action items. If no action items are explicit, say that none were identified.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Meeting title: ${input.title || "Untitled meeting"}\n\nTranscript:\n${transcript}`
            }
          ]
        }
      ],
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "meeting_notes",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: {
                type: "string",
                description:
                  "A concise summary of the meeting in one short paragraph or a few compact bullets."
              },
              actionItems: {
                type: "string",
                description:
                  "Bullet-style action items with owner and due date only when explicitly stated. Say 'No explicit action items identified.' when none are present."
              },
              notes: {
                type: "string",
                description:
                  "Important details, decisions, questions, risks, and follow-ups from the transcript."
              }
            },
            required: ["summary", "actionItems", "notes"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    throw new OpenAISummaryError(
      `OpenAI summary request failed with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as ResponsesApiPayload;
  const outputText = extractResponseOutputText(payload);

  if (!outputText) {
    throw new OpenAISummaryError("OpenAI summary response did not include text.");
  }

  return { fields: parseNoteFields(outputText), model };
}

function formatOffset(value?: number | null) {
  const totalSeconds = Math.max(0, Math.floor((value ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function extractResponseOutputText(payload: ResponsesApiPayload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  for (const output of payload.output ?? []) {
    for (const item of output.content ?? []) {
      if (item.type === "refusal" && item.refusal) {
        throw new OpenAISummaryError("OpenAI refused to generate meeting notes.");
      }

      if (item.type === "output_text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }

  return "";
}

function parseNoteFields(value: string): NoteFields {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OpenAISummaryError("OpenAI summary response was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OpenAISummaryError("OpenAI summary response was not an object.");
  }

  const record = parsed as Record<string, unknown>;
  const fields = {
    summary: toTrimmedString(record.summary),
    actionItems: toTrimmedString(record.actionItems),
    notes: toTrimmedString(record.notes)
  };

  if (!fields.summary && !fields.actionItems && !fields.notes) {
    throw new OpenAISummaryError("OpenAI summary response was empty.");
  }

  return fields;
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

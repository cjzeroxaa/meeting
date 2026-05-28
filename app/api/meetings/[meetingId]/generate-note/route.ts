import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { jsonError, jsonRouteError } from "@/lib/server/http";
import { getMeetingDetail, updateNoteDocument } from "@/lib/server/meetings";
import {
  createMockMeetingNoteFields,
  formatTranscriptForSummary,
  generateMeetingNoteFields,
  OpenAISummaryConfigError,
  OpenAISummaryError
} from "@/lib/server/openai-summary";
import {
  buildNoteDocumentContent,
  type NoteFields,
  noteFieldsToContentText
} from "@/lib/server/notes";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const detail = await getMeetingDetail(meetingId, user.id);

    if (!detail) {
      return jsonError(404, "meeting_not_found", "Meeting not found.");
    }

    if (detail.meeting.status !== "saved") {
      return jsonError(
        409,
        "meeting_not_finished",
        "Finish the meeting before generating notes."
      );
    }

    const transcript = formatTranscriptForSummary(detail.transcriptSegments);

    if (!transcript) {
      return jsonError(
        422,
        "empty_transcript",
        "A transcript is required before notes can be generated."
      );
    }

    const generation = shouldUseMockSummary(request)
      ? {
          fields: createMockMeetingNoteFields({
            title: detail.meeting.title,
            transcript
          }),
          model: "mock"
        }
      : await generateMeetingNoteFields({
          title: detail.meeting.title,
          transcript
        });
    const fields = preserveExistingNoteText({
      fields: generation.fields,
      title: detail.meeting.title,
      contentText: detail.noteDocument.contentText
    });
    const contentJson = buildNoteDocumentContent(
      detail.meeting.title,
      fields
    );
    const result = await updateNoteDocument({
      meetingId,
      ownerUserId: user.id,
      expectedVersion: detail.noteDocument.version,
      contentJson,
      contentText: noteFieldsToContentText(detail.meeting.title, fields),
      editedBy: user.id,
      changeSource: "summary_generation"
    });

    if (result.status === "not_found") {
      return jsonError(404, "note_document_not_found", "Note document not found.");
    }

    if (result.status === "conflict") {
      return NextResponse.json(
        {
          error: "version_conflict",
          message:
            "This note changed before generated notes could be saved. Reload the meeting and try again.",
          latestVersion: result.latestVersion
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      status: "generated",
      model: generation.model,
      fields,
      noteDocument: result.document
    });
  } catch (error) {
    if (error instanceof OpenAISummaryConfigError) {
      return jsonError(
        503,
        "summary_not_configured",
        "OpenAI summary generation is not configured."
      );
    }

    if (error instanceof OpenAISummaryError) {
      return jsonError(
        502,
        "summary_generation_failed",
        "Could not generate meeting notes."
      );
    }

    return jsonRouteError(
      error,
      "generate_note_failed",
      "Could not generate meeting notes."
    );
  }
}

function shouldUseMockSummary(request: NextRequest) {
  return (
    process.env.NODE_ENV !== "production" &&
    request.headers.get("x-meeting-summary-mock") === "1"
  );
}

function preserveExistingNoteText({
  fields,
  title,
  contentText
}: {
  fields: NoteFields;
  title: string;
  contentText: string;
}) {
  const existingText = getExistingUserText(contentText, title);

  if (!existingText || fields.notes.includes(existingText)) {
    return fields;
  }

  return {
    ...fields,
    notes: [fields.notes, `Existing notes:\n${existingText}`]
      .filter(Boolean)
      .join("\n\n")
  };
}

function getExistingUserText(contentText: string, title: string) {
  const ignored = new Set([
    title.trim() || "Untitled meeting",
    "Untitled meeting",
    "This browser version records your selected microphone.",
    "Summary",
    "Action items",
    "Notes",
    "No summary generated yet.",
    "No action items yet.",
    "No action items generated yet."
  ]);

  return contentText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !ignored.has(line))
    .join("\n");
}

import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { asNumber, asString, isRecord, jsonError, jsonRouteError, readJson } from "@/lib/server/http";
import { getNoteDocument, updateNoteDocument } from "@/lib/server/meetings";
import { extractContentText } from "@/lib/server/notes";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const noteDocument = await getNoteDocument(meetingId, user.id);

    if (!noteDocument) {
      return jsonError(404, "note_document_not_found", "Note document not found.");
    }

    return NextResponse.json(noteDocument);
  } catch (error) {
    return jsonRouteError(error, "get_note_failed", "Could not get note document.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const body = await readJson(request);

    if (!isRecord(body) || !isRecord(body.contentJson)) {
      return jsonError(400, "invalid_request", "contentJson is required.");
    }

    const expectedVersion = asNumber(body.expectedVersion);

    if (!expectedVersion) {
      return jsonError(400, "invalid_expected_version");
    }

    const contentText = asString(
      body.contentText,
      extractContentText(body.contentJson)
    );
    const result = await updateNoteDocument({
      meetingId,
      ownerUserId: user.id,
      expectedVersion,
      contentJson: body.contentJson as { type: "doc"; content: unknown[] },
      contentText,
      editedBy: user.id
    });

    if (result.status === "not_found") {
      return jsonError(404, "note_document_not_found", "Note document not found.");
    }

    if (result.status === "conflict") {
      return NextResponse.json(
        {
          error: "version_conflict",
          message:
            "This note changed elsewhere. Reload the latest version before saving.",
          latestVersion: result.latestVersion
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      status: "saved",
      version: result.document.version,
      noteDocument: result.document
    });
  } catch (error) {
    return jsonRouteError(error, "update_note_failed", "Could not update note document.");
  }
}

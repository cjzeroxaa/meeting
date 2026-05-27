import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { jsonRouteError } from "@/lib/server/http";
import { listNoteRevisions } from "@/lib/server/meetings";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ meetingId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { meetingId } = await params;
    const revisions = await listNoteRevisions(meetingId, user.id);

    return NextResponse.json({ revisions });
  } catch (error) {
    return jsonRouteError(
      error,
      "list_note_revisions_failed",
      "Could not list note revisions."
    );
  }
}

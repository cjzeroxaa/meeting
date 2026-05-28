export type NoteDocumentContent = {
  type: "doc";
  content: unknown[];
};

export type NoteFields = {
  summary: string;
  actionItems: string;
  notes: string;
};

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

export function buildNoteDocumentContent(
  title: string,
  fields: NoteFields
): NoteDocumentContent {
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

export function noteFieldsToContentText(title: string, fields: NoteFields) {
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

export function createInitialNoteDocument(title: string): NoteDocumentContent {
  return buildNoteDocumentContent(title, {
    summary: "",
    actionItems: "",
    notes: ""
  });
}

export function extractContentText(value: unknown): string {
  const parts: string[] = [];

  function visit(node: unknown) {
    if (!node || typeof node !== "object") {
      return;
    }

    if ("text" in node && typeof node.text === "string") {
      parts.push(node.text);
    }

    if ("content" in node && Array.isArray(node.content)) {
      node.content.forEach(visit);
    }
  }

  visit(value);
  return parts.join("\n").trim();
}

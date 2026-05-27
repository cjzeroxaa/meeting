export type NoteDocumentContent = {
  type: "doc";
  content: unknown[];
};

export function createInitialNoteDocument(title: string): NoteDocumentContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: title || "Untitled meeting" }]
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "This browser version records your selected microphone."
          }
        ]
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Summary" }]
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "No summary generated yet." }]
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Action items" }]
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "No action items yet." }]
      }
    ]
  };
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

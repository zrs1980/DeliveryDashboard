export async function prependToCanvas(markdown: string, canvasId?: string | null): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const id    = canvasId || process.env.SLACK_WEEKLY_CANVAS_ID;

  if (!token || !id) {
    throw new Error("SLACK_BOT_TOKEN or canvas ID not configured");
  }

  const res = await fetch("https://slack.com/api/canvases.edit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      canvas_id: id,
      changes: [
        {
          operation: "insert_at_start",
          document_content: {
            type: "markdown",
            markdown,
          },
        },
      ],
    }),
  });

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack canvases.edit error: ${data.error ?? "unknown"}`);
  }
}

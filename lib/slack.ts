export async function prependToCanvas(markdown: string): Promise<void> {
  const token    = process.env.SLACK_BOT_TOKEN;
  const canvasId = process.env.SLACK_WEEKLY_CANVAS_ID;

  if (!token || !canvasId) {
    throw new Error("SLACK_BOT_TOKEN or SLACK_WEEKLY_CANVAS_ID env vars are not set");
  }

  const res = await fetch("https://slack.com/api/canvases.edit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      canvas_id: canvasId,
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

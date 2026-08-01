// ─── Meeting document renderer ────────────────────────────────────────────────
// Builds the HTML that Drive converts into a formatted Google Doc. Client-safe:
// the wizard renders a preview from the same source, so what's previewed is what
// gets filed.

export interface DocAttendee { name: string; email: string; internal: boolean }
export interface DocSummary {
  overview?: string; shortSummary?: string;
  actionItems: string[]; keywords: string[]; bulletGist: string[];
}
export interface DocSentence { index: number; text: string; speaker: string }

export interface MeetingDocInput {
  title:           string;
  date:            string;          // ISO
  durationMinutes: number;
  organizerEmail:  string;
  meetingLink?:    string | null;
  transcriptUrl?:  string | null;
  attendees:       DocAttendee[];
  summary:         DocSummary | null;
  sentences:       DocSentence[];
  /** Where it's being filed, for the header. */
  customerName?:   string;
  projectName?:    string;
  preparedBy?:     string;
}

/** Escape for HTML text nodes and attribute values. */
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "Unknown date"
    : d.toLocaleString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const fmtDuration = (mins: number) => {
  if (!mins) return "—";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Filename for the Doc — date-first so a folder sorts chronologically. */
export function meetingDocName(input: Pick<MeetingDocInput, "title" | "date">): string {
  const d = new Date(input.date);
  const stamp = isNaN(d.getTime())
    ? "undated"
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const title = (input.title || "Meeting").replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${stamp} — ${title}`;
}

/**
 * Full document. Notes come before the transcript deliberately: the summary and
 * action items are what anyone opening this later actually needs, and a transcript
 * can run to hundreds of lines.
 */
export function renderMeetingDocHtml(input: MeetingDocInput): string {
  const external = input.attendees.filter(a => !a.internal);
  const internal = input.attendees.filter(a => a.internal);
  const s = input.summary;

  const parts: string[] = [];

  parts.push(`<h1>${esc(input.title)}</h1>`);

  const filedInto = [input.customerName, input.projectName].filter(Boolean).join(" › ");
  parts.push("<table><tbody>");
  const row = (k: string, v: string) => `<tr><td><b>${esc(k)}</b></td><td>${v}</td></tr>`;
  parts.push(row("Date", esc(fmtDate(input.date))));
  parts.push(row("Duration", esc(fmtDuration(input.durationMinutes))));
  if (input.organizerEmail) parts.push(row("Organiser", esc(input.organizerEmail)));
  if (filedInto)            parts.push(row("Project", esc(filedInto)));
  if (external.length)      parts.push(row("Client attendees", external.map(a => esc(a.name || a.email)).join(", ")));
  if (internal.length)      parts.push(row("Loop attendees", internal.map(a => esc(a.name || a.email)).join(", ")));
  if (input.transcriptUrl)  parts.push(row("Source", `<a href="${esc(input.transcriptUrl)}">View in Fireflies</a>`));
  parts.push("</tbody></table>");

  // ── Notes ──
  if (s) {
    parts.push("<h2>Summary</h2>");
    if (s.overview)          parts.push(`<p>${esc(s.overview).replace(/\n+/g, "</p><p>")}</p>`);
    else if (s.shortSummary) parts.push(`<p>${esc(s.shortSummary)}</p>`);

    if (s.actionItems.length) {
      parts.push("<h2>Action items</h2><ul>");
      for (const a of s.actionItems) parts.push(`<li>${esc(a)}</li>`);
      parts.push("</ul>");
    }
    if (s.bulletGist.length) {
      parts.push("<h2>Key points</h2><ul>");
      for (const b of s.bulletGist) parts.push(`<li>${esc(b)}</li>`);
      parts.push("</ul>");
    }
    if (s.keywords.length) {
      parts.push(`<p><b>Topics:</b> ${esc(s.keywords.join(", "))}</p>`);
    }
  } else {
    parts.push("<h2>Summary</h2><p><i>No AI summary was available for this meeting.</i></p>");
  }

  // ── Transcript ──
  parts.push("<h2>Transcript</h2>");
  if (input.sentences.length === 0) {
    parts.push("<p><i>No transcript text was available for this meeting.</i></p>");
  } else {
    // Group consecutive lines by speaker so it reads as dialogue rather than a list.
    let currentSpeaker: string | null = null;
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      const who = currentSpeaker ? `<b>${esc(currentSpeaker)}:</b> ` : "";
      parts.push(`<p>${who}${esc(buffer.join(" "))}</p>`);
      buffer = [];
    };
    for (const line of input.sentences) {
      const speaker = line.speaker || "";
      if (speaker !== currentSpeaker) { flush(); currentSpeaker = speaker; }
      buffer.push(line.text);
    }
    flush();
  }

  const footer = [
    "Filed from the Loop Services delivery dashboard",
    input.preparedBy ? `by ${input.preparedBy}` : "",
    `on ${new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}`,
  ].filter(Boolean).join(" ");
  parts.push(`<hr /><p><small>${esc(footer)}</small></p>`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(input.title)}</title></head><body>${parts.join("\n")}</body></html>`;
}

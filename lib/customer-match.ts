// ─── Matching a meeting to a customer folder ──────────────────────────────────
//
// Two layers. A deterministic scorer runs first and always produces an answer; a
// Claude pass then re-ranks with the context a string comparison can't see (that
// "Oxide Computer Company" and an oxidecomputer.com attendee are the same client,
// or that a folder is an abbreviation). If Anthropic is unavailable the fuzzy
// result stands on its own — matching must never hard-depend on the model.

import type { DriveFolder } from "./google-drive";
import { isInternalEmail } from "./constants";

export interface MatchCandidate {
  folderId:   string;
  folderName: string;
  score:      number;      // 0–1
  reason:     string;
}

export interface MatchContext {
  title:      string;
  attendees:  Array<{ name: string; email: string }>;
  overview?:  string;
}

// ─── Deterministic scoring ────────────────────────────────────────────────────

/** Drop punctuation and company suffixes so "Oxide Computer Company, Inc." ≈ "oxide computer". */
const STOP = new Set([
  "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company",
  "the", "and", "group", "holdings", "plc", "pty", "gmbh", "sa", "llp",
]);

function tokens(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t));
}

/** External email domains, minus the public-mailbox providers that say nothing. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
  "aol.com", "protonmail.com", "live.com", "msn.com",
]);

function externalDomainTokens(attendees: MatchContext["attendees"]): string[] {
  const out: string[] = [];
  for (const a of attendees) {
    const email = (a.email ?? "").toLowerCase();
    if (!email.includes("@") || isInternalEmail(email)) continue;
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (PUBLIC_DOMAINS.has(domain)) continue;
    // "oxidecomputer.com" → ["oxidecomputer"]; keep the whole label, since a folder
    // name's tokens are matched against it by prefix below.
    const label = domain.split(".")[0];
    if (label && label.length > 2) out.push(label);
  }
  return [...new Set(out)];
}

/**
 * Score a folder against the meeting. Domain evidence is weighted hardest: an
 * attendee at oxidecomputer.com is far stronger evidence than the word "oxide"
 * appearing in a meeting title.
 */
export function scoreFolders(folders: DriveFolder[], ctx: MatchContext): MatchCandidate[] {
  const titleTokens  = tokens(ctx.title);
  const domainLabels = externalDomainTokens(ctx.attendees);
  const attendeeNameTokens = tokens(ctx.attendees.map(a => a.name).join(" "));

  return folders
    .map(f => {
      const fTokens = tokens(f.name);
      if (fTokens.length === 0) return { folderId: f.id, folderName: f.name, score: 0, reason: "" };

      const reasons: string[] = [];
      let score = 0;

      // Domain match — a folder token appearing inside an attendee's email domain.
      const domainHit = fTokens.some(t => domainLabels.some(d => d.includes(t) || t.includes(d)));
      if (domainHit) { score += 0.6; reasons.push("attendee email domain"); }

      // Title overlap, proportional to how much of the folder name is present.
      const titleHits = fTokens.filter(t => titleTokens.includes(t)).length;
      if (titleHits > 0) {
        score += 0.3 * (titleHits / fTokens.length);
        reasons.push("meeting title");
      }

      // Whole folder name appearing in the title, e.g. "Oxide" in "Oxide Integration".
      if (fTokens.length > 0 && fTokens.every(t => titleTokens.includes(t))) {
        score += 0.15;
      }

      // Attendee display names occasionally carry the company.
      if (fTokens.some(t => attendeeNameTokens.includes(t))) {
        score += 0.05;
        reasons.push("attendee name");
      }

      return {
        folderId: f.id,
        folderName: f.name,
        score: Math.min(1, Math.round(score * 100) / 100),
        reason: reasons.length ? `Matched on ${reasons.join(" and ")}` : "",
      };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Compact context string for the model. */
export function matchPrompt(ctx: MatchContext, folders: DriveFolder[], fuzzy: MatchCandidate[]): string {
  const externals = ctx.attendees.filter(a => a.email && !isInternalEmail(a.email));

  return `Match this meeting to the client it belongs to, choosing from the Google Drive customer folders listed.

MEETING TITLE: ${ctx.title}
EXTERNAL ATTENDEES: ${externals.length ? externals.map(a => `${a.name || "?"} <${a.email}>`).join(", ") : "none"}
${ctx.overview ? `SUMMARY: ${ctx.overview.slice(0, 500)}` : ""}

CUSTOMER FOLDERS (id → name):
${folders.map(f => `${f.id} → ${f.name}`).join("\n")}

A simple string match already suggested:
${fuzzy.length ? fuzzy.slice(0, 5).map(c => `${c.folderName} (${c.score})`).join(", ") : "nothing"}

Rules:
- The external attendees' email domain is the strongest signal. An attendee at
  oxidecomputer.com almost certainly means the "Oxide Computer Company" folder,
  even if the wording differs.
- Internal Loop Services people (loopservices.co, looperp.ai, cebasolutions.com)
  say nothing about which client it is — ignore them.
- Folder names may be abbreviations, trading names or include legal suffixes.
- If there is genuinely no good match — an internal meeting, or a client with no
  folder — return an empty folderId and say so. Do not force a guess.
- Confidence: 0.9+ only when the domain matches the folder unambiguously; 0.5–0.8
  for a reasonable inference; below 0.5 when it's a guess.`;
}

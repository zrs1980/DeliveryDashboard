/**
 * Import an edited contacts CSV back.
 *
 *   npx tsx --env-file=.env.vercel scripts/import-contacts.ts exports/contacts-2026-10-01.csv
 *   npx tsx --env-file=.env.vercel scripts/import-contacts.ts <file> --write
 *
 * Dry run by default: it prints every change it would make, field by field,
 * and writes nothing until `--write`.
 *
 * ─── What it will and will not do ───────────────────────────────────────────
 *
 * ⚠ IT ONLY UPDATES. It never creates a contact and never deletes one. A row
 * with no `id`, or an `id` not in the database, is REPORTED and skipped — this
 * pair exists to correct what is already there, and a spreadsheet is the last
 * place you want to discover you have invented 200 people.
 *
 * ⚠ IT MATCHES ON `id` AND NOTHING ELSE. Not email, not name. Matching on
 * anything a human just edited means a corrected spelling silently becomes a
 * different person.
 *
 * ⚠ AN EMPTY CELL CLEARS THE FIELD; A MISSING COLUMN LEAVES IT ALONE. Those are
 * different intentions and the file can express both. Delete the `phone` column
 * entirely and no phone is touched; blank one phone cell and that phone is
 * cleared. The exception is below.
 *
 * ⚠ IT WILL NOT BLANK A NAME. Clearing both first and last would leave a
 * contact unfindable, which is far more likely a dragged cell than a decision.
 * Such a row is reported and skipped.
 *
 * `name` is DERIVED from first + last, matching the API: editing the `name`
 * column does nothing, because `name` is what ordering, search and the CSM
 * agent read, and two sources for it is how a half-rename happens.
 */

import { readFileSync } from "node:fs";
import { getSupabaseAdmin } from "@/lib/supabase";

const ROLES = ["economic_buyer", "champion", "admin", "end_user", "technical", "unknown"];

/** Fields a human may edit. `customer` and `name` are context and derived. */
const EDITABLE = ["first_name", "last_name", "job_title", "email", "phone", "mobile", "role", "notes"] as const;

/** Minimal RFC 4180 parser — quoted fields, escaped quotes, newlines inside cells. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "");       // Excel's BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r") { /* handled by \n */ }
    else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  return out.filter(r => r.some(c => c.trim() !== ""));
}

async function main() {
  const file = process.argv[2];
  const write = process.argv.includes("--write");
  if (!file) throw new Error("Usage: import-contacts.ts <file.csv> [--write]");

  const grid = parseCsv(readFileSync(file, "utf8"));
  if (grid.length < 2) throw new Error("Nothing in that file beyond a header.");

  const header = grid[0].map(h => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  if (col("id") === -1) {
    throw new Error("No `id` column. That column is how a row is matched; without it nothing can be imported safely.");
  }
  // Only columns actually present are considered — a deleted column means
  // "leave this field alone", which is different from a blank cell.
  const present = EDITABLE.filter(f => col(f) !== -1);
  console.log(`Columns being imported: ${present.join(", ") || "(none)"}\n`);
  if (!present.length) { console.log("No editable columns in the file."); return; }

  const db = getSupabaseAdmin();
  const { data: existing, error } = await db
    .from("pm_crm_contacts")
    .select("id, name, first_name, last_name, job_title, email, phone, mobile, role, notes");
  if (error) throw new Error(error.message);
  const byId = new Map((existing ?? []).map(r => [String(r.id), r as Record<string, unknown>]));

  const updates: { id: string; patch: Record<string, unknown>; who: string;
                   diff: string[]; onlyNormalised: boolean }[] = [];
  const problems: string[] = [];

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const id = (r[col("id")] ?? "").trim();
    const label = `row ${i + 1}`;

    if (!id) { problems.push(`${label}: no id — skipped. This tool updates, it never creates.`); continue; }
    const cur = byId.get(id);
    if (!cur) { problems.push(`${label}: id ${id} is not in the database — skipped.`); continue; }

    const patch: Record<string, unknown> = {};
    const diff: string[] = [];
    /**
     * A CHANGE NOBODY TYPED IS REPORTED SEPARATELY. Emails are stored
     * lower-cased — the API does it and the unique index is on `lower(email)` —
     * but 19 contacts carry mixed case from the old NetSuite import. Without
     * this split, re-importing an UNTOUCHED file announced 19 changes, which
     * reads as the tool inventing edits and is how someone stops trusting a
     * dry run.
     */
    let edited = false;

    for (const f of present) {
      const raw = (r[col(f)] ?? "").trim();
      const next = f === "email" ? raw.toLowerCase() : raw;
      const now  = cur[f] === null || cur[f] === undefined ? "" : String(cur[f]);
      if (next === now) continue;

      if (f === "role" && next && !ROLES.includes(next)) {
        problems.push(`${label}: role "${next}" is not one of ${ROLES.join(", ")} — field skipped.`);
        continue;
      }
      const caseOnly = f === "email" && next === now.toLowerCase();
      if (!caseOnly) edited = true;
      patch[f] = next === "" ? null : next;
      diff.push(`${f}: ${now || "—"} → ${next || "—"}${caseOnly ? "   (case only)" : ""}`);
    }

    if (!Object.keys(patch).length) continue;

    // `name` follows its parts, exactly as the PATCH route does.
    const first = "first_name" in patch ? String(patch.first_name ?? "") : String(cur.first_name ?? "");
    const last  = "last_name"  in patch ? String(patch.last_name  ?? "") : String(cur.last_name  ?? "");
    if ("first_name" in patch || "last_name" in patch) {
      const joined = [first, last].filter(Boolean).join(" ").trim();
      if (!joined) {
        problems.push(`${label}: clearing both names would leave "${cur.name}" unfindable — row skipped.`);
        continue;
      }
      if (joined !== String(cur.name ?? "")) {
        patch.name = joined;
        diff.push(`name: ${cur.name} → ${joined}`);
      }
    }

    updates.push({ id, patch, who: String(cur.name ?? id), diff, onlyNormalised: !edited });
  }

  const edits = updates.filter(u => !u.onlyNormalised);
  const norm  = updates.filter(u => u.onlyNormalised);

  console.log(`${grid.length - 1} data row(s) \u00b7 ${edits.length} edited \u00b7 `
            + `${norm.length} email case-only \u00b7 ${problems.length} problem(s)\n`);

  for (const u of edits.slice(0, 60)) {
    console.log(`  ${u.who}`);
    for (const d of u.diff) console.log(`      ${d}`);
  }
  if (edits.length > 60) console.log(`  \u2026and ${edits.length - 60} more edited`);
  if (!edits.length) console.log(`  (no edits found in this file)`);

  if (norm.length) {
    console.log(`\n  ${norm.length} contact(s) have a mixed-case email stored from the old`);
    console.log(`  NetSuite import. Applying lower-cases them, matching the app's own`);
    console.log(`  write path and the lower(email) unique index. Nobody typed these.`);
  }

  if (problems.length) {
    console.log(`\n⚠ Problems:`);
    for (const p of problems) console.log(`  · ${p}`);
  }

  if (!write) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write to apply.`);
    return;
  }

  let done = 0;
  for (const u of updates) {
    const { error: e } = await db.from("pm_crm_contacts").update(u.patch).eq("id", u.id);
    if (e) { console.log(`  ⚠ ${u.who}: ${e.message}`); continue; }
    done++;
  }
  console.log(`\nUpdated ${done} of ${updates.length} contact(s).`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });

/**
 * Export every contact to CSV, for editing in a spreadsheet and importing back.
 *
 *   npx tsx --env-file=.env.vercel scripts/export-contacts.ts
 *
 * Writes `exports/contacts-<date>.csv`.
 *
 * ⚠ THE `id` COLUMN IS THE WHOLE SAFETY MECHANISM. The importer matches on it
 * and nothing else: not name, not email. Delete the column, reorder the file,
 * sort it, filter it — all fine. **Blank an id and that row cannot be imported**
 * rather than being silently matched to the wrong person. Add a row with no id
 * and it is reported, not created: this pair is for CORRECTING what exists.
 *
 * ⚠ `customer` and `name` are CONTEXT, not inputs. The importer ignores both.
 * `customer` tells you who you are looking at while you edit; `name` is derived
 * from first + last on the way back in, so editing it does nothing. Edit the
 * parts.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { getSupabaseAdmin } from "@/lib/supabase";

/** RFC 4180: quote everything, double any quote inside. Titles contain commas. */
const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
};

// Order matters for a human: who, then what to fix, then what we guessed.
const COLUMNS = [
  "id",              // ⚠ never edit
  "customer",        // context only, ignored on import
  "name",            // derived on import, ignored
  "first_name",
  "last_name",
  "job_title",
  "email",
  "phone",
  "mobile",
  "role",
  "suggested_role",  // what the model proposed; copy into role to accept
  "suggested_role_reason",
  "is_primary",
  "notes",
] as const;

async function main() {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("pm_crm_contacts")
    .select("id, customer_ns_id, name, first_name, last_name, job_title, email, " +
            "phone, mobile, role, suggested_role, suggested_role_reason, is_primary, notes, is_active")
    .eq("is_active", true)
    .order("customer_ns_id")
    .order("name");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  // Customer names, so the editor knows whose contact they are looking at.
  const { data: idx } = await db.from("cs_customer_index").select("customer_ns_id, name");
  const nameOf = new Map((idx ?? []).map(r => [r.customer_ns_id, r.name]));

  const lines = [COLUMNS.map(cell).join(",")];
  for (const r of rows) {
    lines.push(COLUMNS.map(c =>
      cell(c === "customer"
        ? nameOf.get(String(r.customer_ns_id)) ?? r.customer_ns_id
        : r[c])
    ).join(","));
  }

  mkdirSync("exports", { recursive: true });
  const file = `exports/contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  // BOM so Excel opens UTF-8 names correctly rather than mangling accents.
  writeFileSync(file, "﻿" + lines.join("\r\n") + "\r\n", "utf8");

  const titled = rows.filter(r => String(r.job_title ?? "").trim()).length;
  const roled  = rows.filter(r => r.role && r.role !== "unknown").length;
  const sugg   = rows.filter(r => r.suggested_role).length;

  console.log(`Wrote ${file}`);
  console.log(`  contacts (active) : ${rows.length}`);
  console.log(`  with a job title  : ${titled}`);
  console.log(`  with a role set   : ${roled}`);
  console.log(`  with a suggestion : ${sugg}  (copy suggested_role into role to accept)`);
  console.log(`\n  Edit first_name, last_name, job_title, email, phone, mobile, role, notes.`);
  console.log(`  Leave id alone — it is how the import finds the row.`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });

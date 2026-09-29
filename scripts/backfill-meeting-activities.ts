/**
 * Put already-processed meetings onto their customer's timeline.
 *
 *   npx tsx --env-file=.env.vercel scripts/backfill-meeting-activities.ts
 *   npx tsx --env-file=.env.vercel scripts/backfill-meeting-activities.ts --write
 *
 * ─── What it fixes ──────────────────────────────────────────────────────────
 *
 * The Process-meeting wizard files a Google Doc summarising each Fireflies
 * recording into the project's Drive folder. Measured September 2026: 19 such
 * meetings, **every one with a filed doc**, and only 1 on any customer's
 * Activity tab — the single meeting processed since the timeline writer was
 * added. The other 18 were invisible on the customer record, so the most useful
 * artefact the app produces was one click away with no click.
 *
 * Nothing new is fetched. `meeting_processing` already holds the title, the
 * date, the project and the doc; the customer is resolved from the project the
 * same way `recordMeetingActivity` does at write time. This is the existing
 * wiring applied to rows that predate it.
 *
 * ─── Rules it keeps ─────────────────────────────────────────────────────────
 *
 * ⚠ Idempotent on `source = 'meeting:<firefliesId>'`, the same key the live
 * writer uses. Re-running adds nothing; it only fills a link that was missing.
 *
 * ⚠ A meeting with no resolvable customer is SKIPPED, not guessed. Putting a
 * meeting on the wrong customer's timeline is worse than leaving it off — a
 * wrong fact on a timeline gets believed.
 *
 * ⚠ `occurred_at` is the MEETING date, never the processing date. A timeline
 * ordered by when someone got round to filing reads as fiction.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchCustomerProjectIndex } from "@/lib/cs-customers";

interface Row {
  fireflies_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  meeting_type: string | null;
  project_ns_id: string | null;
  project_label: string | null;
  customer_ns_id: string | null;
  doc_url: string | null;
  doc_name: string | null;
  processed_by: string | null;
}

async function main() {
  const write = process.argv.includes("--write");
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("meeting_processing")
    .select("fireflies_id, meeting_title, meeting_date, meeting_type, project_ns_id, " +
            "project_label, customer_ns_id, doc_url, doc_name, processed_by");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];

  // job id → customer, both directions, in one call. The per-meeting helper
  // would be 19 SuiteQL round trips for the same answer.
  const index = await fetchCustomerProjectIndex();

  const { data: acts, error: aErr } = await db
    .from("pm_crm_activities")
    .select("id, source, link_url")
    .like("source", "meeting:%");
  if (aErr) {
    throw new Error(
      `${aErr.message}\nIf this names link_url, run supabase/activity-links.sql first.`);
  }
  const existing = new Map((acts ?? []).map(a => [a.source, a]));

  const toInsert: Record<string, unknown>[] = [];
  const toLink:   { id: string; url: string; label: string }[] = [];
  const custPatch: { fireflies_id: string; customer_ns_id: string }[] = [];
  const skipped:  string[] = [];

  for (const r of rows) {
    const resolved = r.customer_ns_id
      ?? (r.project_ns_id ? index.byProject[r.project_ns_id]?.customerNsId : undefined);

    if (!resolved) {
      skipped.push(`${r.meeting_title ?? r.fireflies_id} — project ${r.project_ns_id ?? "none"} resolves to no customer`);
      continue;
    }
    if (!r.customer_ns_id) custPatch.push({ fireflies_id: r.fireflies_id, customer_ns_id: resolved });

    const source = `meeting:${r.fireflies_id}`;
    const already = existing.get(source);

    if (already) {
      // Already on the timeline. The only thing that may be missing is the link.
      if (r.doc_url && !already.link_url) {
        toLink.push({ id: already.id, url: r.doc_url, label: r.doc_name || "Meeting summary" });
      }
      continue;
    }

    toInsert.push({
      customer_ns_id: resolved,
      kind:        "meeting",
      direction:   "outbound",
      subject:     r.meeting_title || "Meeting",
      body:        r.meeting_type
        ? `${r.meeting_type} · ${r.project_label ?? ""}`.trim()
        : (r.project_label ?? null),
      occurred_at: r.meeting_date || new Date().toISOString(),
      actor_email: r.processed_by ?? null,
      link_url:    r.doc_url ?? null,
      link_label:  r.doc_url ? (r.doc_name || "Meeting summary") : null,
      source,
    });
  }

  const nameOf = (id: string) => {
    for (const [job, v] of Object.entries(index.byProject))
      if (v.customerNsId === id) return v.customerName || id;
    return id;
  };

  console.log(`meeting_processing rows        : ${rows.length}`);
  console.log(`already on a timeline          : ${existing.size}`);
  console.log(`timeline rows to create        : ${toInsert.length}`);
  console.log(`existing rows missing a link   : ${toLink.length}`);
  console.log(`meeting_processing.customer_ns_id to fill : ${custPatch.length}`);
  console.log(`skipped (no customer)          : ${skipped.length}`);

  if (toInsert.length) {
    console.log(`\nWould add:`);
    for (const a of toInsert) {
      console.log(`  ${String(a.occurred_at).slice(0, 10)}  ` +
                  `${nameOf(String(a.customer_ns_id)).slice(0, 28).padEnd(28)} ` +
                  `${String(a.subject).slice(0, 44).padEnd(44)} ${a.link_url ? "↗ doc" : "(no doc)"}`);
    }
  }
  for (const s of skipped) console.log(`  ⚠ skipped: ${s}`);

  if (!write) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write.`);
    return;
  }

  if (custPatch.length) {
    for (const p of custPatch) {
      await db.from("meeting_processing")
        .update({ customer_ns_id: p.customer_ns_id })
        .eq("fireflies_id", p.fireflies_id);
    }
    console.log(`\nFilled customer_ns_id on ${custPatch.length} meeting_processing row(s).`);
  }

  if (toInsert.length) {
    const { error: iErr } = await db.from("pm_crm_activities").insert(toInsert);
    if (iErr) throw new Error(`Insert failed: ${iErr.message}`);
    console.log(`Added ${toInsert.length} timeline row(s).`);
  }

  for (const l of toLink) {
    await db.from("pm_crm_activities")
      .update({ link_url: l.url, link_label: l.label }).eq("id", l.id);
  }
  if (toLink.length) console.log(`Linked ${toLink.length} existing row(s) to their doc.`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });

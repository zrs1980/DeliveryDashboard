import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, fetchRecord } from "@/lib/netsuite";

export interface NoteContext {
  id: number;
  text: string;
  date: string | null;
}

export async function GET(req: NextRequest) {
  const oppId = req.nextUrl.searchParams.get("oppId");
  if (!oppId) return NextResponse.json({ notes: [] });

  try {
    // Get up to 5 most recent note IDs for this opportunity
    const noteRows = await runSuiteQL<{ id: string }>(`
      SELECT n.id FROM note n
      WHERE n.transaction = ${parseInt(oppId)}
      ORDER BY n.id DESC
    `);

    if (!noteRows.length) return NextResponse.json({ notes: [] });

    const top5 = noteRows.slice(0, 5);

    // Fetch body of each note via REST Record API
    const notes: NoteContext[] = [];
    for (const row of top5) {
      try {
        const record = await fetchRecord<{ note?: string; noteDate?: string; createdDate?: string }>(
          "note",
          parseInt(row.id)
        );
        const text = record.note ?? "";
        if (text.trim()) {
          notes.push({
            id:   parseInt(row.id),
            text: text.trim(),
            date: record.noteDate ?? record.createdDate ?? null,
          });
        }
      } catch {
        // Skip notes that fail to fetch individually
      }
    }

    return NextResponse.json({ notes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg, notes: [] });
  }
}

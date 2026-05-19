import { NextRequest, NextResponse } from "next/server";
import { fetchRecord } from "@/lib/netsuite";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const tid = parseInt(taskId, 10);
  if (isNaN(tid)) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  }
  const rec = await fetchRecord<Record<string, unknown>>("projecttask", tid);
  // Return only date/status fields to avoid noise
  return NextResponse.json({
    id:        rec.id,
    startdate: rec.startdate,
    enddate:   rec.enddate,
    startDate: rec.startDate,
    endDate:   rec.endDate,
    status:    rec.status,
    _rawKeys:  Object.keys(rec).sort(),
  });
}

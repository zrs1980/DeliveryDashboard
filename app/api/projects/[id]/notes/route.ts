import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";
import type { ProjectNote } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    const body = await req.json();

    const { text, author, existingNotes } = body as {
      text: string;
      author: string;
      existingNotes: ProjectNote[];
    };

    if (!text?.trim()) {
      return NextResponse.json({ error: "Note text is required" }, { status: 400 });
    }

    const newNote: ProjectNote = {
      id:     String(Date.now()),
      text:   text.trim(),
      author: author?.trim() || "PM",
      ts:     new Date().toISOString(),
    };

    const updatedNotes: ProjectNote[] = [...(existingNotes ?? []), newNote];

    await patchRecord("job", projectId, {
      custentity_user_notes: JSON.stringify(updatedNotes),
    });

    return NextResponse.json({ note: newNote, notes: updatedNotes });
  } catch (err) {
    console.error("[/api/projects/[id]/notes]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    const body = await req.json();

    const { noteId, existingNotes } = body as {
      noteId: string;
      existingNotes: ProjectNote[];
    };

    const updatedNotes = (existingNotes ?? []).filter(n => n.id !== noteId);

    await patchRecord("job", projectId, {
      custentity_user_notes: JSON.stringify(updatedNotes),
    });

    return NextResponse.json({ notes: updatedNotes });
  } catch (err) {
    console.error("[/api/projects/[id]/notes DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

"use client";
import { useState } from "react";
import { C } from "@/lib/constants";
import type { ProjectNote } from "@/lib/types";

interface Props {
  projectId: number;
  notes: ProjectNote[];
  onNotesChange: (updated: ProjectNote[]) => void;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
    + " " + d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

export function NotesPanel({ projectId, notes, onNotesChange }: Props) {
  const [showAdd, setShowAdd]   = useState(false);
  const [text, setText]         = useState("");
  const [author, setAuthor]     = useState("");
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  async function addNote() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, author, existingNotes: notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onNotesChange(data.notes);
      setText("");
      setShowAdd(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(noteId: string) {
    setDeleting(noteId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/notes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, existingNotes: notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onNotesChange(data.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete note");
    } finally {
      setDeleting(null);
    }
  }

  const sorted = [...notes].sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div style={{ padding: "12px 16px", background: C.alt, borderTop: `1px solid ${C.border}` }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>
          📝 Notes {notes.length > 0 && <span style={{ color: C.textSub }}>({notes.length})</span>}
        </span>
        <button
          onClick={() => { setShowAdd(v => !v); setError(null); }}
          style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 5, cursor: "pointer",
            background: showAdd ? C.border : C.blue, color: showAdd ? C.textMid : "#fff",
            border: "none", fontFamily: C.font,
          }}
        >
          {showAdd ? "Cancel" : "+ Add Note"}
        </button>
      </div>

      {/* Add note form */}
      {showAdd && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7,
          padding: "12px", marginBottom: 12,
        }}>
          <input
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Your name"
            style={{
              width: "100%", marginBottom: 8, padding: "6px 10px", fontSize: 12,
              border: `1px solid ${C.border}`, borderRadius: 5, fontFamily: C.font,
              background: C.surface, color: C.text,
            }}
          />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a note..."
            rows={3}
            style={{
              width: "100%", padding: "6px 10px", fontSize: 12, resize: "vertical",
              border: `1px solid ${C.border}`, borderRadius: 5, fontFamily: C.font,
              background: C.surface, color: C.text, marginBottom: 8,
            }}
          />
          {error && <div style={{ color: C.red, fontSize: 11, marginBottom: 6 }}>{error}</div>}
          <button
            onClick={addNote}
            disabled={saving || !text.trim()}
            style={{
              background: saving || !text.trim() ? C.border : C.blue,
              color: saving || !text.trim() ? C.textSub : "#fff",
              border: "none", borderRadius: 5, padding: "5px 14px",
              fontSize: 12, fontWeight: 700, cursor: saving || !text.trim() ? "not-allowed" : "pointer",
              fontFamily: C.font,
            }}
          >
            {saving ? "Saving…" : "Save Note"}
          </button>
        </div>
      )}

      {/* Notes list */}
      {sorted.length === 0 ? (
        <p style={{ fontSize: 12, color: C.textSub, fontStyle: "italic", margin: 0 }}>
          No notes yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map(note => (
            <div
              key={note.id}
              style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7,
                padding: "10px 12px", position: "relative",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: C.blue,
                    background: C.blueBg, border: `1px solid ${C.blueBd}`,
                    borderRadius: 4, padding: "1px 6px",
                  }}>
                    {note.author || "PM"}
                  </span>
                  <span style={{ fontSize: 11, color: C.textSub }}>{formatTs(note.ts)}</span>
                </div>
                <button
                  onClick={() => deleteNote(note.id)}
                  disabled={deleting === note.id}
                  title="Delete note"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: C.textSub, fontSize: 13, padding: "0 2px",
                    opacity: deleting === note.id ? 0.4 : 1,
                  }}
                >
                  ×
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {note.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

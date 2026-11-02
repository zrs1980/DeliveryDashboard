"use client";
import { useEffect } from "react";
import { C } from "@/lib/constants";
import type { CUTask } from "@/lib/types";

/** The task's ClickUp description, or "" when it has none. */
export function taskDescription(task: CUTask): string {
  return (task.text_content || task.description || "").trim();
}

interface Props {
  task:    CUTask;
  onClose: () => void;
}

/**
 * Read-only view of a ClickUp task description. The text is already on the
 * task from the list fetch, so this opens instantly with no request — and it is
 * as fresh as the last Refresh Data, which the ↗ Open link covers if not.
 */
export function TaskDescriptionModal({ task, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = taskDescription(task);

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{
        background: C.surface,
        borderRadius: 12,
        boxShadow: C.shMd,
        width: "100%", maxWidth: 620,
        maxHeight: "82vh",
        display: "flex", flexDirection: "column",
        fontFamily: C.font,
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
              Task Description
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.35 }}>
              {task.name}
            </div>
          </div>
          <a
            href={task.url} target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: 11, fontWeight: 600, color: C.blue, background: C.blueBg,
              border: `1px solid ${C.blueBd}`, borderRadius: 5, padding: "3px 8px",
              textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            ↗ Open
          </a>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", fontSize: 20, lineHeight: 1,
              color: C.textSub, cursor: "pointer", padding: 0, flexShrink: 0,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {text ? (
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {text}
            </div>
          ) : (
            <div style={{ color: C.textSub, fontSize: 13, padding: "24px 0", textAlign: "center" }}>
              This task has no description in ClickUp.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

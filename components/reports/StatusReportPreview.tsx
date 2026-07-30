"use client";
// Live PDF preview + download. Kept in its own module so the wizard can pull it
// in with next/dynamic({ ssr: false }) — @react-pdf/renderer's usePDF must never
// run during server rendering.

import { useEffect, useRef, useState } from "react";
import { usePDF } from "@react-pdf/renderer";
import { C } from "@/lib/constants";
import { type StatusReport, reportFilename } from "@/lib/status-report";
import { StatusReportPdf } from "./StatusReportPdf";

export function StatusReportPreview({
  report, onRendered,
}: {
  report: StatusReport;
  onRendered?: (blob: Blob | null) => void;
}) {
  const [instance, updateInstance] = usePDF({ document: <StatusReportPdf report={report} /> });
  const [stale, setStale] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-render on edit, debounced — a full document rebuild on every keystroke is
  // wasteful and makes the preview flicker.
  useEffect(() => {
    setStale(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      updateInstance(<StatusReportPdf report={report} />);
      setStale(false);
    }, 600);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  useEffect(() => {
    if (!instance.loading) onRendered?.(instance.blob ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.loading, instance.blob]);

  const busy = instance.loading || stale;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: C.textSub, flex: 1 }}>
          {instance.error
            ? <span style={{ color: C.red, fontWeight: 600 }}>Preview failed: {String(instance.error)}</span>
            : busy
              ? "Rendering PDF…"
              : "8 slides · 16:9 · ready to send"}
        </div>

        {instance.url && !busy && (
          <>
            <a
              href={instance.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none", background: C.alt, color: C.textMid, border: `1px solid ${C.border}` }}
            >
              ↗ Open in new tab
            </a>
            <a
              href={instance.url}
              download={reportFilename(report.meta)}
              style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none", background: C.blue, color: "#fff", border: "none", boxShadow: "0 2px 8px rgba(26,86,219,0.3)" }}
            >
              ↓ Download PDF
            </a>
          </>
        )}
      </div>

      {/* Preview */}
      <div style={{ flex: 1, minHeight: 0, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}`, background: "#1A1A1A", position: "relative" }}>
        {instance.url ? (
          <iframe
            src={instance.url}
            title="Weekly status report preview"
            style={{ width: "100%", height: "100%", border: "none", opacity: busy ? 0.55 : 1, transition: "opacity 0.2s" }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#8A95A3", fontSize: 13 }}>
            {instance.error ? "Could not render the PDF." : "Building preview…"}
          </div>
        )}

        {busy && instance.url && (
          <div style={{ position: "absolute", top: 12, right: 12, padding: "5px 12px", borderRadius: 999, background: "rgba(13,17,23,0.85)", color: "#fff", fontSize: 11, fontWeight: 600 }}>
            Updating…
          </div>
        )}
      </div>
    </div>
  );
}

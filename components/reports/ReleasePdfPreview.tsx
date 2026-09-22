"use client";
// Live PDF preview + download for the per-customer release document.
//
// Own module so callers pull it in with next/dynamic({ ssr: false }) —
// @react-pdf/renderer's usePDF must never run during server rendering. Same
// arrangement as StatusReportPreview, and the same reason.

import { usePDF } from "@react-pdf/renderer";
import { C } from "@/lib/constants";
import { ReleasePdf, type ReleasePdfProps } from "./ReleasePdf";

export function ReleasePdfPreview(props: ReleasePdfProps & { compact?: boolean }) {
  const { compact, ...doc } = props;
  const [instance] = usePDF({ document: <ReleasePdf {...doc} /> });

  const filename =
    `${doc.customerName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")}` +
    `-${doc.product === "loop_erp" ? "LoopERP" : "NetSuite"}-${doc.version}.pdf`;

  if (instance.error) {
    return (
      <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                    borderRadius: 8, padding: "9px 13px", fontSize: 12 }}>
        Could not render the PDF: {String(instance.error)}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: compact ? 0 : 10 }}>
        <a
          href={instance.url ?? undefined}
          download={filename}
          style={{
            pointerEvents: instance.loading ? "none" : "auto",
            opacity: instance.loading ? 0.5 : 1,
            background: C.purpleBg, border: `1px solid ${C.purpleBd}`, color: C.purple,
            borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
            textDecoration: "none", fontFamily: C.font,
          }}
        >
          {instance.loading ? "Rendering…" : "↓ Download PDF"}
        </a>
        <span style={{ fontSize: 11, color: C.textSub }}>
          {doc.items.length} item{doc.items.length === 1 ? "" : "s"} · {filename}
        </span>
      </div>

      {!compact && instance.url && (
        <iframe
          src={instance.url}
          title={filename}
          style={{ width: "100%", height: 560, border: `1px solid ${C.border}`, borderRadius: 8 }}
        />
      )}
    </div>
  );
}

export default ReleasePdfPreview;

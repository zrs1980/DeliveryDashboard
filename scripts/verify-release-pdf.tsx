/**
 * Render check for the per-customer release PDF.
 *
 *   PDF_FONT_DIR=./public/fonts npx tsx scripts/verify-release-pdf.tsx
 *
 * Catches the class of bug that only appears at render: an unregistered
 * fontWeight, a fontStyle, a style react-pdf rejects. Those kill the whole
 * document rather than one line, and reached production once before via an
 * italic note in StatusReportPdf.
 *
 * Runs a HIGH-VOLUME fixture on purpose — at the item cap, past it, and with
 * long text forcing multi-page flow. The original status-report check passed for
 * months against a tidy fixture and missed exactly those cases.
 *
 * ⚠ PDF_FONT_DIR must be set ON THE COMMAND LINE, as verify-status-report-pdf
 * also requires. Font.register runs at module load, so setting it inside the
 * script is too late — imports are hoisted above the assignment and the fonts
 * resolve to C:\fonts.
 */
import fs from "node:fs/promises";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReleasePdf, type ReleasePdfItem } from "../components/reports/ReleasePdf";

if (!process.env.PDF_FONT_DIR) {
  console.error("PDF_FONT_DIR is not set. Run:\n  PDF_FONT_DIR=./public/fonts npx tsx scripts/verify-release-pdf.tsx");
  process.exit(1);
}

const long = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    `Sentence ${i + 1} describing in detail how this affects the month-end process the team currently runs by hand.`,
  ).join(" ");

const item = (i: number, cat: string, action: boolean): ReleasePdfItem => ({
  title: `Release item ${i}: cycle counting for serialised inventory across bins`,
  description: long(2),
  category: cat,
  reasoning: long(4),
  actionRequired: action,
  modules: ["Advanced Inventory", "Warehouse Management", "SuiteTax"],
});

async function main() {
  const cases: Array<[string, number]> = [["tidy", 3], ["at the cap", 7], ["over the cap", 14]];

  for (const [label, n] of cases) {
    const items = Array.from({ length: n }, (_, i) =>
      item(i + 1, ["new_feature", "enhancement", "deprecation", "breaking_change"][i % 4], i % 3 === 0),
    );
    const buf = await renderToBuffer(
      <ReleasePdf
        customerName="Yield Engineering Systems, Inc"
        product="netsuite"
        version="2026.2"
        releaseDate="2026-10-14"
        preparedBy="Loop Services"
        intro={long(3)}
        items={items}
      />,
    );
    console.log(`  ${label.padEnd(14)} ${n} items -> ${(buf.length / 1024).toFixed(1)} KB`);
    if (buf.length < 1000) throw new Error(`${label}: suspiciously small PDF`);
  }

  // The assertion the Node render cannot make: fonts do not load under Node, so
  // Helvetica's oblique silently stands in for an italic that WOULD throw in the
  // browser. Assert against the stylesheet source instead.
  const src = await fs.readFile("components/reports/ReleasePdf.tsx", "utf8");
  if (/fontStyle\s*:/.test(src)) throw new Error("fontStyle used — react-pdf will throw in the browser");
  const weights = [...src.matchAll(/fontWeight:\s*(\d+)/g)].map(m => m[1]);
  const bad = weights.filter(w => !["400", "500", "700"].includes(w));
  if (bad.length) throw new Error(`unregistered fontWeight(s): ${[...new Set(bad)].join(", ")}`);
  console.log(`  stylesheet     no fontStyle, weights used: ${[...new Set(weights)].sort().join("/")}`);
  console.log("\nOK");
}

main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });

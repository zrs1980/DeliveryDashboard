import { openSync } from "fontkit";
let ok = true;
for (const w of ["Regular", "Medium", "Bold"]) {
  const p = `./public/fonts/DMSans-${w}.ttf`;
  try {
    const f = openSync(p);
    const variable = !!f.variationAxes && Object.keys(f.variationAxes).length > 0;
    console.log(`${w.padEnd(8)} family="${f.familyName}" sub="${f.subfamilyName}" glyphs=${f.numGlyphs} variable=${variable}`);
    if (variable) { console.log(`  ⚠ ${w} is a VARIABLE font — react-pdf needs static instances`); ok = false; }
  } catch (e) {
    console.log(`${w.padEnd(8)} FAILED TO PARSE: ${e.message}`);
    ok = false;
  }
}
console.log(ok ? "\n✓ all three weights are static, parseable TrueType" : "\n✗ font problem");
process.exit(ok ? 0 : 1);

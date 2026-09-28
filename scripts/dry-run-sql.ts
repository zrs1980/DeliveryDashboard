/**
 * Dry-run a hand-applied SQL file against the real database.
 *
 *   npx tsx --env-file=.env.vercel scripts/dry-run-sql.ts supabase/customers-fk.sql
 *
 * Opens a transaction, runs the file, prints what it did, and ROLLS BACK.
 * Nothing is ever committed — there is deliberately no --commit flag. This
 * repo's convention is that every supabase/*.sql file is applied by hand in the
 * Supabase SQL editor, and a script that could apply one would quietly become a
 * second, untracked way of migrating.
 *
 * What it is for: a 200-line DO block with catalog guards has plenty of ways to
 * fail, and finding them by watching someone paste it is a poor experience.
 * This finds them first, against the schema that actually exists.
 *
 * Needs POSTGRES_URL_NON_POOLING, which `vercel env pull` provides.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const conn = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!conn) throw new Error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL in the env file.");

  const file = process.argv[2];
  if (!file) throw new Error("Usage: dry-run-sql.ts <path to .sql>");
  const sql = readFileSync(file, "utf8");
  // Supabase serves a self-signed chain. The connection string carries
  // `sslmode=require`, which pg now treats as verify-full and rejects — so the
  // parameter is stripped and TLS configured explicitly instead. Still
  // encrypted; just not validating the chain, which is the same posture the
  // Supabase JS client uses.
  const url = new URL(conn);
  url.searchParams.delete("sslmode");
  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("BEGIN");
    const res = await client.query(sql);

    // The file ends with SELECT * FROM customers_relink_all(), so the last
    // result set carrying rows is the backfill report.
    const sets = Array.isArray(res) ? res : [res];
    const relink = [...sets].reverse().find(r => r && r.rows && r.rows.length);

    console.log(`SQL executed OK (${sets.length} statements).\n`);
    if (relink) {
      console.log("Rows linked by the backfill:");
      let total = 0;
      for (const r of relink.rows as { table_name: string; linked: string }[]) {
        const n = Number(r.linked);
        total += n;
        if (n) console.log(`  ${r.table_name.padEnd(28)} ${String(n).padStart(5)}`);
      }
      console.log(`  ${"TOTAL".padEnd(28)} ${String(total).padStart(5)}`);
    }

    // What would still be unlinked after this ran.
    const { rows: gaps } = await client.query(`
      SELECT c.relname AS tbl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'customer_id' AND NOT a.attisdropped)
      ORDER BY 1
    `);
    console.log(`\nTables now carrying customer_id: ${gaps.length}`);

    let unlinkedTotal = 0;
    for (const g of gaps as { tbl: string }[]) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${JSON.stringify(g.tbl).replace(/"/g, '"')} ` +
        `WHERE customer_ns_id IS NOT NULL AND customer_id IS NULL`);
      const n = rows[0].n as number;
      unlinkedTotal += n;
      if (n) console.log(`  ⚠ ${g.tbl}: ${n} row(s) with a key but no link`);
    }
    console.log(unlinkedTotal ? `\n⚠ ${unlinkedTotal} unlinked row(s).` : "\n✅ Every row with a key is linked.");

    await client.query("ROLLBACK");
    console.log("\nROLLED BACK — the database is unchanged. Apply the file in the Supabase SQL editor.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });

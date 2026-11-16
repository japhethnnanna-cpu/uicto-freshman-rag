import { config } from "dotenv";
import XLSX from "xlsx";
import * as workbookFs from 'node:fs';
XLSX.set_fs(workbookFs);
import { stat } from "node:fs/promises";
import { database, embed } from "../lib/providers.mjs";

config({ path: ".env.local", quiet: true });
const write = process.argv.includes("--write");
const compare = write || process.argv.includes("--compare");
const path =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  "./data/UICTO_Freshman_QnA_Demo.xlsx";
try {
  if ((await stat(path)).size > 2_000_000) throw Error("Workbook too large");
  const workbook = XLSX.readFile(path, { sheetRows: 1002 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  if (
    !rows.length ||
    rows.length > 1000 ||
    XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]).e.r > 1000
  )
    throw Error("Invalid row count");
  const ids = new Set();
  const records = rows.map((row, i) => {
    const fields = [
      "ID",
      "Category",
      "Expected User Query",
      "Chatbot Response (Ground Truth)",
    ].map((key) => String(row[key] ?? "").trim());
    const [external_id, category, question, answer] = fields;
    if (fields.some((v) => !v || v.length > 4000) || ids.has(external_id))
      throw Error("Invalid or duplicate workbook row " + (i + 2));
    ids.add(external_id);
    return { external_id, category, question, answer };
  });
  const db = compare && database();
  let added = 0,
    skipped = 0,
    conflicts = 0;
  for (const record of records) {
    if (db) {
      const { data, error } = await db
        .from("school_knowledge")
        .select("question,category,answer")
        .eq("external_id", record.external_id)
        .maybeSingle();
      if (error) throw Error("Database lookup failed");
      if (data) {
        if (
          ["question", "category", "answer"].some((k) => data[k] !== record[k])
        )
          conflicts++;
        else skipped++;
        continue;
      }
    }
    if (write) {
      const embedding = await embed(
        `Category: ${record.category}\nQuestion: ${record.question}`,
      );
      const { error, data } = await db
        .from("school_knowledge")
        .upsert(
          {
            ...record,
            embedding,
            source: "Administrator workbook",
            review_status: "pending",
          },
          { onConflict: "external_id", ignoreDuplicates: true },
        )
        .select("external_id");
      if (error) throw Error("Database import failed");
      if (!data.length) {
        conflicts++;
        continue;
      }
    }
    added++;
  }
  console.log({
    rows: records.length,
    mode: write ? "write" : "dry-run",
    newCandidates: added,
    skipped,
    conflicts,
  });
  if (conflicts) process.exitCode = 1;
} catch (err) {
  console.error(
    "Import stopped.",
    /^(Invalid|Database|Workbook)/.test(err.message)
      ? err.message
      : "Check the file, configuration and providers.",
  );
  process.exitCode = 1;
}

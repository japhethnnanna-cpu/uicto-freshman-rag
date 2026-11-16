import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import XLSX from "xlsx";
import * as workbookFs from 'node:fs';
XLSX.set_fs(workbookFs);

const exec = promisify(execFile);
const run = (script, args) =>
  exec(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_SECRET_KEY: "unused-fixture",
      GEMINI_API_KEY: "unused-fixture",
    },
    timeout: 15000,
  });
test("manual sync CLI estimates future embedding calls without a database or AI service", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uicto-cli-"));
  t.after(() => rm(dir, { recursive: true }));
  const manifest = join(dir, "sources.json");
  const item = {
    mode: "manual",
    url: "https://uicto.edu.ng/news/fixture",
    title: "Fixture notice",
    permission_reference: "Local synthetic test",
    category: "admissions",
    claim_key: "fixture",
    academic_session: "2026/2027",
    text: "Synthetic admissions notice.",
  };
  await writeFile(manifest, JSON.stringify([item]));
  const { stdout } = await run("scripts/official-sync.mjs", ["sync", manifest]);
  const report = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.deepEqual(report, {
    discovered: 1,
    changed: 1,
    skipped: 0,
    failed: 0,
    pending_review: 1,
    estimated_embedding_calls: 1,
  });
  await writeFile(manifest, JSON.stringify([item, item]));
  await assert.rejects(
    run("scripts/official-sync.mjs", ["sync", manifest]),
    (e) => e.stdout.includes('"failed":1'),
  );
});
test("Excel importer CLI validates the whole workbook before writes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uicto-xlsx-"));
  t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, "fixture.xlsx");
  const row = {
    ID: "demo1",
    Category: "orientation",
    "Expected User Query": "Where do we meet?",
    "Chatbot Response (Ground Truth)": "In the fixture classroom.",
  };
  function save(rows) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "FAQ");
    XLSX.writeFile(book, file);
  }
  save([row]);
  assert.match(
    (await run("scripts/import-knowledge.mjs", [file])).stdout,
    /newCandidates: 1/,
  );
  save([row, row]);
  await assert.rejects(
    run("scripts/import-knowledge.mjs", [file, "--write"]),
    (e) => e.stderr.includes("duplicate workbook row"),
  );
});

import { config } from "dotenv";
import { readFile, stat } from "node:fs/promises";
import { database, embed } from "../lib/providers.mjs";
import { officialClient } from "../lib/official-fetch.mjs";
import { discover, extract, prepare, plan } from "../lib/official-content.mjs";
import { canonicalKey } from "../lib/sources.mjs";

config({ path: ".env.local", quiet: true });
const args = process.argv.slice(2);
const client = officialClient();
const write = args.includes("--write");
const compare = write || args.includes("--compare");
const stats = {
  discovered: 0,
  changed: 0,
  skipped: 0,
  failed: 0,
  pending_review: 0,
  estimated_embedding_calls: 0,
};
let db;
async function checked(query) {
  const { data, error } = await query;
  if (error)
    throw Error(
      "Database operation failed; check staging schema and permissions",
    );
  return data;
}
async function sync(path) {
  if (!path || (await stat(path)).size > 512000)
    throw Error("Supply a small JSON manifest");
  const entries = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(entries) || entries.length > 24)
    throw Error("Use an array of at most 24 documents");
  db = compare ? database() : null;
  const seen = new Set();
  for (const item of entries) {
    const key = canonicalKey(item.url);
    let old;
    try {
      if (!key || seen.has(key))
        throw Error("Invalid or duplicate canonical URL");
      seen.add(key);
      if (compare)
        old = await checked(
          db
            .from("official_documents")
            .select("id,content_hash,review_status,extraction_status")
            .eq("canonical_url", key)
            .is("superseded_by", null)
            .maybeSingle(),
        );
      let prepared;
      if (item.mode === "web") {
        try {
          const { html, url } = await client.page(item.url, "rag");
          if (canonicalKey(url) !== key)
            throw Error("Redirect changed identity; review the new URL");
          prepared = prepare({
            ...item,
            ...extract(html, url),
            source_type: "official_html",
          });
        } catch (err) {
          if (write && old)
            await checked(
              db
                .from("official_documents")
                .update({ extraction_status: "unavailable" })
                .eq("id", old.id)
                .is("superseded_by", null),
            );
          throw err;
        }
      } else {
        if (item.mode !== "manual") throw Error("Use manual or web mode");
        prepared = prepare({ ...item, source_type: "authorized_manual" });
      }
      const { doc, parts } = prepared;
      const result = plan(doc, parts, old);
      if (write)
        await checked(
          db.rpc("stage_official", {
            doc,
            parts,
            expected_id: old?.id ?? null,
          }),
        );
      stats.discovered++;
      stats[result.status]++;
      stats.pending_review += Number(result.pending_review);
      stats.estimated_embedding_calls +=
        result.estimated_embedding_calls_at_review;
      console.log(key, result.status);
    } catch (err) {
      stats.failed++;
      console.error(key ?? "(invalid URL)", err.message);
    }
  }
}

async function approve(id, hash, until) {
  if (
    !write ||
    !/^\d+$/.test(id) ||
    !/^[0-9a-f]{64}$/.test(hash) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(until)
  )
    throw Error("Use approve ID HASH YYYY-MM-DD --write");
  const today = new Date().toISOString().slice(0, 10);
  if (
    !Number.isFinite(Date.parse(until)) ||
    until < today ||
    Date.parse(until) > Date.parse(today) + 90 * 86400000
  )
    throw Error("Review expiry must be within 90 days");
  db = database();
  const doc = await checked(
    db
      .from("official_documents")
      .select("title,content_hash")
      .eq("id", id)
      .eq("content_hash", hash)
      .eq("extraction_status", "ok")
      .is("superseded_by", null)
      .single(),
  );
  const parts = await checked(
    db
      .from("official_chunks")
      .select("answer,embedding")
      .eq("document_id", id)
      .order("ordinal"),
  );
  const vectors = [];
  for (const p of parts)
    vectors.push(
      p.embedding
        ? typeof p.embedding === "string"
          ? JSON.parse(p.embedding)
          : p.embedding
        : await embed(doc.title + "\n" + p.answer),
    );
  await checked(
    db.rpc("approve_official", {
      version_id: id,
      digest: hash,
      valid_until: until,
      vectors,
    }),
  );
  console.log("Approved version", id, "until", until);
}

try {
  if (args[0] === "discover") {
    const seeds = [
      "https://www.uicto.edu.ng/news",
      "https://www.uicto.edu.ng/admission/procedure",
      "https://www.uicto.edu.ng/post-utme/procedure",
    ];
    const links = new Set();
    for (const seed of seeds) {
      try {
        const { html, url } = await client.page(seed);
        for (const link of discover(html, url)) links.add(link);
        links.add(canonicalKey(url));
      } catch (e) {
        stats.failed++;
        console.error(seed, e.message);
      }
    }
    stats.discovered = links.size;
    for (const link of links) console.log(link);
  } else if (args[0] === "sync") await sync(args[1]);
  else if (args[0] === "approve") await approve(...args.slice(1, 4));
  else
    throw Error(
      "Use discover, sync MANIFEST [--compare|--write], or approve ID HASH DATE --write",
    );
  console.log(JSON.stringify(stats));
  if (stats.failed) process.exitCode = 1;
} catch (err) {
  // SDK errors may contain request details. Only emit known operational messages.
  console.error(
    "Operation failed.",
    /^(Use |Supply |Review expiry|Database operation)/.test(err.message)
      ? err.message
      : "Check inputs and service availability.",
  );
  process.exitCode = 1;
}

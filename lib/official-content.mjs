import { parse } from "node-html-parser";
import { createHash } from "node:crypto";
import { canonicalKey, mentionedSessions, officialUrl } from "./sources.mjs";

const injection =
  /ignore (all |any )?(previous|prior|system)|system prompt|act as (an?|the)|follow these instructions|<\|(?:im_start|system)|developer message/i;
function cleanTree(html) {
  const root = parse(html);
  for (const node of root.querySelectorAll(
    "script,style,nav,footer,header,form,noscript,iframe,aside,template,[hidden],.comments,#comments,[class*=comment],[id*=comment]",
  ))
    node.remove();
  return root;
}
export function discover(html, base) {
  const root = cleanTree(html);
  return [
    ...new Set(
      root
        .querySelectorAll("a[href]")
        .map((a) => officialUrl(a.getAttribute("href"), base))
        .filter(Boolean)
        .map(canonicalKey),
    ),
  ].slice(0, 24);
}

export function extract(html, url) {
  const root = cleanTree(html);
  const body = root.querySelector("article") ?? root.querySelector("main");
  if (!body || /leave a (comment|reply)|\bcomments?\s*\(/i.test(body.text))
    throw Error("Article boundary uncertain; supply an authorized excerpt");
  const canonical = root
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  if (
    canonical &&
    canonicalKey(officialUrl(canonical, url)) !== canonicalKey(url)
  )
    throw Error("Review canonical URL before importing");
  const text = body.structuredText.trim();
  const published = root.querySelector('meta[property="article:published_time"]')?.getAttribute("content")
    ?? body.querySelector('time[itemprop="datePublished"]')?.getAttribute("datetime");
  return {
    title: (
      body.querySelector("h1,h2,h3")?.text ??
      root.querySelector("title")?.text ??
      ""
    ).trim(),
    text,
    published_on: published?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
  };
}

export function prepare(input) {
  const original = officialUrl(input.url);
  if (!original || new URL(original).pathname === "/news")
    throw Error("An official document URL is required");
  for (const field of [
    "title",
    "category",
    "claim_key",
    "permission_reference",
    "text",
  ]) {
    if (typeof input[field] !== "string" || !input[field].trim())
      throw Error("Missing " + field);
  }
  if (
    input.text.length > 12000 ||
    input.title.length > 200 ||
    !/^[a-z0-9_-]{1,80}$/.test(input.claim_key) ||
    injection.test(input.text + " " + input.title) ||
    /<\/?[a-z][^>]*>/i.test(input.text)
  )
    throw Error("Unsafe or oversized excerpt; review manually");
  const cited = mentionedSessions(input.title + " " + input.text);
  const session = input.academic_session || cited[0] || null;
  if (
    session &&
    (!/^20\d{2}\/20\d{2}$/.test(session) ||
      Number(session.slice(5)) !== Number(session.slice(0, 4)) + 1)
  )
    throw Error("Invalid academic session");
  if (cited.some(s => s !== session))
    throw Error("Session mismatch; isolate one applicable session");
  if (!session && /fee|admission|screening|utme|registrat|deadline|schedule/i.test(input.category))
    throw Error("Confirm the academic session for this time-sensitive source");
  const published = input.published_on || null;
  if (
    published &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(published) ||
      new Date(published).toISOString().slice(0, 10) !== published)
  )
    throw Error("Invalid publication date");
  const parts = input.text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 16 || parts.some((p) => p.length > 1600))
    throw Error(
      "Use up to 16 short self-contained paragraphs (1600 characters each)",
    );
  const doc = {
    canonical_url: canonicalKey(original),
    original_url: original,
    title: input.title.trim(),
    category: input.category.trim(),
    claim_key: input.claim_key,
    source_type: input.source_type,
    published_on: published,
    academic_session: session,
    permission_reference: input.permission_reference.trim(),
  };
  doc.content_hash = createHash("sha256")
    .update(
      JSON.stringify([
        doc.canonical_url,
        doc.title,
        doc.category,
        doc.claim_key,
        doc.source_type,
        published,
        session,
        doc.permission_reference,
        parts,
      ]),
    )
    .digest("hex");
  return { doc, parts };
}

export function plan(doc, parts, old) {
  const unchanged =
    old?.content_hash === doc.content_hash && old.extraction_status === "ok";
  return {
    status: unchanged ? "skipped" : "changed",
    pending_review: !unchanged || old.review_status === "pending",
    estimated_embedding_calls_at_review:
      unchanged && old.review_status === "approved" ? 0 : parts.length,
  };
}

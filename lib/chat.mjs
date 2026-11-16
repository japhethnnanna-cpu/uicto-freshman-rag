import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { mentionedSessions } from "./sources.mjs";
import { reviewedSource } from "./reviewed-workbook.mjs";
import { smallTalk, redact } from "./conversation.mjs";

const byteLimit = 4096;
const unknown =
  "I don’t have a verified answer to this in the UICTO knowledge base for the requested period. Please confirm with the relevant university office; I won’t guess.";
const sensitive =
  /\b(fees?|costs?|pay\w*|tuition|levy|charges?|amount|admi\w*|utme|jamb|screening|regist\w*|enrol\w*|deadlines?|dates?|schedules?|calendar|resum\w*|current|latest|this year|cut.?off|applications?)\b/i;

export function scope(question, current) {
  const sessions = mentionedSessions(question);
  if (
    new Set(sessions).size > 1 ||
    sessions.some((s) => Number(s.slice(5)) !== Number(s.slice(0, 4)) + 1)
  )
    return { clarify: true };
  if (sessions.length) return { session: sessions[0], specific: true };
  if (
    /\b20\d{2}\b|\blast (year|session)\b|\bnext (year|session)\b/i.test(
      question,
    )
  )
    return { clarify: true };
  if (!sensitive.test(question))
    return { session: current || null, specific: false };
  return current ? { session: current, specific: true } : { clarify: true };
}

class InputError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readQuestion(req) {
  if (
    req.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    throw new InputError(415, "Send a JSON question.");
  if (Number(req.headers.get("content-length")) > byteLimit)
    throw new InputError(413, "Question is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new InputError(400, "Enter a question.");
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new InputError(408, "Request timed out.")),
      4000,
    );
  });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.length;
      if (size > byteLimit) throw new InputError(413, "Question is too large.");
      chunks.push(value);
    }
    const body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    const q =
      typeof body?.question === "string"
        ? body.question.normalize("NFC").trim()
        : "";
    if (!q || q.length > 800 || /[\u0000-\u0008\u000e-\u001f]/.test(q))
      throw new InputError(400, "Enter a question of 1–800 characters.");
    return q;
  } catch (e) {
    void reader.cancel().catch(() => {});
    throw e instanceof InputError ? e : new InputError(400, "Invalid request.");
  } finally {
    clearTimeout(timer);
  }
}

export function clientKey(req, secret, vercel) {
  if (!secret || secret.length < 32) throw Error("Limiter unavailable");
  const ip =
    vercel && req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim();
  return createHmac("sha256", secret)
    .update(
      new Date().toISOString().slice(0, 10) +
        "/" +
        (ip && isIP(ip) ? ip : "shared"),
    )
    .digest("hex");
}

export async function handleChat(req, services) {
  const started = Date.now();
  let outcome = "invalid",
    category = null;
  const timings = {};
  let conflictKeys;
  let question, answer;
  let failureStatus;
  async function timed(stage, run) {
    outcome = stage + "_failure";
    const t = Date.now();
    try {
      return await run();
    } finally {
      timings[stage] = Date.now() - t;
    }
  }
  function abstain(reason, message) {
    outcome = reason;
    answer = message;
    return Response.json({ outcome, answer, sources: [] });
  }
  try {
    const q = await readQuestion(req);
    question = redact(q).slice(0, 800);
    const allowed = await timed("limiter", () => services.allow(req));
    if (!allowed) {
      outcome = "limited";
      return Response.json(
        { error: "Too many questions. Try again in one minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const greeting = smallTalk(q);
    if (greeting) return abstain("greeting", greeting);
    const policy = scope(q, services.current);
    if (policy.clarify)
      return abstain(
        "ambiguous",
        "Which academic session do you mean? Please ask about one session, for example 2026/2027.",
      );
    const vector = await timed("embedding", () => services.embed(q));
    const rows = await timed("retrieval", () => services.match(vector, policy));
    if (!rows.length) return abstain("unsupported", unknown);
    const conflicts = rows.filter((row) => row.conflict ||
      mentionedSessions(row.title + " " + row.answer).some(session => session !== row.academic_session));
    if (conflicts.length) {
      conflictKeys = [
        ...new Set(conflicts.map((row) => row.claim_key).filter(Boolean)),
      ];
      return abstain(
        "conflict",
        "The available guidance has conflicting details or session labels. Please confirm this with the university before acting.",
      );
    }
    const selection = await timed("provider", () => services.choose(q, rows));
    if (!selection) return abstain("unsupported", unknown);
    const row = rows[selection - 1];
    category = row.category;
    answer = row.answer;
    outcome = "supported_excerpt";
    return Response.json({
      outcome,
      answer: row.answer,
      sources: [
        {
          title: row.title,
          url: reviewedSource(row.url),
          published: row.published_on,
          session: row.academic_session,
          reviewed: row.reviewed_on,
          origin: row.origin,
        },
      ],
    });
  } catch (e) {
    if (Number.isInteger(e.status) && e.status >= 400 && e.status <= 599) failureStatus = e.status;
    if (e instanceof InputError)
      return Response.json({ error: e.message }, { status: e.status });
    return Response.json(
      {
        error:
          "The assistant is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  } finally {
    try { services.record({
      question,
      answer: answer ? redact(answer) : null,
      outcome,
      category,
      conflict_keys: conflictKeys,
      failure_status: failureStatus,
      timings,
      latency_ms: Date.now() - started,
    }); } catch { /* Telemetry must not change an answer. */ }
  }
}

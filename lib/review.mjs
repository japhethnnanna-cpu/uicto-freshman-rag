import { mentionedSessions } from "./sources.mjs";
import { scope } from "./chat.mjs";
import { reviewedSource } from "./reviewed-workbook.mjs";

export function pendingInput(body, approve, now = new Date()) {
  let item;
  if (approve) item = reviewInput(body, now);
  else {
    item = {};
    for (const [key, max] of Object.entries({
      question: 800,
      answer: 6000,
      category: 80,
      claim_key: 120,
      academic_session: 9,
    })) {
      const value = typeof body[key] === "string" ? body[key].trim() : "";
      if (
        value.length > max ||
        /[\u0000-\u0008\u000e-\u001f]/.test(value) ||
        (["question", "category"].includes(key) && !value)
      )
        throw Error("Check the " + key + " field.");
      item[key] = value;
    }
  }
  item.staff_document_id = body.staff_document_id || null;
  if (
    item.staff_document_id &&
    (typeof item.staff_document_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        item.staff_document_id,
      ))
  )
    throw Error("Choose a valid source document.");
  item.source = typeof body.source === "string" ? body.source.trim() : "";
  if (item.source.length > 1000) throw Error("Source is too long.");
  if (approve && !item.staff_document_id && !reviewedSource(item.source))
    throw Error(
      "Approval requires a supported official source URL or an uploaded school document.",
    );
  return item;
}

export function reviewInput(body, now = new Date()) {
  const text = (key, max) => {
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (
      !value ||
      value.length > max ||
      /[\u0000-\u0008\u000e-\u001f]/.test(value)
    )
      throw Error("Check the " + key + " field.");
    return value;
  };
  const result = {
    question: text("question", 800),
    answer: text("answer", 6000),
    category: text("category", 80),
    claim_key: text("claim_key", 120),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.claim_key))
    throw Error("Use a claim key such as admission-cutoff.");
  result.academic_session = body.academic_session?.trim() || null;
  if (
    result.academic_session &&
    (!/^20\d{2}\/20\d{2}$/.test(result.academic_session) ||
      Number(result.academic_session.slice(5)) !==
        Number(result.academic_session.slice(0, 4)) + 1)
  )
    throw Error("Enter an academic session such as 2026/2027.");
  if (
    mentionedSessions(result.question + " " + result.answer).some(
      (s) => s !== result.academic_session,
    )
  )
    throw Error(
      "The answer and question must match the selected academic session.",
    );
  if (
    !result.academic_session &&
    scope(result.question + " " + result.answer, null).clarify
  )
    throw Error("Session-specific guidance requires an academic session.");
  const today = now.toISOString().slice(0, 10);
  const latest = new Date(now.getTime() + 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(body.expires_on || "") ||
    !Number.isFinite(Date.parse(body.expires_on)) ||
    new Date(body.expires_on).toISOString().slice(0, 10) !== body.expires_on ||
    body.expires_on < today ||
    body.expires_on > latest
  )
    throw Error("Choose a valid review expiry within the next 90 days.");
  if (body.confirmed !== true)
    throw Error("Confirm that you checked this answer against its source.");
  result.expires_on = body.expires_on;
  return result;
}

export function smallTalk(question) {
  const text = question
    .toLowerCase()
    .replace(/[!?.…,]/g, "")
    .trim();
  if (
    /^(hi|hey|hello|yo+|good (morning|afternoon|evening))( there| bot| assistant)?$/.test(
      text,
    )
  )
    return "Hello! How can I help you with UICTO today? You can ask about admissions, registration or student services.";
  if (/^(thanks|thank you|thank you so much|thanks a lot|cheers)$/.test(text))
    return "You’re welcome! Is there anything else about UICTO I can help you with?";
  if (/^(who are you|what can you do|help)$/.test(text))
    return "I’m the UICTO Freshman Assistant. I find answers in reviewed university guidance. If I don’t have verified information, I’ll say so. What would you like to know?";
  if (/^(how are you|how are you doing)$/.test(text))
    return "I’m here and ready to help! What would you like to know about UICTO?";
  return null;
}

// Best-effort minimisation, not a guarantee of anonymity. Students are also
// warned not to submit credentials or personal information.
export function redact(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(
      /\b(?:password|passwd|secret|api[ _-]?key|token)\s*[:=]\s*\S+/gi,
      "[credential removed]",
    )
    .replace(/\b(?:sk-|nvapi-|sb_secret_)[\w-]+/g, "[credential removed]")
    .replace(/\b[A-Z]{2,}(?:\/\d+){2,}\b/gi, "[student ID removed]")
    .replace(/(?:\+?\d[\d ()/-]{7,}\d)(?:[A-Z]{2})?\b/g, (value) =>
      value.replace(/\D/g, "").length >= 9 ? "[number removed]" : value,
    )
    .slice(0, 6000);
}

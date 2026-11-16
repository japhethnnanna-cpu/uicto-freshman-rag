export function mentionedSessions(text) {
  const pattern = /\b(20\d\d)\s*[/-]\s*(20\d\d|\d\d)\b(?![-/]\d)/g;
  return [...text.matchAll(pattern)].map(([, first, last]) =>
    first + "/" + (last.length === 2 ? "20" + last : last)
  );
}

// The same allowlist protects outbound requests and links rendered in the browser.
export function officialUrl(value, base) {
  try {
    const u = new URL(value, base);
    if (
      u.protocol !== "https:" ||
      !["www.uicto.edu.ng", "uicto.edu.ng"].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port ||
      u.search
    )
      return null;
    if (
      !/^\/(?:news(?:\/[a-z0-9-]+)?|(?:admission|post-utme)\/procedure|assets\/pdf\/[a-z0-9-]+\.pdf)\/?$/i.test(
        u.pathname,
      )
    )
      return null;
    u.hash = "";
    u.pathname = u.pathname.replace(/\/$/, "");
    return u.href;
  } catch {
    return null;
  }
}

export function canonicalKey(url) {
  return (
    officialUrl(url)?.replace(
      "https://uicto.edu.ng/",
      "https://www.uicto.edu.ng/",
    ) ?? null
  );
}

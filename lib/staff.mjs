import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { database } from "./providers.mjs";
import { clientKey } from "./chat.mjs";

export class StaffError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const privateJson = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
export function failure(error) {
  return privateJson(
    {
      error:
        error instanceof StaffError
          ? error.message
          : "Staff service is unavailable. Please try again.",
    },
    error instanceof StaffError ? error.status : 503,
  );
}
export function allowedStaff(email) {
  return (process.env.STAFF_EMAILS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(email || "").toLowerCase());
}
export function sameOrigin(req) {
  if (
    req.headers.get("origin") !== new URL(req.url).origin ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new StaffError("Open the dashboard on this site and try again.", 403);
}
export async function readBody(req, limit = 16000) {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new StaffError("Send JSON.", 415);
  const bytes = await boundedBytes(req, limit);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new StaffError("Invalid request.");
  }
}
export async function boundedBytes(req, limit) {
  if (Number(req.headers.get("content-length")) > limit)
    throw new StaffError("File or request is too large.", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new StaffError("Request is empty.");
  let timer,
    size = 0;
  const chunks = [];
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new StaffError("Upload timed out.", 408)),
      10000,
    );
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new StaffError("File or request is too large.", 413);
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
export async function authClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
      global: {
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          }),
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        },
      },
    },
  );
}
export async function requireStaff() {
  const auth = await authClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user)
    throw new StaffError("Sign in to the staff dashboard.", 401);
  if (!data.user.email_confirmed_at || !allowedStaff(data.user.email))
    throw new StaffError("This account does not have staff access.", 403);
  return { user: data.user, db: database(), auth };
}
export async function staffQuota(req, db) {
  if (
    !process.env.RATE_LIMIT_SECRET ||
    process.env.RATE_LIMIT_SECRET.length < 32
  )
    throw Error("Quota configuration unavailable");
  const { data, error } = await db.rpc("consume_chat_quota", {
    client_key: clientKey(
      req,
      process.env.RATE_LIMIT_SECRET + ":staff",
      process.env.VERCEL === "1",
    ),
  });
  if (error) throw Error("Quota unavailable");
  if (!data)
    throw new StaffError("Too many attempts. Try again in one minute.", 429);
}

import {
  allowedStaff,
  authClient,
  failure,
  privateJson,
  readBody,
  requireStaff,
  sameOrigin,
  staffQuota,
  StaffError,
} from "../../../../lib/staff.mjs";
import { database } from "../../../../lib/providers.mjs";

export async function GET() {
  try {
    const { user } = await requireStaff();
    return privateJson({ email: user.email });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req) {
  try {
    sameOrigin(req);
    const body = await readBody(req, 2048);
    const db = database();
    await staffQuota(req, db);
    const auth = await authClient();
    if (body.action === "logout") {
      const { error } = await auth.auth.signOut();
      if (error) throw Error("Logout unavailable");
      return privateJson({ ok: true });
    }
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (
      !allowedStaff(email) ||
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 128
    )
      throw new StaffError(
        "Use your approved staff email and a password of 12–128 characters.",
        401,
      );
    if (body.action === "register") {
      const settings = await fetch(
        process.env.SUPABASE_URL + "/auth/v1/settings",
        {
          headers: { apikey: process.env.SUPABASE_SECRET_KEY },
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        },
      );
      if (!settings.ok || (await settings.json()).mailer_autoconfirm !== false)
        throw new StaffError(
          "Email verification must be enabled before staff registration.",
          503,
        );
      const { error } = await auth.auth.signUp({
        email,
        password: body.password,
      });
      if (error)
        throw new StaffError(
          "Registration could not be completed. If you already have an account, sign in; otherwise try again later.",
          400,
        );
      return privateJson({
        message:
          "Check your email and confirm your account. Then return here to sign in. If no email arrives, contact the project owner to check Supabase email delivery.",
      });
    }
    if (body.action !== "login") throw new StaffError("Unknown action.");
    const { data, error } = await auth.auth.signInWithPassword({
      email,
      password: body.password,
    });
    if (
      error ||
      !data.user?.email_confirmed_at ||
      !allowedStaff(data.user.email)
    ) {
      await auth.auth.signOut();
      throw new StaffError(
        "Sign-in failed. Check your credentials and confirm your email first.",
        401,
      );
    }
    return privateJson({ email: data.user.email });
  } catch (e) {
    return failure(e);
  }
}

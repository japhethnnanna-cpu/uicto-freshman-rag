import {
  failure,
  privateJson,
  requireStaff,
  StaffError,
} from "../../../../lib/staff.mjs";

export async function GET(req) {
  try {
    const { db } = await requireStaff();
    const params = new URL(req.url).searchParams;
    const page = Number(params.get("page") || 0),
      outcome = params.get("outcome");
    if (!Number.isInteger(page) || page < 0 || page > 2000)
      throw new StaffError("Invalid page.");
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    let query = db
      .from("chat_events")
      .select("*", { count: "exact" })
      .gte("created_at", since)
      .order("id", { ascending: false })
      .range(page * 25, page * 25 + 24);
    if (outcome) query = query.eq("outcome", outcome);
    const [events, summary] = await Promise.all([
      query,
      db.rpc("staff_chat_summary", { since }),
    ]);
    if (events.error || summary.error) throw Error("Activity unavailable");
    return privateJson({
      events: events.data,
      total: events.count,
      summary: summary.data,
      page,
    });
  } catch (e) {
    return failure(e);
  }
}

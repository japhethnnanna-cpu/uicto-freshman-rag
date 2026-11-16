import { handleChat, clientKey } from "../../../lib/chat.mjs";
import { database, embed, choose } from "../../../lib/providers.mjs";
import { after } from "next/server";

export const maxDuration = 45;

export function POST(request) {
  let db;
  async function rpc(name, params) {
    db ??= database();
    const { data, error } = await db.rpc(name, params);
    if (error) throw Error("Database operation unavailable");
    return data;
  }
  return handleChat(request, {
    current: process.env.UICTO_ACADEMIC_SESSION,
    allow: (req) =>
      rpc("consume_chat_quota", {
        client_key: clientKey(
          req,
          process.env.RATE_LIMIT_SECRET,
          process.env.VERCEL === "1",
        ),
      }),
    embed,
    choose,
    match: (vector, policy) =>
      rpc("match_reviewed_knowledge", {
        query_embedding: vector,
        target_session: policy.session,
        specific: policy.specific,
      }),
    record: ({ question, answer, ...event }) => {
      console.info(JSON.stringify({ event: "uicto_chat", ...event }));
      if (question) after(async () => {
        try {
          db ??= database();
          const { error } = await db.from("chat_events").insert({ question, answer,
            outcome: event.outcome, category: event.category, latency_ms: event.latency_ms });
          if (error) throw Error("Event unavailable");
        } catch { console.warn("uicto_event_write_failed"); }
      });
    },
  });
}

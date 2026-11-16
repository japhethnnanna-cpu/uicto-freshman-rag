import {
  failure,
  privateJson,
  readBody,
  requireStaff,
  sameOrigin,
  StaffError,
} from "../../../../lib/staff.mjs";
import { reviewInput } from "../../../../lib/review.mjs";
import { embed } from "../../../../lib/providers.mjs";

export const maxDuration = 30;
export async function GET() {
  try {
    const { db } = await requireStaff();
    const { data, error } = await db
      .from("school_knowledge")
      .select(
        "id,external_id,question,answer,category,review_status,reviewed_on,expires_on,academic_session,source,claim_key,staff_document_id",
      )
      .order("id", { ascending: false })
      .limit(500);
    if (error) throw Error("Knowledge unavailable");
    return privateJson({ knowledge: data });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req) {
  try {
    sameOrigin(req);
    const { db, user } = await requireStaff();
    const body = await readBody(req, 32000);
    if (body.action === "withdraw") {
      if (!Number.isSafeInteger(body.id) || body.id < 1)
        throw new StaffError("Choose an answer.");
      const { error } = await db.rpc("withdraw_staff_answer", {
        knowledge_id: body.id,
        reviewer: user.id,
      });
      if (error) throw Error("Withdrawal unavailable");
      return privateJson({
        message: "Answer withdrawn. It will no longer be retrieved.",
      });
    }
    if (
      body.action !== "publish" ||
      !/^[0-9a-f-]{36}$/i.test(body.document_id || "")
    )
      throw new StaffError("Choose a source document.");
    let item;
    try {
      item = reviewInput(body);
    } catch (e) {
      throw new StaffError(e.message);
    }
    const { data: document, error: documentError } = await db
      .from("staff_documents")
      .select("id,review_status")
      .eq("id", body.document_id)
      .single();
    if (documentError || document.review_status === "rejected")
      throw new StaffError("This document is unavailable for review.");
    const vector = await embed(item.question);
    const { data, error } = await db.rpc("publish_staff_answer", {
      document_id: document.id,
      reviewer: user.id,
      item,
      embedding: vector,
    });
    if (error) throw Error("Publication unavailable");
    return privateJson(
      {
        id: data,
        message:
          "Reviewed answer published. Other content in the document still requires review.",
      },
      201,
    );
  } catch (e) {
    return failure(e);
  }
}

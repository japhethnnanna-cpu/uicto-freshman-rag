import {
  failure,
  privateJson,
  readBody,
  requireStaff,
  sameOrigin,
  StaffError,
} from "../../../../lib/staff.mjs";
import { reviewInput, pendingInput } from "../../../../lib/review.mjs";
import { embed } from "../../../../lib/providers.mjs";

export const maxDuration = 30;
export async function GET() {
  try {
    const { db } = await requireStaff();
    const { data, error } = await db
      .from("school_knowledge")
      .select(
        "id,external_id,question,answer,category,review_status,reviewed_on,expires_on,academic_session,source,claim_key,staff_document_id,review_version",
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
    if (["save_pending", "approve_pending"].includes(body.action)) {
      if (
        !Number.isSafeInteger(body.id) ||
        body.id < 1 ||
        !Number.isSafeInteger(body.review_version) ||
        body.review_version < 0
      )
        throw new StaffError("Reload this record before editing.");
      const approve = body.action === "approve_pending";
      let item;
      try {
        item = pendingInput(body, approve);
      } catch (e) {
        throw new StaffError(e.message);
      }
      const { data: prior, error: readError } = await db
        .from("school_knowledge")
        .select("review_version,review_status")
        .eq("id", body.id)
        .single();
      if (readError)
        throw new StaffError(
          "This record could not be loaded. Refresh and try again.",
          404,
        );
      if (
        prior.review_status !== "pending" ||
        prior.review_version !== body.review_version
      )
        throw new StaffError(
          "This record changed. Close the editor and refresh before reviewing again.",
          409,
        );
      if (item.staff_document_id) {
        const { data: doc, error } = await db
          .from("staff_documents")
          .select("id,review_status")
          .eq("id", item.staff_document_id)
          .single();
        if (error || doc.review_status === "rejected")
          throw new StaffError("Choose an available source document.");
      }
      const vector = approve ? await embed(item.question) : null;
      const { data, error } = await db.rpc("review_pending_answer", {
        knowledge_id: body.id,
        expected_version: body.review_version,
        reviewer: user.id,
        item,
        approve,
        answer_embedding: vector,
      });
      if (error?.code === "40001")
        throw new StaffError(
          "This record changed. Close the editor and refresh before reviewing again.",
          409,
        );
      if (error) throw Error("Review unavailable");
      return privateJson({
        review_version: data,
        message: approve
          ? "Answer approved. The chatbot can now retrieve it while its review is valid."
          : "Draft saved. It remains pending and cannot answer student questions.",
      });
    }
    if (body.action === "withdraw") {
      if (!Number.isSafeInteger(body.id) || body.id < 1 || !Number.isSafeInteger(body.review_version) || body.review_version < 0)
        throw new StaffError("Choose an answer.");
      const { error } = await db.rpc("withdraw_staff_answer", {
        knowledge_id: body.id,
        reviewer: user.id,
        expected_version: body.review_version,
      });
      if (error?.code === "40001") throw new StaffError("This record changed. Refresh before withdrawing it.", 409);
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

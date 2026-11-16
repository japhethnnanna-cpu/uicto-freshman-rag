import { createHash } from "node:crypto";
import {
  boundedBytes,
  failure,
  privateJson,
  requireStaff,
  sameOrigin,
  StaffError,
} from "../../../../lib/staff.mjs";
import { extractDocument, MAX_UPLOAD } from "../../../../lib/documents.mjs";

export const maxDuration = 30;
export async function GET(req) {
  try {
    const { db } = await requireStaff();
    const id = new URL(req.url).searchParams.get("id");
    let query = db.from("staff_documents");
    query = id
      ? query.select("*").eq("id", id).single()
      : query
          .select("id,title,filename,provenance,review_status,created_at")
          .order("created_at", { ascending: false })
          .limit(100);
    const { data, error } = await query;
    if (error) throw Error("Documents unavailable");
    return privateJson({ documents: data });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req) {
  try {
    sameOrigin(req);
    const { db, user } = await requireStaff();
    if (!req.headers.get("content-type")?.startsWith("multipart/form-data;"))
      throw new StaffError("Choose a document to upload.");
    const bytes = await boundedBytes(req, MAX_UPLOAD + 16000);
    const form = await new Request(req.url, {
      method: "POST",
      headers: { "Content-Type": req.headers.get("content-type") },
      body: bytes,
    }).formData();
    const file = form.get("file"),
      title = String(form.get("title") || "").trim(),
      provenance = String(form.get("provenance") || "").trim();
    if (
      !(file instanceof File) ||
      !title ||
      title.length > 200 ||
      !provenance ||
      provenance.length > 1000 ||
      file.name.length > 200
    )
      throw new StaffError(
        "Provide a title, a document and its issuing office or source.",
      );
    const buffer = Buffer.from(await file.arrayBuffer());
    let content;
    try {
      content = await extractDocument(buffer, file.name);
    } catch (e) {
      throw new StaffError(e.message);
    }
    const { data, error } = await db
      .from("staff_documents")
      .insert({
        title,
        provenance,
        filename: file.name.replace(/[\\/\u0000-\u001f]/g, "_"),
        content,
        uploaded_by: user.id,
        content_hash: createHash("sha256").update(buffer).digest("hex"),
      })
      .select("id")
      .single();
    if (error) throw Error("Upload unavailable");
    return privateJson(
      {
        id: data.id,
        message:
          "Text saved for staff review. It is not yet available to the chatbot.",
      },
      201,
    );
  } catch (e) {
    return failure(e);
  }
}

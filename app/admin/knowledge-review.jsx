"use client";

import { useEffect, useRef, useState } from "react";
import { reviewedSource } from "../../lib/reviewed-workbook.mjs";
import styles from "./staff.module.css";

export default function KnowledgeReview({
  record,
  documents,
  busy,
  dateBounds,
  notice,
  onSave,
  onCancel,
  onReadDocument,
}) {
  const questionInput = useRef(null);
  useEffect(() => {
    questionInput.current?.focus();
  }, []);
  const [documentId, setDocumentId] = useState(record.staff_document_id || "");
  const [sourceText, setSourceText] = useState(null);
  return (
    <section
      className={styles.card}
      aria-label={"Review " + record.external_id}
    >
      <h3>Edit & review {record.external_id}</h3>
      <p>
        Save an unfinished answer as a draft, or approve it after checking
        authoritative guidance. Saving a draft does not publish it.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          const action = event.nativeEvent.submitter?.value || "save_pending";
          onSave({
            ...values,
            action,
            id: record.id,
            review_version: record.review_version,
            confirmed: values.confirmed === "on",
          });
        }}
      >
        <label>
          Student question
          <input
            ref={questionInput}
            name="question"
            defaultValue={record.question || ""}
            required
            maxLength={800}
          />
        </label>
        <label>
          Answer
          <textarea
            name="answer"
            defaultValue={record.answer || ""}
            rows={6}
            maxLength={6000}
          />
        </label>
        <label>
          Category
          <input
            name="category"
            defaultValue={record.category || ""}
            required
            maxLength={80}
          />
        </label>
        <label>
          Claim key
          <input
            name="claim_key"
            defaultValue={record.claim_key || ""}
            maxLength={120}
            placeholder="library-location"
          />
        </label>
        <p>
          Use the same claim key for statements about the same fact, so
          contradictions can be detected.
        </p>
        <label>
          Academic session
          <input
            name="academic_session"
            defaultValue={record.academic_session || ""}
            maxLength={9}
            placeholder="2026/2027"
          />
        </label>
        <p>
          Fees, admissions, deadlines and other session-specific guidance
          require a session before approval.
        </p>
        <label>
          Source document
          <select
            name="staff_document_id"
            value={documentId}
            onChange={(event) => {
              setDocumentId(event.target.value);
              setSourceText(null);
            }}
          >
            <option value="">Use an official source URL</option>
            {record.staff_document_id &&
              !documents.some((d) => d.id === record.staff_document_id) && (
                <option value={record.staff_document_id}>
                  Previously linked document
                </option>
              )}
            {documents
              .filter((d) => d.review_status !== "rejected")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
          </select>
        </label>
        {documentId ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onReadDocument(documentId, setSourceText)}
            >
              Read source document
            </button>
            {sourceText && <pre className={styles.document}>{sourceText}</pre>}
          </>
        ) : (
          <label>
            Official source URL
            <input
              name="source"
              defaultValue={record.staff_document_id ? "" : record.source || ""}
              maxLength={1000}
              placeholder="https://uicto.edu.ng/..."
            />
            {reviewedSource(record.source) && (
              <a
                href={reviewedSource(record.source)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open recorded source
              </a>
            )}
          </label>
        )}
        <p>
          Use a supported official university, NUC or NELFUND page, or upload
          school guidance under Documents & review. A student question or an
          unverified answer is not evidence.
        </p>
        <label>
          Review expires on
          <input
            name="expires_on"
            type="date"
            defaultValue={
              record.expires_on && record.expires_on >= dateBounds.today
                ? record.expires_on
                : ""
            }
            min={dateBounds.today}
            max={dateBounds.latest}
          />
        </label>
        <label className={styles.check}>
          <input name="confirmed" type="checkbox" /> I verified this answer
          against its source and checked the academic session and review expiry.
        </label>
        {notice && <p role="status">{notice}</p>}
        <div className={styles.actions}>
          <button type="submit" value="save_pending" disabled={busy}>
            Save draft
          </button>
          <button type="submit" value="approve_pending" disabled={busy}>
            Approve answer
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

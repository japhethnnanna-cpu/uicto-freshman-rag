"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./staff.module.css";
import KnowledgeReview from "./knowledge-review";

const labels = {
  supported_excerpt: "Answered from reviewed guidance",
  unsupported: "No verified answer",
  ambiguous: "Needs an academic session",
  conflict: "Conflicting guidance",
  greeting: "Conversation",
  limited: "Rate limited",
  provider_failure: "Answer service failed",
  embedding_failure: "Search service failed",
  retrieval_failure: "Database failed",
  limiter_failure: "Rate limiter failed",
};

export default function StaffDashboard() {
  const [user, setUser] = useState(null),
    [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState("activity"),
    [activity, setActivity] = useState(null);
  const [documents, setDocuments] = useState([]),
    [document, setDocument] = useState(null);
  const [knowledge, setKnowledge] = useState([]),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(0);
  const [knowledgeFilter, setKnowledgeFilter] = useState("pending");
  const [editing, setEditing] = useState(null);
  const [dateBounds] = useState(() => ({
    today: new Date().toISOString().slice(0, 10),
    latest: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  }));

  async function api(path, body) {
    const response = await fetch("/api/staff/" + path, {
      cache: "no-store",
      signal: AbortSignal.timeout(35000),
      ...(body
        ? {
            method: "POST",
            ...(body instanceof FormData
              ? { body }
              : {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }),
          }
        : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) setUser(null);
      throw Error(data.error || "Request failed.");
    }
    return data;
  }
  useEffect(() => {
    let active = true;
    fetch("/api/staff/auth", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    })
      .then(async (response) => {
        const data = await response.json();
        if (active && response.ok) setUser(data.email);
        else if (active && response.status !== 401)
          setNotice(data.error || "Unable to check your session.");
      })
      .catch(() => {
        if (active)
          setNotice(
            "Unable to reach staff sign-in. Check your connection and reload.",
          );
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const path =
      tab === "activity"
        ? `activity?page=${page}&outcome=${encodeURIComponent(filter)}`
        : tab;
    fetch("/api/staff/" + path, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          if ([401, 403].includes(response.status)) setUser(null);
          throw Error(data.error || "Unable to load dashboard.");
        }
        if (tab === "activity") setActivity(data);
        if (tab === "documents") setDocuments(data.documents);
        if (tab === "knowledge") setKnowledge(data.knowledge);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setNotice(error.message);
      });
    return () => controller.abort();
  }, [user, tab, page, filter]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(
        error.name === "TimeoutError"
          ? "Request timed out. Refresh to check whether it completed before retrying."
          : error.message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (tab === "activity")
      setActivity(
        await api(
          `activity?page=${page}&outcome=${encodeURIComponent(filter)}`,
        ),
      );
    else if (tab === "documents")
      setDocuments((await api("documents")).documents);
    else setKnowledge((await api("knowledge")).knowledge);
  }
  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      action = event.nativeEvent.submitter?.value || "login";
    await run(async () => {
      const data = await api("auth", {
        action,
        email: form.get("email"),
        password: form.get("password"),
      });
      if (data.email) setUser(data.email);
      if (data.message) setNotice(data.message);
    });
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link href="/">← Student assistant</Link>
          <h1>UICTO staff dashboard</h1>
          <p>Review student questions and maintain trusted school guidance.</p>
        </div>
        {user && (
          <div>
            <p>{user}</p>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("auth", { action: "logout" });
                  setUser(null);
                  setActivity(null);
                  setDocuments([]);
                  setKnowledge([]);
                  setDocument(null);
                })
              }
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {checking ? (
        <p role="status">Checking staff access…</p>
      ) : !user ? (
        <section className={styles.card}>
          <h2>Staff sign-in</h2>
          <p>
            Only approved staff accounts can access questions and documents. New
            staff must confirm their email before signing in.
          </p>
          <form onSubmit={login} className={styles.form}>
            <label>
              Staff email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <p>
              Use 12–128 characters. Never reuse a university portal password.
            </p>
            <div className={styles.actions}>
              <button disabled={busy} name="action" value="login">
                {busy ? "Please wait…" : "Sign in"}
              </button>
              <button disabled={busy} name="action" value="register">
                Create my staff account
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          <nav className={styles.actions} aria-label="Staff sections">
            {[
              ["activity", "Student questions"],
              ["documents", "Documents & review"],
              ["knowledge", "Knowledge base"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  setNotice("");
                }}
              >
                {label}
              </button>
            ))}
            <button disabled={busy} onClick={() => run(refresh)}>
              Refresh
            </button>
          </nav>
          {tab === "activity" && (
            <section>
              <h2>Student questions · last 30 days</h2>
              <p>
                “Answered” means a reviewed excerpt was returned, not that its
                accuracy has been independently confirmed. Questions and replies
                may still contain personal information; keep them private.
              </p>
              <div className={styles.metrics}>
                {activity?.summary.map((item) => (
                  <div className={styles.card} key={item.outcome}>
                    <strong>{item.count}</strong>
                    <span>{labels[item.outcome] || item.outcome}</span>
                  </div>
                ))}
              </div>
              <label>
                Filter outcome
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  {[["", "All outcomes"], ...Object.entries(labels)].map(
                    ([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              {!activity ? (
                <p>Loading questions…</p>
              ) : (
                <>
                  <p>
                    {activity.total} matching questions. New tracking starts
                    with this release; historical logs remain preserved
                    separately.
                  </p>
                  {activity.events.map((item) => (
                    <article className={styles.card} key={item.id}>
                      <div className={styles.row}>
                        <strong>{labels[item.outcome] || item.outcome}</strong>
                        <time>
                          {new Date(item.created_at).toLocaleString()}
                        </time>
                      </div>
                      <h3>{item.question}</h3>
                      <p className={styles.answer}>
                        {item.answer ||
                          "No answer returned. Check the outcome above."}
                      </p>
                      <small>
                        {item.category || "Uncategorised"} ·{" "}
                        {(item.latency_ms / 1000).toFixed(1)} seconds
                      </small>
                    </article>
                  ))}
                  {!activity.events.length && (
                    <p>No questions match this filter.</p>
                  )}
                  <div className={styles.actions}>
                    <button
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span>Page {page + 1}</span>
                    <button
                      disabled={(page + 1) * 25 >= activity.total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
          {tab === "documents" && (
            <section>
              <h2>Upload school guidance</h2>
              <p>
                DOCX, TXT or Markdown, up to 3 MB. We save extracted text for
                review, not the original file. Check tables and formatting
                carefully. Personal student reports are not school policy.
              </p>
              <form
                className={`${styles.card} ${styles.form}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget,
                    body = new FormData(form);
                  run(async () => {
                    const result = await api("documents", body);
                    setNotice(result.message);
                    form.reset();
                    await refresh();
                    setDocument(
                      (await api("documents?id=" + result.id)).documents,
                    );
                  });
                }}
              >
                <label>
                  Document title
                  <input name="title" required maxLength={200} />
                </label>
                <label>
                  Issuing office / source and date
                  <input
                    name="provenance"
                    required
                    maxLength={1000}
                    placeholder="Example: Registrar’s signed notice, 16 November 2026"
                  />
                </label>
                <label>
                  Document file
                  <input
                    name="file"
                    type="file"
                    accept=".docx,.txt,.md"
                    required
                  />
                </label>
                <button disabled={busy}>Upload for review</button>
              </form>
              <h2>Uploaded documents</h2>
              <p>
                Latest 100 documents. “Reviewed” means at least one answer has
                been published, not that the entire document is approved.
              </p>
              {documents.map((item) => (
                <article className={styles.card} key={item.id}>
                  <div className={styles.row}>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.provenance}</p>
                      <small>
                        {item.review_status} · {item.filename}
                      </small>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () =>
                          setDocument(
                            (await api("documents?id=" + item.id)).documents,
                          ),
                        )
                      }
                    >
                      Read & review
                    </button>
                  </div>
                </article>
              ))}
              {!documents.length && <p>No documents uploaded yet.</p>}
              {document && (
                <article className={styles.card}>
                  <h2>Review: {document.title}</h2>
                  <p>{document.provenance}</p>
                  <pre className={styles.document}>{document.content}</pre>
                  <h3>Publish one verified answer</h3>
                  <p>
                    Write a concise answer supported by the text above. Do not
                    fill gaps from memory or unrelated websites. Check existing
                    answers before publishing; conflicting claims make the bot
                    abstain.
                  </p>
                  <form
                    key={document.id}
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget,
                        values = Object.fromEntries(new FormData(form));
                      run(async () => {
                        const result = await api("knowledge", {
                          ...values,
                          confirmed: values.confirmed === "on",
                          document_id: document.id,
                          action: "publish",
                        });
                        setNotice(result.message);
                        form.reset();
                        await refresh();
                      });
                    }}
                  >
                    <label>
                      Student question
                      <input name="question" required maxLength={800} />
                    </label>
                    <label>
                      Verified answer
                      <textarea
                        name="answer"
                        required
                        maxLength={6000}
                        rows={6}
                      />
                    </label>
                    <label>
                      Category
                      <input
                        name="category"
                        required
                        maxLength={80}
                        placeholder="Admissions"
                      />
                    </label>
                    <label>
                      Claim key
                      <input
                        name="claim_key"
                        required
                        maxLength={120}
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        placeholder="admission-cutoff"
                      />
                    </label>
                    <p>
                      Use the same claim key for answers about the same fact, so
                      contradictions can be detected.
                    </p>
                    <label>
                      Academic session
                      <input
                        name="academic_session"
                        pattern="20[0-9]{2}/20[0-9]{2}"
                        placeholder="2026/2027"
                      />
                    </label>
                    <p>
                      Required for fees, admission rules, dates and other
                      session-specific guidance. Leave blank only for
                      information that applies across sessions.
                    </p>
                    <label>
                      Review expires on
                      <input
                        name="expires_on"
                        type="date"
                        min={dateBounds.today}
                        max={dateBounds.latest}
                        required
                      />
                    </label>
                    <label className={styles.check}>
                      <input type="checkbox" name="confirmed" required /> I
                      verified this answer against authoritative school guidance
                      and checked its session and expiry.
                    </label>
                    <button disabled={busy}>Publish reviewed answer</button>
                  </form>
                </article>
              )}
            </section>
          )}
          {tab === "knowledge" && (
            <section>
              <h2>Knowledge base</h2>
              <p>
                Latest 500 records. Pending or expired records are excluded from
                answers. Edit pending answers below, save drafts, or approve
                answers after verifying their sources. To edit an approved
                answer, withdraw it first.
              </p>
              <label>
                Filter knowledge records
                <select
                  value={knowledgeFilter}
                  onChange={(event) => setKnowledgeFilter(event.target.value)}
                >
                  <option value="pending">
                    Pending review (
                    {
                      knowledge.filter(
                        (item) => item.review_status === "pending",
                      ).length
                    }
                    )
                  </option>
                  <option value="approved">
                    Approved (
                    {
                      knowledge.filter(
                        (item) => item.review_status === "approved",
                      ).length
                    }
                    )
                  </option>
                  <option value="all">All records</option>
                </select>
              </label>
              {editing && (
                <KnowledgeReview
                  key={editing.id + ":" + editing.review_version}
                  record={editing}
                  documents={documents}
                  busy={busy}
                  dateBounds={dateBounds}
                  notice={notice}
                  onCancel={() => setEditing(null)}
                  onReadDocument={(id, show) =>
                    run(async () => {
                      const source = (await api("documents?id=" + id))
                        .documents;
                      show(source.content);
                    })
                  }
                  onSave={(body) =>
                    run(async () => {
                      const result = await api("knowledge", body);
                      setNotice(result.message);
                      setEditing(null);
                      await refresh();
                    })
                  }
                />
              )}
              {knowledge
                .filter(
                  (item) =>
                    knowledgeFilter === "all" ||
                    item.review_status === knowledgeFilter,
                )
                .map((item) => (
                  <article key={item.id} className={styles.card}>
                    <div className={styles.row}>
                      <strong>
                        {item.external_id} · {item.review_status}
                        {item.expires_on &&
                        item.expires_on < new Date().toISOString().slice(0, 10)
                          ? " · expired"
                          : ""}
                      </strong>
                      {item.review_status === "pending" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              setDocuments((await api("documents")).documents);
                              setEditing(item);
                            })
                          }
                        >
                          Edit & review
                        </button>
                      )}
                      {item.review_status === "approved" && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Withdraw this answer from the chatbot? Its record will be preserved.",
                              )
                            )
                              run(async () => {
                                setNotice(
                                  (
                                    await api("knowledge", {
                                      action: "withdraw",
                                      id: item.id,
                                      review_version: item.review_version,
                                    })
                                  ).message,
                                );
                                await refresh();
                              });
                          }}
                        >
                          Withdraw answer
                        </button>
                      )}
                    </div>
                    <h3>{item.question}</h3>
                    <p className={styles.answer}>{item.answer}</p>
                    <small>
                      {item.category} ·{" "}
                      {item.academic_session || "Across sessions"} · Review
                      expires {item.expires_on || "not set"}
                    </small>
                    <p>Source: {item.source || "No source recorded"}</p>
                    <p>Claim: {item.claim_key || "Not assigned"}</p>
                  </article>
                ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

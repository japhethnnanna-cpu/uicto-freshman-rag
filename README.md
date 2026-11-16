# Uchat · UICTO Freshman Assistant

Uchat answers freshman questions from reviewed university guidance. It runs in Next.js with a server-side Supabase client, PostgreSQL/pgvector, Gemini embeddings and configurable excerpt selection. An answer may be unavailable even when every service is healthy.

## Run locally

Use Node 24, npm and a **disposable staging Supabase project**. Install with `npm ci`. The offline suite and production build work without provider credentials.

```sh
npm test
npm run lint
npm run build
npm run dev
```

For connected chat, put these server-only settings in the ignored `.env.local` file. Do not use a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | URL and server secret for the same staging database |
| `GEMINI_API_KEY` | Gemini embedding and default excerpt-selection requests |
| `ANSWER_PROVIDER` | `gemini` (default) or `nvidia`; selection returns only an excerpt index |
| `NVIDIA_API_KEY` | Required only when `ANSWER_PROVIDER=nvidia` |
| `STAFF_EMAILS` | Comma-separated staff email allowlist, server-only; empty denies every account |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable Auth key; distinct from the server secret |
| `RATE_LIMIT_SECRET` | Independent random secret, at least 32 characters, shared by all instances |
| `UICTO_ACADEMIC_SESSION` | Registrar-confirmed current session such as `2026/2027`. Leave unset if unknown. Update at rollover. |

The migration assumes the existing `school_knowledge` table, its service-role access and a 768-dimensional vector column. It is additive to that schema. Use the bootstrap in the database test **only as a fixture**. For staging use a schema-only copy of the existing project. The old `scripts/test-*.mjs` programs are connected probes, including writes and paid calls. CI runs only `tests/*.test.mjs`.

## What happens to a question

1. The API reads up to 4 KiB of JSON with a four-second body deadline, normalizes the question and enforces 1–800 characters. Postgres atomically allows eight valid requests per fixed minute per client bucket. On Vercel the key is a daily keyed digest of the platform-provided client IP. Elsewhere or without a valid trusted header, clients share a bucket. Old buckets are cleared on subsequent requests. The limiter fails closed.
2. Explicit sessions win. Ambiguous years prompt clarification. Time-sensitive questions need an explicit session or the configured current session. Reviewed session-neutral material can answer ordinary questions. Reviewers must attach the applicable session to policies, fees, admissions, registration and deadlines.
3. Gemini embeds the question with `gemini-embedding-2` at 768 dimensions. One RPC searches approved, unexpired internal and official records. Eligibility is applied before ranking. The original strict cosine threshold of `> 0.75` remains. A shared `claim_key` groups statements about the same decision, e.g. `school-fee-payment-enabled`. Differently worded answers from different applicable sources with that key trigger conservative abstention even when the second source falls outside the nearest eight. Reviewers must reconcile overlap, supersede obsolete notices and use consistent keys.
4. Gemini `gemini-3.5-flash-lite` (or optionally NVIDIA `openai/gpt-oss-20b`) receives separate instructions, excerpts and question. It can return a numbered selection or zero. The server returns the selected stored paragraph verbatim and constructs its citation independently. Arbitrary model prose cannot enter the answer. A supported excerpt means a model selected reviewed material. Selection can still be irrelevant. Missing, ambiguous and conflicting evidence have separate outcomes.
5. Database fetches, embedding calls and selection have individual deadlines (8, 7.5 and 12 seconds). The two database calls plus embedding and selection fit within the 42-second browser timeout and 45-second route limit, including the 4-second request-body deadline. Database writes are not automatically retried because a timed-out quota request may already have counted. Students receive bounded error messages. Operational logs carry outcomes, stage timings and the selected category. The staff dashboard stores questions and returned excerpts with best-effort redaction of common emails, phone numbers, IDs and credentials. It never stores IPs. Redaction is not complete anonymisation; students see a notice before submitting and staff must treat records as private. Questions still go to the embedding and selection providers. Provider and hosting retention settings need operator review. No historical logs are modified.

## Why index outside chat

| Strategy | Student experience and operational trade-off |
| --- | --- |
| Live site access per question | Current when reachable, but adds network latency and failure modes on every turn. Repeated fetching, embedding and inference increase usage. Redirect validation, bot protection and site restrictions remain on the critical path. |
| Manual or scheduled indexing | Fetch/review cost is paid on change. Retrieval stays available through site outages. Old copies need explicit expiry, a reviewer, and a way to remove or supersede them. |
| Internal + official index, optional live fallback | This implementation combines both collections. Live fallback would add the same permission, latency and injection risks to precisely the cases with weak evidence. It is disabled. No paid scheduler is required. |

### Official site checks · 3 November 2026

Identified requests to both hosts returned plain-text robots policies with `search=yes,ai-train=no,use=reference`. Neither provided an affirmative `ai-input=yes`. Both default `/sitemap.xml` endpoints returned 404 and neither policy advertised a sitemap. The identified discovery client subsequently declined HTML responses for all three seeds as restricted, with HTTP 200. No pages were indexed during this check. Search visibility does not establish permission to embed or generate from a page. [www robots policy](https://www.uicto.edu.ng/robots.txt) · [apex robots policy](https://uicto.edu.ng/robots.txt)

The fee PDF explicitly covers **2025/2026**. The registration procedure labeled **2026/2027** says school-fee payment was unavailable at publication and separately describes acceptance fees. Its date of publication is unknown. The June 2026 admission announcement preceded the Post-UTME procedure announcing screening. A working link to the prior fee PDF from a newer procedure is insufficient evidence for a current amount. Check applicability again at review time. [Fee PDF](https://www.uicto.edu.ng/assets/pdf/fee-structure.pdf) · [Registration procedure](https://www.uicto.edu.ng/admission/procedure) · [June announcement](https://uicto.edu.ng/news/20262027-admission-exercise-commences-at-uicto) · [Post-UTME procedure](https://uicto.edu.ng/post-utme/procedure)

## Discover, ingest and review

`npm run sync -- discover` checks robots per origin and lists allowed reference links from news and the two public procedure pages. No database or AI calls. It refuses portals, queries, forms and arbitrary hosts. HTTPS uses pinned public DNS results, normal certificate verification and validated redirect destinations. Each process allows up to 24 network requests, 512 KiB per response, six-second deadlines, at least one second between requests, crawl-delay handling and one bounded backoff retry for selected transient failures. A challenge, unknown policy or denied page stops that fetch. Automatic PDF parsing is disabled.

For ingestion create a **private operator manifest** outside Git. Use administrator-authored or separately authorized excerpts with permission covering embedding and answer use. Do not paste restricted web content as a workaround. Each paragraph must stand alone as an answer. Use one decision/topic per document, one session and short paragraphs. The following example is synthetic, for dry runs only.

```json
[{
  "mode": "manual",
  "url": "https://www.uicto.edu.ng/admission/procedure",
  "title": "Synthetic registration fixture",
  "category": "registration",
  "claim_key": "registration-location",
  "academic_session": "2026/2027",
  "published_on": null,
  "permission_reference": "Synthetic local fixture only",
  "text": "This fictional exercise takes place in Room A."
}]
```

```sh
npm run sync -- sync path/to/manifest.json
npm run sync -- sync path/to/manifest.json --compare
npm run sync -- sync path/to/manifest.json --write
```

The first previews content offline for manual entries, assuming an empty index. `--compare` reads existing versions without writes. Both list discovered, changed, skipped, failed, pending review and estimated calls **at approval**. `--write` stages text without embedding it. A new version atomically supersedes the previous one and starts pending. Unchanged content retains its approval and review deadline. Concurrent stale writers must retry. A manifest omission causes no deletion. For `mode: "web"`, use the same fields but omit text. Approved public HTML additionally requires applicable robots permission, explicit AI-input permission and acceptable article boundaries. A failed web refresh in write mode quarantines that version. The known hosts currently fail the automated RAG gate. Manual ingestion time records when the supplied material was read; it does not certify a new fetch of the live URL.

**Review before approval.** Read the entire staged version and original source. Confirm permission, title, publication date or explicit unknown, applicable session and one shared decision key. Cross-check competing guidance including internal records and earlier announcements. Split long instructions into self-contained paragraphs. Use the shortest justified expiry, at most 90 days for an official version.

```sql
select d.id, d.content_hash, d.title, d.canonical_url, d.academic_session,
       d.published_on, d.permission_reference, c.ordinal, c.answer
from public.official_documents d join public.official_chunks c on c.document_id=d.id
where d.superseded_by is null and d.review_status='pending'
order by d.id, c.ordinal;
```

After human review use `npm run sync -- approve ID HASH YYYY-MM-DD --write` against staging. This explicitly authorizes provider calls for reviewed paragraphs. The database verifies the version, hash, expiry and vector count in one transaction before making it searchable. Renewing the same version reuses stored embeddings. A failure before publication leaves the version unpublished or under its previous approval deadline. For a removed source set `extraction_status='removed'` on its exact reviewed id/hash. For an announcement replaced at another URL set its `superseded_by` to the newer confirmed version's id. Do this in an administrator transaction after checking both versions and affected row counts. Confirmed contradictions remain out of student answers until reconciled.

**Reviewed Excel master.** Use `data/UICTO_Reviewed_Knowledge.xlsx`. The original `UICTO_Freshman_QnA_Demo.xlsx` is retained as an unchanged historical input, not current guidance. The reviewed master includes source URLs, session scope, review/expiry dates, pending gaps, staff-confirmation fields and analysis of the supplied October 5–8 student-question report. On 14 November 2026, the user authorised updating Supabase: all 30 original IDs were retained, 36 entries were added, and the resulting collection contains 28 approved records and 38 pending records. Approved means manually checked against the cited primary source during that update, not endorsed by university staff. Pending records have no embedding and are excluded by reviewed retrieval.

Run `npm run knowledge` to validate the master offline. Run `npm run knowledge -- --prepare` only after reviewing its changes: this reads the database, saves a full local snapshot and a copy of the input workbook under ignored `data/knowledge-backups/`, embeds approved new/changed answers, and creates `apply.sql`. It does **not** apply database changes. Inspect the prepared change, then execute it through an authorised database operation. The transaction checks that the original rows have not changed since preparation and updates answers, source, scope, review state and vectors together. It does not delete omitted records or alter unknown publication/update dates. Retain the snapshot for any separately authorised restore. The one-time 14 November transaction was tested on disposable PostgreSQL before being applied to Supabase.

Keep unconfirmed staff responses in the workbook's staff columns until a reviewer verifies them against attributable evidence. Approval currently requires a source URL in the narrow primary-source registry in `lib/reviewed-workbook.mjs`; extending that registry requires inspecting the new source, not accepting arbitrary URLs. This registry validates manually curated citations and does not relax the separate website-fetch permission checks. Chat still uses the stored knowledge base only, with no live web lookup.

**Legacy import.** `npm run import` remains a safe importer for the old four-column workbook: validation is offline, `--compare` is read-only and `--write` adds new records as pending without overwriting existing content. It does not publish reviewed edits. Do not use the old demo to restore obsolete answers or bulk-approve it.

## Operations, evaluation and troubleshooting

- **Coverage and latency.** Export a bounded time range of `uicto_chat` JSON lines and pipe into `node scripts/chat-report.mjs` (one JSON object per line). Compare supported, unsupported, ambiguous, conflict and component failure counts plus p50/p95 stage timings. Use `database/freshness.sql` for pending, unavailable, expiring and expired sources. Limit access to operator reports and configure log retention. Unsupported counts identify coverage gaps; restrict access to the recorded questions and establish an institutional retention policy.
- **Latency baseline.** Supabase reports `eu-west-1`, and the ready Vercel production deployment reports `iad1`. One read-only, server-side legacy match measured 3.158 ms on 30 rows. This excludes the Vercel–Supabase round trip, cold starts and provider calls. Compare staging retrieval p50/p95 by function region on representative traffic before changing regions.
- **Relevance baseline.** Reusing the existing 30 vectors as queries at 0.75 returned the same record first in 30/30 cases, averaging 1.60 results. Self-match measures compatibility only. The offline fixtures cover historical fees, admissions, invalid requests, unsupported and adversarial questions, provider failures, version changes and source rendering. Run a blinded paraphrase/irrelevance benchmark before tuning the threshold.
- **503.** Inspect the redacted failure stage. A limiter failure usually means an absent secret, unavailable DB or missing migration. Retrieval failure means no result was safely established. A 429 includes `Retry-After`. Shared campus NAT can throttle independent students; measure before raising the budget.
- **No answer after migration.** Existing rows begin pending. Check human review, session, expiry, claim key, embedding and threshold. A current policy needs current approved evidence. Check `database/freshness.sql` before changing retrieval.
- **Deployment state.** Latest ready production deployment checked for this repository used `main` SHA `8514727`. Analytics integration exists on a separate remote branch at `e164688`. This working tree does not import Vercel Web Analytics. Traffic counts cannot establish answer quality. [Production deployment](https://vercel.com/japfetooo-hub-s-projects/urag/6EBjqecUgyTqhkndR9LUcETBepvC)

## Deployment and rollback checklist

1. Reconcile local edits and the one-commit difference from `origin/main` before a PR. Record the current production SHA, function grants, event trigger attachment and row counts. Review `database/preflight.sql` and the proposed `supabase/migrations/20261114120130_reviewed_knowledge.sql`. Check extension schema, unique IDs, column collisions, function signatures, existing RLS, backup/restore readiness and consumers of the old public match RPC.
2. With a **staging** database, run the migration in its transaction. Verify anon/authenticated roles cannot execute old/new match, administrative helper, staging, approval or limiter functions. Verify the RLS event trigger still runs on new tables. Test a student request with server-role credentials only. No migration is run by build or CI.
3. Review internal and official records before switching traffic. Exercise conflict, no-answer, fees across two sessions, 429 and provider outage cases. Configure preview-only environment variables, verify coverage and check representative real provider selections with a separately approved spend cap.
4. Run lint, offline tests and build. Compare preview latency and outcomes with baseline. Obtain explicit approval before production migration, secrets changes, deploy or merge. Enable scheduling only after confirming plan limits, university permission and a reviewer for failures. Keep credentials in a trusted worker or manual CLI.
5. **Rollback.** Disable sync and approvals first. For a bad document revoke its approval or mark the exact version unavailable. To roll back application code use a reviewed known-good deployment. The legacy service-role RPC remains available, but old code resumes raw-question logging and lacks freshness controls; use a maintenance response if that is unacceptable. Leave additive tables and historical records in place. Restore specific grants only after checking dependencies. Resolve data inconsistencies from backup in staging before any authorized production restore.

See `TODO.md` for release blockers and deferred work.

## Files changed in this implementation

| Area | Exact repository paths |
| --- | --- |
| Chat and citations | `app/api/chat/route.js`, `app/page.tsx`, `app/layout.tsx`, `app/citation.tsx`, `lib/chat.mjs`, `lib/providers.mjs`, `lib/sources.mjs` |
| Ingestion and operations | `lib/official-content.mjs`, `lib/official-fetch.mjs`, `scripts/official-sync.mjs`, `scripts/import-knowledge.mjs`, `scripts/chat-report.mjs` |
| Database | `database/preflight.sql`, `database/freshness.sql`, `supabase/migrations/20261114120130_reviewed_knowledge.sql` |
| Offline verification | `tests/chat.test.mjs`, `tests/citation.test.mjs`, `tests/cli.test.mjs`, `tests/database.test.mjs`, `tests/official.test.mjs`, `tests/route.test.mjs` |
| Setup and release | `.github/workflows/checks.yml`, `.gitignore`, `package.json`, `package-lock.json`, `README.md`, `TODO.md` |

## Staff dashboard

`/admin` uses Supabase Auth with HttpOnly cookies. Every staff API revalidates the user with Auth, requires a confirmed email in `STAFF_EMAILS`, and rejects cross-origin mutations. There is no public admin role or service key in browser code. Staff account creation requires email confirmation enabled in Supabase; create an account using the approved email, confirm the message, then return to sign in. Email delivery requires working Supabase SMTP and sender configuration. The server does not send invitation messages automatically.

The dashboard shows paginated questions, returned answers and outcomes for the last 30 days. Counts distinguish supported excerpts, missing evidence, clarification, greetings, throttling and service failures. It preserves earlier `chat_questions` logs separately. `chat_events` has no public or student read permission. Operational logs do not include question text. The 30-day view is not a deletion policy: records remain until the operator applies an approved retention policy.

Staff may upload DOCX, UTF-8 TXT or Markdown, up to 3 MB and 60,000 extracted characters. Only extracted body text, provenance and a content hash are retained, not the original file. PDF/image/OCR and spreadsheet upload are deliberately unsupported; export to an accepted text format and check the result. ZIP entries and extracted DOCX XML are bounded; embedded macros, links and objects never execute. The document stays pending until staff publish a specific Q&A after reviewing its source, session, claim key and expiry (maximum 90 days). A reviewed document is not blanket approval of its entire text. Withdrawn answers remain in the database, but lose approval and embedding. Publication and withdrawal record reviewer IDs in `staff_audit`.

`supabase/migrations/20261116000631_staff_dashboard.sql` adds staff documents, activity and audit tables with RLS and service-only privileges, plus atomic publishing/withdrawal RPCs. Existing 66 knowledge records are preserved. Local filenames match the versions recorded by Supabase MCP; no migration runs during build or deployment. Roll back application code independently and retain these additive tables.

Greetings and thanks use deterministic responses without AI calls. School questions still require reviewed, in-date, session-matching excerpts. Switching providers changes selection only, not the trusted source policy. Gemini generation succeeded in the live pre-release probe; NVIDIA generation timed out, so its key validity remains unconfirmed. Ollama Cloud needs a separate account/key and is not configured.

The first Vercel preview returned HTTP 404 for the deprecated Gemini 2.5 Flash selector, despite its availability to the local key. The selector now uses stable Gemini 3.5 Flash-Lite with minimal thinking. Safe numeric provider status codes are included in operational telemetry; provider response bodies and credentials are not logged.

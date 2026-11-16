# Remaining operations and knowledge work

## Verified on 16 November 2026

- Applied the reviewed-knowledge and staff-dashboard migrations to UICTO Fbot, with local filenames aligned to recorded remote versions. Existing knowledge remains 28 approved and 38 pending records.
- Added staff-only question tracking, document text upload, explicit Q&A review, expiry/session checks and audited withdrawal. Live Auth/API tests covered staff access, student denial, cross-origin denial, pending uploads and sign-out. Temporary test accounts and documents were removed.
- Live Gemini generation works. The first preview exposed HTTP 404 for deprecated Gemini 2.5 Flash; selection was migrated to Gemini 3.5 Flash-Lite. Chat returned a friendly greeting, a sourced university contact answer, and an explicit abstention on unsupported 2026/2027 Computer Science tuition. NVIDIA generation timed out; key validity is not established by its models-list endpoint.
- 29 automated tests passed; lint and production build passed. Production dependency audit: zero vulnerabilities. Seven moderate development-tool advisories remain in the TypeScript ESLint/minimatch dependency chain after compatible updates.
- Windows browser-control policy blocked visual interaction testing in this session. API/HTTP checks do not establish visual layout or clicking behavior.

## Staff and operational follow-up

- Confirm the named staff account email and sign-in through the deployed dashboard. Email delivery has not been tested; Supabase must have working confirmation-email delivery.
- Obtain staff confirmation for the 38 pending gaps, especially WiFi, ID cards, grading, hostel rules, verification exceptions, current tuition, NYSC mobilisation and relocation. Expired notices must be checked again, never blindly extended.
- Agree on retention for chat_events, old chat_questions and provider/hosting logs. The dashboard's 30-day view is not automatic deletion. Redaction reduces common identifiers but does not guarantee anonymity.
- Benchmark anonymised student paraphrases and cross-session questions. Monitor unsupported answers, conflicts and provider failures, campus NAT fairness, latency and cost before adjusting retrieval thresholds or rate limits.
- Test email recovery and add a self-service recovery flow before onboarding more staff. Until then the project owner handles recovery through Supabase Auth.
- Consider PDF/OCR support only with bounded extraction and a review process. Current uploads support DOCX, TXT and Markdown; original files are not retained.
- Keep automatic website indexing disabled unless permission and review ownership are established. Chat never fetches arbitrary live web content.
- Exercise restore and concurrent reviewer/importer scenarios in staging. Keep additive tables on application rollback; do not restore obsolete unreviewed answers.

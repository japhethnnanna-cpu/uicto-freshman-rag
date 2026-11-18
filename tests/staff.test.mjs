import test from "node:test";
import assert from "node:assert/strict";
import { smallTalk, redact } from "../lib/conversation.mjs";
import { extractDocument, MAX_UPLOAD } from "../lib/documents.mjs";
import { reviewInput, pendingInput } from "../lib/review.mjs";
import { handleChat } from "../lib/chat.mjs";

test("greetings need no model but never swallow questions with a greeting prefix", async () => {
  for (const text of ["Hi!", "hey", "Hello there", "good morning", "yoo", "Thanks", "Who are you?"]) assert.ok(smallTalk(text));
  for (const text of ["Hi, what are fees?", "hello give me the WiFi password", "What is a greeting?"]) assert.equal(smallTalk(text), null);
  const events = [];
  const response = await handleChat(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "hey" }) }), {
    allow: async () => true, embed: () => assert.fail("Greeting reached AI"), record: event => events.push(event),
  });
  assert.equal((await response.json()).outcome, "greeting");
  assert.match(events[0].answer, /Hello/);
});
test("tracking removes common emails, IDs, phones and credentials while retaining session context", () => {
  const clean = redact("2026/2027 fees: email student@example.com phone +234 801 234 5678 ID ICT/2026/1234 password: private123");
  assert.match(clean, /2026\/2027 fees/);
  for (const secret of ["student@example.com", "801 234", "ICT/2026", "private123"]) assert.ok(!clean.includes(secret));
});
test("document extraction accepts text and bounded DOCX without rendering or following links", async () => {
  const zipped = Buffer.from("UEsDBBQAAAAIAF0IcF1UZi6KfgAAAMEAAAARAAAAd29yZC9kb2N1bWVudC54bWxtjrEOAiEQRH9lc4Wl9Ij8hIk9wh6SyEL2Frn7+wuXGC1s3jQzL2O6DsW3jCSw5hctul+nxqT7ZE3XjxK2kXWAB8TekdOcMECj9EZekmwQWwqOPMJcGAQXSRTPRo36IB88JL+mG/pCAapjF9nVJ5xcrhcQXOXfWH3+qO9puwNQSwECFAAUAAAACABdCHBdVGYuin4AAADBAAAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAEAAQA/AAAArQAAAAAA", "base64");
  assert.equal(await extractDocument(zipped, "guide.docx"), "Verified university guidance for testing.\nSecond paragraph & text.");
  assert.equal(await extractDocument(Buffer.from("Authoritative guidance supplied by staff."), "guide.txt"), "Authoritative guidance supplied by staff.");
  for (const [buffer, name] of [[zipped, "payload.exe"], [Buffer.alloc(MAX_UPLOAD+1), "large.txt"], [Buffer.from("not a zip"), "fake.docx"], [Buffer.from([0,1,2]), "binary.txt"]]) await assert.rejects(extractDocument(buffer, name));
});
test("staff publication requires explicit review, matching session and bounded expiry", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const body = { question: "Where is the library?", answer: "Refer to the signed campus guide.", category: "Library", claim_key: "library-location", expires_on: "2026-12-01", confirmed: true };
  assert.equal(reviewInput(body, now).academic_session, null);
  for (const changes of [{ confirmed:false }, {expires_on:"2027-12-01"}, {expires_on:"2026-02-30"}, {question:"What are the fees?"}, {academic_session:"2026/2027", answer:"2025/26 tuition was 123."}, {claim_key:"unsafe<script>"}]) assert.throws(() => reviewInput({...body,...changes},now));
});

test("pending edits may remain unfinished but approval requires authoritative evidence", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const draft = { question:"Where is the library?", category:"Library", answer:"", claim_key:"" };
  assert.equal(pendingInput(draft,false,now).answer, "");
  assert.throws(()=>pendingInput(draft,true,now));
  const complete={...draft,answer:"See the university contact page for guidance.",claim_key:"library-location",expires_on:"2026-12-01",confirmed:true};
  for(const source of ["","https://example.com/fiction","javascript:alert(1)"]) assert.throws(()=>pendingInput({...complete,source},true,now),/source URL/);
  assert.equal(pendingInput({...complete,source:"https://uicto.edu.ng/contact"},true,now).source,"https://uicto.edu.ng/contact");
  assert.equal(pendingInput({...complete,staff_document_id:"00000000-0000-4000-8000-000000000001"},true,now).staff_document_id,"00000000-0000-4000-8000-000000000001");
  assert.throws(()=>pendingInput({...complete,staff_document_id:"bad-id"},true,now));
});

// Change only the answer so another invalid field cannot mask a missing guard.
test("approval rejects empty and unresolved answers but drafts retain them", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const valid = { question:"Where is the library?", answer:"See the signed campus guide.", category:"Library", claim_key:"library-location", academic_session:"2026/2027", expires_on:"2026-12-01", confirmed:true, source:"https://uicto.edu.ng/contact" };
  assert.equal(pendingInput(valid,true,now).answer,valid.answer);
  for (const answer of ["", "   ", "not available in the reviewed sources", "Not verified.", "Awaiting staff confirmation", "To be confirmed", "TBD", "N/A"]) {
    assert.throws(()=>pendingInput({...valid,answer},true,now),/answer|unresolved/i);
    assert.throws(()=>reviewInput({...valid,answer},now),/answer|unresolved/i);
    assert.equal(pendingInput({...valid,answer},false,now).answer,answer.trim());
  }
  assert.equal(reviewInput({...valid,answer:"School-fee payment is not available."},now).answer,"School-fee payment is not available.");
});

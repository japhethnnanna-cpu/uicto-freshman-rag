import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { POST } = createRequire(import.meta.url)("../app/api/chat/route.js");

test("production POST composes quota, 768-dimensional embedding, scoped RPC and grounded Gemini selection", async t => {
  // This test process owns its environment. No dotenv is loaded and every network call is intercepted.
  Object.assign(process.env, {
    SUPABASE_URL: "https://staging.invalid", SUPABASE_SECRET_KEY: "fixture",
    GEMINI_API_KEY: "fixture", NVIDIA_API_KEY: "fixture", RATE_LIMIT_SECRET: "x".repeat(32),
    UICTO_ACADEMIC_SESSION: "2026/2027", ANSWER_PROVIDER: "gemini",
  });
  const calls = [], events = [];
  const vector = Array.from({length:768}, (_,i) => i === 0 ? 1 : 0);
  t.mock.method(console, "info", value => events.push(JSON.parse(value)));
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = JSON.parse(init?.body ?? await input.text());
    calls.push(url.pathname);
    if (url.hostname === "staging.invalid" && url.pathname.endsWith("/consume_chat_quota")) {
      assert.match(body.client_key, /^[0-9a-f]{64}$/);
      return Response.json(true);
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      if (url.pathname.includes("generateContent")) {
        assert.ok(url.pathname.includes("gemini-3.5-flash-lite"));
        assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
        assert.match(JSON.stringify(body.systemInstruction), /Do not write an answer/);
        return Response.json({ candidates: [{ content: { parts: [{ text: "1" }] } }] });
      }
      assert.ok(url.pathname.includes("gemini-embedding-2"));
      return Response.json({ embeddings:[{values:vector}], embedding:{values:vector} });
    }
    if (url.hostname === "staging.invalid" && url.pathname.endsWith("/match_reviewed_knowledge")) {
      assert.deepEqual(body.query_embedding,vector);
      assert.equal(body.target_session,"2026/2027");
      assert.equal(body.specific,true);
      return Response.json([{ title:"Current procedure",answer:"School-fee payment was unavailable in this fixture.",
        category:"fees", academic_session:"2026/2027",published_on:null,reviewed_on:"2026-11-03",origin:"official",
        url:"https://www.uicto.edu.ng/admission/procedure",conflict:false }]);
    }
    if (url.hostname === "integrate.api.nvidia.com") {
      assert.equal(body.messages[0].role,"system");
      return Response.json({choices:[{message:{content:"1"}}]});
    }
    throw Error("Unexpected outbound request");
  });
  const res = await POST(new Request("http://localhost/api/chat",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({question:"Is school-fee payment open for 2026/2027?"})}));
  const body = await res.json();
  assert.equal(res.status,200,JSON.stringify({calls,events}));
  assert.equal(body.outcome,"supported_excerpt");
  assert.equal(body.sources[0].session,"2026/2027");
  assert.equal(calls.length,4);
  assert.ok(!JSON.stringify(events).includes("Is school-fee"));
});

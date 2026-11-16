import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";

test("migration and retrieval against disposable PostgreSQL with pgvector", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create schema extensions; create extension vector with schema extensions;
    set search_path=public,extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema extensions to service_role;
    create function public.rls_auto_enable() returns event_trigger language plpgsql security definer
    set search_path=pg_catalog as $$ begin return; end $$;
    create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
    create table school_knowledge(id bigserial, external_id text,category text,question text,answer text,
    source text,last_updated date,embedding vector(768));
    alter table school_knowledge enable row level security;
    grant select,insert,update on public.school_knowledge to service_role;
    create function match_school_knowledge(vector,float,int) returns int language sql as $$ select 0 $$;
    insert into school_knowledge(external_id,answer) values ('existing','keep me');`);
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20261114120130_reviewed_knowledge.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(await readFile(new URL("../supabase/migrations/20261116000631_staff_dashboard.sql", import.meta.url), "utf8"));
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const v = JSON.stringify(
    Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
  );
  const match = (session, specific = true) =>
    rows("select * from match_reviewed_knowledge($1,$2,$3)", [
      v,
      session,
      specific,
    ]);
  const base = {
    canonical_url: "https://www.uicto.edu.ng/admission/procedure",
    original_url: "https://www.uicto.edu.ng/admission/procedure",
    category: "registration",
    claim_key: "fee-payment",
    title: "Registration procedure",
    academic_session: "2026/2027",
    content_hash: "revision1",
    source_type: "authorized_manual",
    permission_reference: "synthetic fixture",
  };
  async function stage(doc, answers, old = null) {
    return (
      await rows("select stage_official($1,$2,$3) id", [
        JSON.stringify(doc),
        JSON.stringify(answers),
        old,
      ])
    )[0].id;
  }
  async function approve(id, hash, n = 1) {
    await rows("select approve_official($1,$2,current_date+7,$3)", [
      id,
      hash,
      JSON.stringify(Array(n).fill(JSON.parse(v))),
    ]);
  }
  await t.test(
    "preserves legacy rows, denies public access and retains DDL trigger",
    async () => {
      assert.deepEqual(
        await rows("select answer,review_status from school_knowledge"),
        [{ answer: "keep me", review_status: "pending" }],
      );
      for (const role of ["anon", "authenticated"]) {
        for (const { allowed } of await rows(
          "select has_function_privilege($1,oid,'execute') as allowed from pg_proc where pronamespace='public'::regnamespace and proname in ('consume_chat_quota','stage_official','approve_official','match_reviewed_knowledge','match_school_knowledge','rls_auto_enable')",
          [role],
        ))
          assert.equal(allowed, false);
        assert.equal(
          (
            await rows(
              "select has_table_privilege($1,'official_chunks','select') as allowed",
              [role],
            )
          )[0].allowed,
          false,
        );
      }
      assert.deepEqual(
        await rows(
          "select evtenabled from pg_event_trigger where evtname='ensure_rls'",
        ),
        [{ evtenabled: "O" }],
      );
      await db.exec("create table trigger_smoke(id int)");
    },
  );
  await db.exec("set role service_role");
  await t.test("staff tables deny students; publication and withdrawal are atomic and audited", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["staff_documents", "chat_events", "staff_audit"])
        assert.equal((await rows("select has_table_privilege($1,$2,'select') ok", [role,table]))[0].ok, false);
      for (const { ok } of await rows("select has_function_privilege($1,oid,'execute') ok from pg_proc where pronamespace='public'::regnamespace and proname in ('publish_staff_answer','withdraw_staff_answer','staff_chat_summary')", [role])) assert.equal(ok, false);
    }
    const reviewer = "00000000-0000-4000-8000-000000000001";
    const [{ id }] = await rows("insert into staff_documents(uploaded_by,title,filename,provenance,content_hash,content) values($1,'Synthetic fixture','test.txt','Test only','hash','Verified synthetic school guidance only.') returning id", [reviewer]);
    const expires = (await rows("select (current_date+7)::text expires"))[0].expires;
    const item = { question:"Where is the fixture building?",answer:"Synthetic fixture building.",category:"test",claim_key:"test-building",academic_session:"2026/2027",expires_on:expires };
    const [{ answer_id }] = await rows("select publish_staff_answer($1,$2,$3,$4) answer_id", [id,reviewer,JSON.stringify(item),v]);
    assert.equal((await rows("select review_status from staff_documents where id=$1",[id]))[0].review_status, "reviewed");
    assert.equal((await rows("select review_status from school_knowledge where id=$1",[answer_id]))[0].review_status, "approved");
    assert.ok((await match("2026/2027")).some(r=>r.answer===item.answer));
    await rows("select withdraw_staff_answer($1,$2)",[answer_id,reviewer]);
    assert.ok(!(await match("2026/2027")).some(r=>r.answer===item.answer));
    assert.deepEqual((await rows("select action from staff_audit where knowledge_id=$1 order by id",[answer_id])).map(r=>r.action), ["publish","withdraw"]);
    await assert.rejects(rows("select publish_staff_answer($1,$2,$3,$4)",[id,reviewer,JSON.stringify({...item,expires_on:"2000-01-01"}),v]), /Invalid or stale/);
  });
  await t.test(
    "persistent quota stops ninth call and separate clients have separate buckets",
    async () => {
      for (let i = 0; i < 9; i++)
        assert.equal(
          (await rows("select consume_chat_quota($1) ok", ["a".repeat(64)]))[0]
            .ok,
          i < 8,
        );
      assert.equal(
        (await rows("select consume_chat_quota($1) ok", ["b".repeat(64)]))[0]
          .ok,
        true,
      );
    },
  );
  await t.test(
    "approval, session, freshness, conflict, historical retention and idempotency",
    async () => {
      const answers = [
        "School-fee payment was unavailable when this procedure was issued.",
        "Acceptance-fee payment has separate instructions.",
      ];
      const id = await stage(base, answers);
      assert.deepEqual(await match("2026/2027"), []);
      await approve(id, base.content_hash, 2);
      assert.equal(await stage(base, answers, id), id);
      await assert.rejects(stage(base, answers), /retry sync/);
      const current = await match("2026/2027");
      assert.equal(current.length, 2);
      assert.equal(current[0].published_on, null);
      assert.ok(current.every((r) => !r.conflict));
      assert.deepEqual(await match("2025/2026"), []);
      const old = {
        ...base,
        canonical_url: "https://www.uicto.edu.ng/assets/pdf/fee-structure.pdf",
        academic_session: "2025/2026",
        content_hash: "historical",
      };
      const oldId = await stage(old, ["Historical fee: 100 fixture units."]);
      await approve(oldId, old.content_hash);
      assert.ok(
        (await match("2026/2027")).every((r) => !r.answer.includes("100")),
      );
      assert.equal((await match("2025/2026"))[0].url, old.canonical_url);
      await rows(
        `update school_knowledge set claim_key='fee-payment', reviewed_on=current_date,expires_on=current_date+3,
      academic_session='2026/2027',review_status='approved', embedding=$1 where external_id='existing'`,
        [v],
      );
      assert.ok((await match("2026/2027")).every((r) => r.conflict));
      await db.exec("update school_knowledge set expires_on=current_date-1");
      const nextId = await stage(
        { ...base, content_hash: "revision2" },
        ["New guidance"],
        id,
      );
      assert.deepEqual(await match("2026/2027"), []);
      await assert.rejects(approve(id, base.content_hash, 2), /stale/);
      await approve(nextId, "revision2");
      await rows(
        "update official_documents set extraction_status='removed' where id=$1",
        [nextId],
      );
      assert.deepEqual(await match("2026/2027"), []);
      assert.equal(
        (
          await rows(
            "select count(*)::int n from official_chunks where document_id=$1",
            [id],
          )
        )[0].n,
        2,
      );
    },
  );
  await t.test(
    "admission announcements are scoped before top-k and unknown dates never imply publication today",
    async () => {
      for (const session of ["2025/2026", "2026/2027"]) {
        const doc = {
          ...base,
          canonical_url: base.canonical_url.replace(
            "admission/procedure",
            "news/admissions-" + session.slice(0, 4),
          ),
          academic_session: session,
          claim_key: "admission-status",
        };
        const id = await stage(doc, [session + " admission notice"]);
        await approve(id, doc.content_hash);
      }
      assert.deepEqual(
        (await match("2026/2027")).map((r) => r.answer),
        ["2026/2027 admission notice"],
      );
      assert.deepEqual(await match(null), []);
    },
  );
});

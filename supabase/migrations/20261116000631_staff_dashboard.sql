begin;
set local search_path = pg_catalog, public, extensions;
create table public.chat_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  question text not null check (length(question) <= 800),
  answer text check (length(answer) <= 6000),
  outcome text not null, category text, latency_ms integer not null
);
create index chat_events_recent on public.chat_events(created_at desc, id desc);
create index chat_events_outcome on public.chat_events(outcome, created_at desc);
create table public.staff_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  uploaded_by uuid not null,
  title text not null check (length(title) between 1 and 200),
  filename text not null check (length(filename) between 1 and 200),
  provenance text not null check (length(provenance) between 1 and 1000),
  content_hash text not null,
  content text not null check (length(content) between 20 and 60000),
  review_status text not null default 'pending' check (review_status in ('pending','reviewed','rejected'))
);
create index staff_documents_recent on public.staff_documents(created_at desc);
alter table public.school_knowledge add column staff_document_id uuid references public.staff_documents(id), add column reviewed_by uuid;
create index school_knowledge_staff_document on public.school_knowledge(staff_document_id);
create table public.staff_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(), actor uuid not null,
  action text not null, knowledge_id bigint, document_id uuid
);
create index staff_audit_recent on public.staff_audit(created_at desc);
alter table public.chat_events enable row level security;
alter table public.staff_documents enable row level security;
alter table public.staff_audit enable row level security;
revoke all on public.chat_events, public.staff_documents, public.staff_audit from public, anon, authenticated;
grant select,insert on public.chat_events, public.staff_audit to service_role;
grant select,insert,update on public.staff_documents to service_role;
revoke all on sequence public.chat_events_id_seq, public.staff_audit_id_seq from public, anon, authenticated;
grant usage,select on sequence public.chat_events_id_seq, public.staff_audit_id_seq, public.school_knowledge_id_seq to service_role;

create function public.publish_staff_answer(document_id uuid, reviewer uuid, item jsonb, embedding extensions.vector(768))
returns bigint language plpgsql security invoker set search_path = pg_catalog, public, extensions as $$
declare d public.staff_documents; new_id bigint;
begin
  select * into strict d from public.staff_documents where id = document_id for update;
  if d.review_status = 'rejected' or reviewer is null or embedding is null or
    (item->>'expires_on')::date not between current_date and current_date + 90 or
    item->>'expires_on' is null or length(item->>'question') not between 1 and 800 or
    length(item->>'answer') not between 1 and 6000 or item->>'claim_key' is null
    then raise exception 'Invalid or stale review'; end if;
  insert into public.school_knowledge(external_id,question,answer,category,source,last_updated,
    embedding,review_status,reviewed_on,expires_on,academic_session,claim_key,staff_document_id,reviewed_by)
  values ('STAFF-' || gen_random_uuid(),item->>'question',item->>'answer',item->>'category',
    'Staff document: ' || d.title,current_date,embedding,'approved',current_date,
    (item->>'expires_on')::date,item->>'academic_session',item->>'claim_key',d.id,reviewer)
  returning id into new_id;
  update public.staff_documents set review_status='reviewed' where id=d.id;
  insert into public.staff_audit(actor,action,knowledge_id,document_id) values(reviewer,'publish',new_id,d.id);
  return new_id;
end $$;
create function public.withdraw_staff_answer(knowledge_id bigint, reviewer uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare doc_id uuid;
begin
  if reviewer is null then raise exception 'Reviewer required'; end if;
  update public.school_knowledge set review_status='pending',embedding=null,reviewed_by=reviewer
    where id=knowledge_id returning staff_document_id into doc_id;
  if not found then raise exception 'Answer not found'; end if;
  insert into public.staff_audit(actor,action,knowledge_id,document_id) values(reviewer,'withdraw',knowledge_id,doc_id);
end $$;
create function public.staff_chat_summary(since timestamptz)
returns table(outcome text, count bigint)
language sql stable security invoker set search_path=pg_catalog as $$
  select outcome,count(*) from public.chat_events where created_at >= since group by outcome;
$$;
revoke all on function public.publish_staff_answer(uuid,uuid,jsonb,extensions.vector), public.withdraw_staff_answer(bigint,uuid), public.staff_chat_summary(timestamptz) from public,anon,authenticated;
grant execute on function public.publish_staff_answer(uuid,uuid,jsonb,extensions.vector), public.withdraw_staff_answer(bigint,uuid), public.staff_chat_summary(timestamptz) to service_role;
-- Preserve the old RPC for compatibility, with a fixed function search path.
do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname='match_school_knowledge' loop
    execute format('alter function %s set search_path=pg_catalog,public,extensions',f);
  end loop;
end $$;
create or replace function public.match_reviewed_knowledge(query_embedding vector(768), target_session text, specific boolean)
returns table(title text, answer text, category text, url text, published_on date, reviewed_on date,
  academic_session text, origin text, claim_key text, similarity double precision, conflict boolean)
language sql stable security invoker set search_path = pg_catalog, public, extensions as $$
  with eligible as materialized (
    select d.title, c.answer, d.category, d.canonical_url url, d.published_on, d.reviewed_on, d.academic_session,
      'official'::text origin, d.claim_key, c.embedding, 'doc-' || d.id as source_id
    from public.official_documents d join public.official_chunks c on c.document_id = d.id
    where d.review_status = 'approved' and d.extraction_status = 'ok' and d.superseded_by is null
      and current_date between d.reviewed_on and d.expires_on and (d.published_on is null or d.published_on <= current_date)
    union all
    select k.question::text, k.answer::text, k.category::text, k.source::text, null::date, k.reviewed_on, k.academic_session,
      'internal', k.claim_key, k.embedding, 'internal-' || k.external_id
    from public.school_knowledge k where k.review_status = 'approved' and k.claim_key is not null
      and current_date between k.reviewed_on and k.expires_on
  ), scoped as (
    select * from eligible e where (e.academic_session = target_session or (not specific and e.academic_session is null))
  ), candidates as (
    select s.*, 1 - (s.embedding <=> query_embedding) score from scoped s where s.embedding is not null
    order by s.embedding <=> query_embedding limit 8
  )
  select c.title,c.answer,c.category,c.url,c.published_on,c.reviewed_on,c.academic_session,c.origin,c.claim_key,c.score,
    exists(select 1 from scoped p where p.claim_key = c.claim_key and p.source_id <> c.source_id and p.answer <> c.answer)
  from candidates c where c.score > 0.75 order by c.score desc, c.reviewed_on desc
$$;


commit;

-- Preconditions: inspect database/preflight.sql. Never run against production automatically.
begin;
set local search_path = pg_catalog, public, extensions;
-- A duplicate external_id intentionally fails the migration instead of merging student data.
create unique index if not exists school_knowledge_import_id on public.school_knowledge(external_id);
alter table public.school_knowledge
  add column review_status text not null default 'pending' check (review_status in ('pending','approved')),
  add column reviewed_on date,
  add column expires_on date,
  add column academic_session text,
  add column claim_key text;

create table public.official_documents (
  id bigint generated always as identity primary key,
  canonical_url text not null,
  original_url text not null,
  title text not null,
  source_type text not null check (source_type in ('authorized_manual','official_html')),
  permission_reference text not null,
  published_on date, -- NULL means unknown. Never substitute fetch time.
  last_fetched_at timestamptz not null,
  academic_session text,
  category text not null,
  claim_key text not null,
  content_hash text not null,
  extraction_status text not null check (extraction_status in ('ok','unavailable','removed')),
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  reviewed_on date,
  expires_on date,
  superseded_by bigint references public.official_documents(id),
  constraint valid_session check (academic_session is null or academic_session ~ '^20[0-9]{2}/20[0-9]{2}$')
);
create index official_doc_url on public.official_documents(canonical_url, id desc);
create table public.official_chunks (
  document_id bigint not null references public.official_documents(id),
  ordinal int not null,
  answer text not null,
  embedding vector(768),
  primary key(document_id, ordinal)
);
create table public.chat_quota (
  bucket timestamptz not null, client_key text not null, hits int not null,
  primary key(bucket, client_key)
);
alter table public.chat_quota enable row level security;
alter table public.official_documents enable row level security;
alter table public.official_chunks enable row level security;
revoke all on public.chat_quota, public.official_documents, public.official_chunks from public, anon, authenticated;
grant select,insert,update,delete on public.chat_quota to service_role;
grant select,insert,update on public.official_documents, public.official_chunks to service_role;
grant usage,select on sequence public.official_documents_id_seq to service_role;
revoke all on sequence public.official_documents_id_seq from public, anon, authenticated;

create function public.consume_chat_quota(client_key text) returns boolean
language plpgsql security invoker set search_path = pg_catalog as $$
declare window_start timestamptz := date_trunc('minute', now()); n int;
begin
  if client_key !~ '^[0-9a-f]{64}$' or client_key is null then return false; end if;
  delete from public.chat_quota where bucket < window_start - interval '1 minute';
  insert into public.chat_quota values(window_start, client_key, 1)
  on conflict on constraint chat_quota_pkey do update set hits = public.chat_quota.hits + 1
  where public.chat_quota.hits < 8 returning hits into n;
  return n is not null;
end $$;

-- The CLI reads the current version before fetching. Reject stale concurrent writers.
create function public.stage_official(doc jsonb, parts jsonb, expected_id bigint)
returns bigint language plpgsql security invoker set search_path = pg_catalog as $$
declare prior public.official_documents; new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(doc->>'canonical_url', 0));
  select * into prior from public.official_documents where canonical_url = doc->>'canonical_url'
    and superseded_by is null order by id desc limit 1 for update;
  if prior.id is distinct from expected_id then raise exception 'Source changed; retry sync'; end if;
  if prior.content_hash = doc->>'content_hash' and prior.extraction_status = 'ok' then
    update public.official_documents set last_fetched_at = now() where id = prior.id;
    return prior.id;
  end if;
  insert into public.official_documents(canonical_url,original_url,title,source_type,permission_reference,
    published_on,last_fetched_at,academic_session,category,claim_key,content_hash,extraction_status)
  values(doc->>'canonical_url',doc->>'original_url',doc->>'title',doc->>'source_type',doc->>'permission_reference',
    (doc->>'published_on')::date,now(),doc->>'academic_session',doc->>'category',doc->>'claim_key',doc->>'content_hash','ok')
  returning id into new_id;
  update public.official_documents set superseded_by = new_id where id = prior.id;
  -- Embedding input is title plus paragraph. Carry forward exact matches only.
  insert into public.official_chunks(document_id,ordinal,answer,embedding)
    select new_id, n, value, (select c.embedding from public.official_chunks c
      where c.document_id = prior.id and prior.title = doc->>'title' and c.answer = p.value
      and c.embedding is not null limit 1)
    from jsonb_array_elements_text(parts) with ordinality as p(value,n);
  return new_id;
end $$;

create function public.approve_official(version_id bigint, digest text, valid_until date, vectors jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog, public, extensions as $$
declare d public.official_documents; n int;
begin
  select * into strict d from public.official_documents where id = version_id for update;
  if d.content_hash is distinct from digest or d.superseded_by is not null or d.extraction_status <> 'ok'
     or valid_until is null or valid_until < current_date or valid_until > current_date + 90 then
    raise exception 'Review is stale or expiry outside review window';
  end if;
  select count(*) into n from public.official_chunks where document_id = version_id;
  if n = 0 or jsonb_array_length(vectors) is distinct from n then raise exception 'Incomplete vectors'; end if;
  update public.official_chunks c set embedding = (v.value::text)::vector(768)
    from jsonb_array_elements(vectors) with ordinality v(value, ord) where c.document_id = version_id and c.ordinal = v.ord;
  update public.official_documents set review_status = 'approved', reviewed_on = current_date, expires_on = valid_until where id = version_id;
end $$;

create function public.match_reviewed_knowledge(query_embedding vector(768), target_session text, specific boolean)
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
    select k.question::text, k.answer::text, k.category::text, null::text, null::date, k.reviewed_on, k.academic_session,
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

-- This administrative function runs via ensure_rls. No Data API role needs direct EXECUTE.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
  end if;
end $$;
do $$ declare f regprocedure;
begin
  for f in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('consume_chat_quota','stage_official','approve_official','match_reviewed_knowledge','match_school_knowledge') loop
    execute format('revoke all on function %s from public, anon, authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;

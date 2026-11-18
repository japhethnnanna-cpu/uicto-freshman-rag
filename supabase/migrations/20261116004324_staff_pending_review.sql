begin;
alter table public.school_knowledge add column review_version integer not null default 0;
alter table public.staff_audit add column before_record jsonb, add column after_record jsonb;
create function public.bump_knowledge_review_version() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin new.review_version := old.review_version + 1; return new; end $$;
create trigger knowledge_review_version before update on public.school_knowledge
for each row execute function public.bump_knowledge_review_version();
revoke all on function public.bump_knowledge_review_version() from public,anon,authenticated;

create function public.review_pending_answer(knowledge_id bigint, expected_version integer,
  reviewer uuid, item jsonb, approve boolean, answer_embedding extensions.vector(768))
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare prior public.school_knowledge; updated public.school_knowledge;
  doc public.staff_documents; doc_id uuid; source_text text;
begin
  select * into strict prior from public.school_knowledge where id=knowledge_id for update;
  if expected_version is distinct from prior.review_version or prior.review_status <> 'pending' then
    raise exception 'Record changed; reload before reviewing' using errcode='40001';
  end if;
  if reviewer is null or approve is null or coalesce(length(item->>'question'),0) not between 1 and 800
    or coalesce(length(item->>'category'),0) not between 1 and 80 or coalesce(length(item->>'answer'),0)>6000 then
    raise exception 'Invalid draft';
  end if;
  doc_id := nullif(item->>'staff_document_id','')::uuid;
  source_text := nullif(item->>'source','');
  if doc_id is not null then
    select * into strict doc from public.staff_documents where id=doc_id for share;
    if doc.review_status='rejected' then raise exception 'Document unavailable'; end if;
    source_text := 'Staff document: ' || doc.title;
  end if;
  if approve and (answer_embedding is null or coalesce(length(item->>'answer'),0)=0
    or coalesce(length(item->>'claim_key'),0)=0 or source_text is null
    or item->>'expires_on' is null or (item->>'expires_on')::date not between current_date and current_date+90) then
    raise exception 'Verified answer, source and current review required';
  end if;
  update public.school_knowledge set question=item->>'question', answer=coalesce(item->>'answer',''),
    category=item->>'category', source=source_text, staff_document_id=doc_id,
    academic_session=nullif(item->>'academic_session',''), claim_key=nullif(item->>'claim_key',''),
    review_status=case when approve then 'approved' else 'pending' end,
    reviewed_on=case when approve then current_date else null end,
    expires_on=case when approve then (item->>'expires_on')::date else null end,
    embedding=case when approve then answer_embedding else null end,
    reviewed_by=reviewer, last_updated=current_date
    where id=knowledge_id returning * into updated;
  if approve and doc_id is not null then update public.staff_documents set review_status='reviewed' where id=doc_id; end if;
  insert into public.staff_audit(actor,action,knowledge_id,document_id,before_record,after_record)
    values(reviewer,case when approve then 'approve_pending' else 'edit_pending' end,knowledge_id,doc_id,
      to_jsonb(prior)-'embedding',to_jsonb(updated)-'embedding');
  return updated.review_version;
end $$;
revoke all on function public.review_pending_answer(bigint,integer,uuid,jsonb,boolean,extensions.vector) from public,anon,authenticated;
grant execute on function public.review_pending_answer(bigint,integer,uuid,jsonb,boolean,extensions.vector) to service_role;
commit;

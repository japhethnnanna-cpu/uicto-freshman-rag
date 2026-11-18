begin;
-- Apply the same publication invariants to API and direct service-role RPC calls.
-- This validates manually reviewed references; it does not fetch these URLs.
create function public.validate_staff_answer(item jsonb, document_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare field text; max_length integer; value text; session_text text; content_text text; matched text[];
begin
  for field,max_length in select * from (values ('question',800),('answer',6000),('category',80),('claim_key',120)) as limits(name,size) loop
    value := item->>field;
    if jsonb_typeof(item->field) is distinct from 'string' or value !~ '\S' or length(value)>max_length
      or value ~ '[\x01-\x08\x0e-\x1f]' then
      raise exception 'Invalid or stale review: invalid %',field;
    end if;
  end loop;
  if item->>'claim_key' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid claim key'; end if;
  if normalize(item->>'answer',NFKC) ~* 'not\s+verified|not\s+confirmed|not\s+available\s+in\s+the\s+reviewed\s+sources|(awaiting|pending|requires?)\s+(staff\s+)?(confirmation|verification)|to\s+be\s+confirmed|^\s*(tbd|todo|n/?a)\s*[.!]?\s*$' then
    raise exception 'Unresolved answer must stay pending';
  end if;
  session_text := nullif(item->>'academic_session','');
  if session_text is not null then
    if session_text !~ '^20[0-9]{2}/20[0-9]{2}$' then raise exception 'Invalid academic session'; end if;
    if right(session_text,4)::integer <> left(session_text,4)::integer+1 then raise exception 'Invalid academic session'; end if;
  end if;
  content_text := (item->>'question') || ' ' || (item->>'answer');
  for matched in select regexp_matches(content_text,'\m(20[0-9]{2})\s*[/-]\s*(20[0-9]{2}|[0-9]{2})\M(?![-/][0-9])','g') loop
    if (matched[1] || '/' || case when length(matched[2])=2 then '20' || matched[2] else matched[2] end) is distinct from session_text then
      raise exception 'Academic session mismatch';
    end if;
  end loop;
  if session_text is null and content_text ~* '\m(fees?|costs?|pay\w*|tuition|levy|charges?|amount|admi\w*|utme|jamb|screening|regist\w*|enrol\w*|deadlines?|dates?|schedules?|calendar|resum\w*|current|latest|this year|cut.?off|applications?|20[0-9]{2}|last (year|session)|next (year|session))\M' then
    raise exception 'Academic session required';
  end if;
  if coalesce(item->>'expires_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid or stale review'; end if;
  if (item->>'expires_on')::date not between current_date and current_date+90 then raise exception 'Invalid or stale review'; end if;
  if document_id is null and coalesce(item->>'source','') !~ '^https://((www\.)?uicto\.edu\.ng/($|(about|contact|undergraduate/programs|student/portal/login|(admission|post-utme)/(procedure|correction)|portal/(ug/admission/status|result/postutme)/check)/?$|assets/pdf/[a-z0-9-]+\.pdf$|news/[a-z0-9-]+/?$)|nelf\.gov\.ng/faq/?$|www\.nuc\.edu\.ng/nigerian-univerisities/state-univerisity/?$)' then
    raise exception 'Supported official source or staff document required';
  end if;
end $$;
revoke all on function public.validate_staff_answer(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.validate_staff_answer(jsonb,uuid) to service_role;

create or replace function public.review_pending_answer(knowledge_id bigint, expected_version integer,
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
    select * into strict doc from public.staff_documents where id=doc_id for update;
    if doc.review_status='rejected' then raise exception 'Document unavailable'; end if;
    source_text := 'Staff document: ' || doc.title;
  end if;
  if approve and (answer_embedding is null or coalesce(length(item->>'answer'),0)=0
    or coalesce(length(item->>'claim_key'),0)=0 or source_text is null
    or item->>'expires_on' is null or (item->>'expires_on')::date not between current_date and current_date+90) then
    raise exception 'Verified answer, source and current review required';
  end if;
  if approve then perform public.validate_staff_answer(item,doc_id); end if;
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

create or replace function public.publish_staff_answer(document_id uuid, reviewer uuid, item jsonb, embedding extensions.vector(768))
returns bigint language plpgsql security invoker set search_path = pg_catalog, public, extensions as $$
declare d public.staff_documents; new_id bigint;
begin
  select * into strict d from public.staff_documents where id = document_id for update;
  if d.review_status = 'rejected' or reviewer is null or embedding is null or
    (item->>'expires_on')::date not between current_date and current_date + 90 or
    item->>'expires_on' is null or length(item->>'question') not between 1 and 800 or
    length(item->>'answer') not between 1 and 6000 or item->>'claim_key' is null
    then raise exception 'Invalid or stale review'; end if;
  perform public.validate_staff_answer(item,document_id);
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

-- Old callers must reload and supply a version; never allow an unguarded withdrawal.
drop function public.withdraw_staff_answer(bigint,uuid);
create function public.withdraw_staff_answer(knowledge_id bigint, reviewer uuid, expected_version integer)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare prior public.school_knowledge; updated public.school_knowledge;
begin
  if reviewer is null then raise exception 'Reviewer required'; end if;
  select * into strict prior from public.school_knowledge where id=knowledge_id for update;
  if expected_version is distinct from prior.review_version or prior.review_status <> 'approved' then
    raise exception 'Record changed; reload before withdrawing' using errcode='40001';
  end if;
  update public.school_knowledge set review_status='pending',embedding=null,reviewed_by=reviewer,
    reviewed_on=null,expires_on=null
    where id=knowledge_id returning * into updated;
  insert into public.staff_audit(actor,action,knowledge_id,document_id,before_record,after_record)
    values(reviewer,'withdraw',knowledge_id,prior.staff_document_id,to_jsonb(prior)-'embedding',to_jsonb(updated)-'embedding');
end $$;
revoke all on function public.withdraw_staff_answer(bigint,uuid,integer) from public,anon,authenticated;
grant execute on function public.withdraw_staff_answer(bigint,uuid,integer) to service_role;
commit;

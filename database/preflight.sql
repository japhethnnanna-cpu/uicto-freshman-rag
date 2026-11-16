-- Read-only inventory. Inspect locally or in an authorized staging database.
select extname, extnamespace::regnamespace from pg_extension where extname='vector';
select column_name, udt_name from information_schema.columns where table_schema='public' and table_name='school_knowledge';
select external_id, count(*) from public.school_knowledge group by external_id having count(*) > 1;
select p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  pg_get_functiondef(p.oid)
from pg_proc p where pronamespace='public'::regnamespace and prokind='f' and
 (prosecdef or proname like '%admin%' or proname like 'match%');
select evtname, evtfoid::regprocedure, evtenabled from pg_event_trigger;
select tablename, policyname, roles, qual, with_check from pg_policies where schemaname='public';

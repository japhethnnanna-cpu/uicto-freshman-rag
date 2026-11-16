-- Administrator-only operational report. No student text or identifiers.
select d.id, d.title, d.canonical_url, d.academic_session, d.review_status, d.extraction_status,
       d.last_fetched_at, d.published_on, d.reviewed_on, d.expires_on,
       case when d.extraction_status <> 'ok' then 'unavailable'
            when d.review_status <> 'approved' then 'needs review'
            when d.expires_on < current_date then 'expired'
            when d.expires_on <= current_date + 7 then 'review this week'
            else 'within review window' end as freshness
from public.official_documents d where superseded_by is null
order by expires_on nulls first, last_fetched_at;
select review_status, count(*) from public.school_knowledge group by review_status;

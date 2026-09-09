alter table public.master_corpus_candidates
  add column if not exists transient_requeues integer not null default 0;

create or replace view public.catalog_short_form_candidates as
select c.id,c.source_id,c.external_id,c.title,c.language,c.master_author_id,m.canonical_author_id,m.display_name,
       c.status,c.failure_class,c.last_error,c.provider_metadata,c.updated_at
from public.master_corpus_candidates c
join public.master_corpus_authors m on m.id=c.master_author_id
where c.failure_class='short-form-or-fragment';

create or replace function public.requeue_transient_master_candidates(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare v_candidates int:=0; v_authors int:=0;
begin
  with picked as (
    select c.id,c.master_author_id
    from public.master_corpus_candidates c
    where c.status in ('failed','review')
      and c.failure_class in ('transient-worker','transient-network')
      and c.transient_requeues < 5
      and c.processing_started_at is null
    order by c.updated_at,c.id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),500))
  ), uc as (
    update public.master_corpus_candidates c
    set status='failed', attempts=0, processing_started_at=null, next_attempt_at=now(),
        transient_requeues=c.transient_requeues+1, updated_at=now()
    from picked p where c.id=p.id
    returning c.master_author_id
  ), ua as (
    update public.master_corpus_authors m
    set status='ingesting',updated_at=now()
    where m.id in (select distinct master_author_id from uc)
      and m.status in ('rights-review','blocked','complete','ready-for-discovery')
    returning m.id
  )
  select (select count(*) from uc),(select count(*) from ua) into v_candidates,v_authors;
  return jsonb_build_object('ok',true,'requeuedCandidates',v_candidates,'reactivatedAuthors',v_authors);
end;
$$;

do $$ begin
  if not exists(select 1 from cron.job where jobname='catalog-transient-requeue') then
    perform cron.schedule('catalog-transient-requeue','13,43 * * * *','select public.requeue_transient_master_candidates(100);');
  end if;
  if not exists(select 1 from cron.job where jobname='catalog-canonicalization-refresh') then
    perform cron.schedule('catalog-canonicalization-refresh','27 */6 * * *','select public.refresh_catalog_canonicalization_queue();');
  end if;
end $$;

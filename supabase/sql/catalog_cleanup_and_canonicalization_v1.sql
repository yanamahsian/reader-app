-- Catalog cleanup + canonicalization support.
-- Non-destructive: classifies source failures, preserves short-form candidates,
-- fills Work language from master candidate metadata, and queues exact duplicate Works for review.

alter table public.master_corpus_candidates
  add column if not exists failure_class text,
  add column if not exists terminal_failure boolean not null default false;

create or replace function public.classify_master_candidate_failure(p_source text, p_status text, p_error text)
returns table(failure_class text, terminal_failure boolean)
language sql
immutable
as $$
  select case
    when p_status='ready' then null
    when p_status='review' and p_error is null then 'canonicalization-review'
    when p_error is null then null
    when p_error='Automatic worker: processing lease expired' then 'transient-worker'
    when p_error ilike '%503%' or p_error ilike '%504%' or p_error ilike '%522%' or p_error ilike '%timeout%' or p_error ilike '%timed out%' then 'transient-network'
    when p_source='library-of-congress' and p_error='Library of Congress OCR HTTP 404' then 'source-object-missing'
    when p_error ilike '%creator identity mismatch%' or p_error ilike '%creator mismatch%' then 'identity-mismatch'
    when p_error ilike '%too short%' or p_error ilike '%below Omnia book threshold%' then 'short-form-or-fragment'
    when p_error ilike '%No plaintext format available%' then 'source-format-unavailable'
    when p_error ilike '%reader-tested check failed%' then 'incomplete-or-nonbook-source'
    when p_error ilike '%Known source-quality failure%' then 'source-quality'
    else 'unclassified'
  end,
  case
    when p_status='ready' or (p_status='review' and p_error is null) or p_error is null then false
    when p_error='Automatic worker: processing lease expired' then false
    when p_error ilike '%503%' or p_error ilike '%504%' or p_error ilike '%522%' or p_error ilike '%timeout%' or p_error ilike '%timed out%' then false
    when p_source='library-of-congress' and p_error='Library of Congress OCR HTTP 404' then true
    when p_error ilike '%creator identity mismatch%' or p_error ilike '%creator mismatch%' then true
    when p_error ilike '%too short%' or p_error ilike '%below Omnia book threshold%' then true
    when p_error ilike '%No plaintext format available%' then true
    when p_error ilike '%reader-tested check failed%' then true
    when p_error ilike '%Known source-quality failure%' then true
    else false
  end;
$$;

create or replace function public.sync_master_candidate_failure_class()
returns trigger
language plpgsql
as $$
declare v_class text; v_terminal boolean;
begin
  select c.failure_class,c.terminal_failure into v_class,v_terminal
  from public.classify_master_candidate_failure(new.source_id,new.status,new.last_error) c;
  new.failure_class:=v_class;
  new.terminal_failure:=coalesce(v_terminal,false);
  return new;
end;
$$;

drop trigger if exists trg_sync_master_candidate_failure_class on public.master_corpus_candidates;
create trigger trg_sync_master_candidate_failure_class
before insert or update of source_id,status,last_error on public.master_corpus_candidates
for each row execute function public.sync_master_candidate_failure_class();

with classified as (
  select c.id, f.failure_class, f.terminal_failure
  from public.master_corpus_candidates c
  cross join lateral public.classify_master_candidate_failure(c.source_id,c.status,c.last_error) f
)
update public.master_corpus_candidates c
set failure_class=classified.failure_class, terminal_failure=classified.terminal_failure
from classified where classified.id=c.id;

create or replace function public.fill_work_language_from_ingestion_job()
returns trigger
language plpgsql
as $$
declare v_lang text;
begin
  if new.work_id is null then return new; end if;
  select c.language into v_lang
  from public.master_corpus_candidates c
  where c.source_id=new.source_id and c.external_id=new.external_id and nullif(btrim(c.language),'') is not null
  order by c.updated_at desc limit 1;
  if v_lang is not null then
    update public.works w
    set original_language=coalesce(w.original_language,v_lang),
        available_languages=case when v_lang=any(w.available_languages) then w.available_languages else array_append(w.available_languages,v_lang) end
    where w.id=new.work_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_work_language_from_ingestion_job on public.ingestion_jobs;
create trigger trg_fill_work_language_from_ingestion_job
after insert or update of work_id on public.ingestion_jobs
for each row when (new.work_id is not null)
execute function public.fill_work_language_from_ingestion_job();

update public.works w
set original_language=c.language,
    available_languages=case when c.language=any(w.available_languages) then w.available_languages else array_append(w.available_languages,c.language) end
from public.ingestion_jobs j
join public.master_corpus_candidates c on c.source_id=j.source_id and c.external_id=j.external_id
where j.work_id=w.id and w.original_language is null and nullif(btrim(c.language),'') is not null;

create table if not exists public.catalog_canonicalization_queue (
  group_key text primary key,
  author_id text not null references public.authors(id) on update cascade on delete cascade,
  normalized_title text not null,
  candidate_work_ids text[] not null,
  preferred_work_id text references public.works(id) on update cascade on delete set null,
  confidence text not null default 'exact-title-same-author',
  status text not null default 'pending' check (status in ('pending','resolved','held','ignored')),
  reasons text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create index if not exists catalog_canonicalization_queue_status_idx
  on public.catalog_canonicalization_queue(status,updated_at);

create or replace function public.refresh_catalog_canonicalization_queue()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare v_upserted int:=0; v_pending int:=0;
begin
  with work_scores as (
    select w.id,w.author_id,
      lower(regexp_replace(trim(w.title),'[^[:alnum:]]+','','g')) normalized_title,
      (case when w.publication_status='published' then 1000 else 0 end)
      + (case when coalesce(wr.catalog_ready,false) then 500 else 0 end)
      + 50*(select count(*) from public.editions e where e.work_id=w.id and e.ingestion_status='ready')
      + 20*(select count(*) from public.book_files bf join public.editions e on e.id=bf.edition_id where e.work_id=w.id and bf.kind='normalized' and bf.ingestion_status='ready')
      + (case when w.original_language is not null then 10 else 0 end)
      + (case when w.publication_year is not null then 5 else 0 end)
      + least(cardinality(w.alternative_titles),5) score
    from public.works w left join public.work_readiness wr on wr.work_id=w.id
    where nullif(trim(w.title),'') is not null
  ), dup as (
    select author_id,normalized_title,
      array_agg(id order by score desc,id) candidate_work_ids,
      (array_agg(id order by score desc,id))[1] preferred_work_id,
      count(*) cnt
    from work_scores
    where normalized_title<>''
    group by author_id,normalized_title having count(*)>1
  ), ins as (
    insert into public.catalog_canonicalization_queue(group_key,author_id,normalized_title,candidate_work_ids,preferred_work_id,confidence,reasons,updated_at)
    select md5(author_id||':'||normalized_title),author_id,normalized_title,candidate_work_ids,preferred_work_id,'exact-title-same-author',
      array['Exact normalized title under the same canonical author; preferred_work_id is ranked only as a merge candidate, not auto-merged.']::text[],now()
    from dup
    on conflict(group_key) do update set candidate_work_ids=excluded.candidate_work_ids,preferred_work_id=excluded.preferred_work_id,updated_at=now()
    returning 1
  ) select count(*) into v_upserted from ins;
  select count(*) into v_pending from public.catalog_canonicalization_queue where status='pending';
  return jsonb_build_object('ok',true,'upserted',v_upserted,'pending',v_pending);
end;
$$;

select public.refresh_catalog_canonicalization_queue();

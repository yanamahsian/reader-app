-- AN.KI million-scale provider wave v1
-- Production migration record for the provider-first metadata architecture.
-- IMPORTANT: this does not publish books and does not assign Free entitlement.
-- Raw provider metadata may be broad; content materialization remains fail-closed behind
-- serious_decision='auto-admit' AND rights_decision='allow'.

alter table public.open_book_candidates
  add column if not exists serious_score smallint not null default 0,
  add column if not exists serious_decision text not null default 'review',
  add column if not exists serious_reasons text[] not null default '{}',
  add column if not exists quality_checked_at timestamptz;

alter table public.open_book_candidates drop constraint if exists open_book_candidates_serious_decision_check;
alter table public.open_book_candidates add constraint open_book_candidates_serious_decision_check
  check (serious_decision in ('auto-admit','review','quarantine','reject'));

create table if not exists public.provider_ingestion_policies (
  source_id text primary key references public.sources(id) on update cascade on delete cascade,
  base_trust smallint not null default 20,
  metadata_index_enabled boolean not null default true,
  content_ingest_enabled boolean not null default false,
  serious_min_score smallint not null default 70,
  max_concurrency smallint not null default 5,
  notes text,
  updated_at timestamptz not null default now()
);

insert into public.provider_ingestion_policies(source_id,base_trust,metadata_index_enabled,content_ingest_enabled,serious_min_score,max_concurrency,notes)
values
 ('oapen',40,true,false,70,8,'Peer-reviewed OA books; metadata first, content only after rights+serious gate.'),
 ('ncbi-bookshelf-oa',40,true,true,70,6,'Institutional scholarly books; OA subset only.'),
 ('bhl',35,true,false,70,6,'BHL; monographs/books only, not serial/issues by default.'),
 ('internet-archive',10,true,false,75,4,'Institutional library collections only; never arbitrary uploads.'),
 ('library-of-congress',35,true,false,70,4,'Institutional source; still filter fragments/serial components.'),
 ('gutenberg',30,true,true,65,10,'Curated text corpus; literary/book identity still checked.'),
 ('wikisource',25,true,true,65,8,'Curated collaborative source; reject fragments/portal/index pages.'),
 ('aozora',30,true,true,65,8,'Curated Japanese PD library; short-form handled separately.'),
 ('wolne-lektury',35,true,true,65,8,'Curated educational/literary corpus.'),
 ('runeberg',30,true,false,65,4,'Curated Nordic corpus; adapter remains constrained.')
on conflict(source_id) do update set
  base_trust=excluded.base_trust,
  metadata_index_enabled=excluded.metadata_index_enabled,
  content_ingest_enabled=excluded.content_ingest_enabled,
  serious_min_score=excluded.serious_min_score,
  max_concurrency=excluded.max_concurrency,
  notes=excluded.notes,
  updated_at=now();

create or replace function public.evaluate_serious_book_candidate(
  p_source_id text,p_title text,p_contributors text[],p_language text,p_publication_year integer,
  p_license_uri text,p_subject_tags text[],p_content_kind text,p_rights_decision text,p_provider_metadata jsonb
) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare
  v_score int:=0; v_base int:=20; v_min int:=70; v_decision text:='review'; v_reasons text[]:='{}';
  v_title text:=lower(coalesce(p_title,'')); v_kind text:=lower(coalesce(p_content_kind,''));
  v_meta text:=lower(coalesce(p_provider_metadata::text,''));
  v_subjects text:=lower(array_to_string(coalesce(p_subject_tags,'{}'::text[]),' '));
begin
  select base_trust,serious_min_score into v_base,v_min from public.provider_ingestion_policies where source_id=p_source_id;
  v_base:=coalesce(v_base,20); v_min:=coalesce(v_min,70); v_score:=v_base;
  if trim(coalesce(p_title,''))='' then return jsonb_build_object('score',0,'decision','reject','reasons',array['missing-title']); end if;
  if v_title ~ '(fan[ -]?fiction|fanfic|role[ -]?play|fanzine|zine\b|advertis(e|ing|ement)|telephone directory|phone book|trade catalogue|sales catalogue|price list|prospectus only|conference programme|conference program)' then
    return jsonb_build_object('score',least(v_score,20),'decision','reject','reasons',array['obvious-non-serious-or-promotional-material']);
  end if;
  if v_kind in ('book','monograph','textbook','literary-work','reference') then v_score:=v_score+20; v_reasons:=array_append(v_reasons,'book-like-content-kind');
  elsif v_kind in ('article','chapter','serial','periodical','magazine','newspaper','pamphlet','brochure','map','image','audio','video') then
    return jsonb_build_object('score',least(v_score,35),'decision','reject','reasons',array['non-book-content-kind:'||v_kind]);
  else v_reasons:=array_append(v_reasons,'unknown-content-kind'); end if;
  if cardinality(coalesce(p_contributors,'{}'::text[]))>0 then v_score:=v_score+7; v_reasons:=array_append(v_reasons,'has-contributor'); else v_score:=v_score-8; v_reasons:=array_append(v_reasons,'missing-contributor'); end if;
  if nullif(trim(coalesce(p_language,'')),'') is not null then v_score:=v_score+5; end if;
  if p_publication_year between 1000 and extract(year from now())::int then v_score:=v_score+5; end if;
  if nullif(trim(coalesce(p_license_uri,'')),'') is not null then v_score:=v_score+5; end if;
  if p_rights_decision='allow' then v_score:=v_score+10; v_reasons:=array_append(v_reasons,'rights-allow');
  elsif p_rights_decision='deny' then return jsonb_build_object('score',v_score,'decision','reject','reasons',array_append(v_reasons,'rights-deny'));
  else v_reasons:=array_append(v_reasons,'rights-not-cleared'); end if;
  if cardinality(coalesce(p_subject_tags,'{}'::text[]))>0 then v_score:=v_score+5; end if;
  if v_meta ~ '(isbn|oclc|lccn|doi|handle|publisher|marc)' then v_score:=v_score+8; v_reasons:=array_append(v_reasons,'bibliographic-identifier-or-publisher'); end if;
  if v_subjects ~ '(literature|fiction|poetry|drama|philosoph|history|mathemat|physics|chemistry|biology|botany|zoology|econom|linguistic|philolog|art history|anthropolog|classics|education|geograph|political)' then v_score:=v_score+5; v_reasons:=array_append(v_reasons,'serious-subject-signal'); end if;
  v_score:=greatest(0,least(100,v_score));
  if p_rights_decision='allow' and v_score>=v_min then v_decision:='auto-admit'; elsif v_score>=45 then v_decision:='review'; else v_decision:='quarantine'; end if;
  return jsonb_build_object('score',v_score,'decision',v_decision,'reasons',v_reasons);
end$$;

create or replace function public.apply_serious_book_gate_trigger() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v jsonb;
begin
  v:=public.evaluate_serious_book_candidate(new.source_id,new.title,new.contributor_names,new.language,new.publication_year,new.license_uri,new.subject_tags,new.content_kind,new.rights_decision,new.provider_metadata);
  new.serious_score:=coalesce((v->>'score')::int,0);
  new.serious_decision:=coalesce(v->>'decision','review');
  new.serious_reasons:=coalesce(array(select jsonb_array_elements_text(coalesce(v->'reasons','[]'::jsonb))),'{}'::text[]);
  new.quality_checked_at:=now(); return new;
end$$;

drop trigger if exists trg_open_book_candidates_serious_gate on public.open_book_candidates;
create trigger trg_open_book_candidates_serious_gate before insert or update of source_id,title,contributor_names,language,publication_year,license_uri,subject_tags,content_kind,rights_decision,provider_metadata
on public.open_book_candidates for each row execute function public.apply_serious_book_gate_trigger();
create index if not exists open_book_candidates_serious_queue_idx on public.open_book_candidates(serious_decision,rights_decision,status,source_id,discovered_at);

-- Gallica / BnF provider.
insert into public.sources(id,name,base_url,trust_level) values ('gallica','Gallica / Bibliothèque nationale de France','https://gallica.bnf.fr','institutional')
on conflict(id) do update set name=excluded.name,base_url=excluded.base_url,trust_level=excluded.trust_level;
insert into public.provider_ingestion_policies(source_id,base_trust,metadata_index_enabled,content_ingest_enabled,serious_min_score,max_concurrency,notes)
values ('gallica',35,true,false,72,6,'BnF Gallica OAI-NUM metadata. Content stays disabled until rights and full-text adapter pass.')
on conflict(source_id) do update set base_trust=excluded.base_trust,metadata_index_enabled=true,content_ingest_enabled=false,serious_min_score=excluded.serious_min_score,max_concurrency=excluded.max_concurrency,notes=excluded.notes,updated_at=now();
insert into public.provider_sync_state(source_id,last_status,last_count,last_error,metadata)
values ('gallica','initialized',0,null,jsonb_build_object('resumptionToken',null,'cycleComplete',false,'recordsSeen',0,'accepted',0)) on conflict(source_id) do nothing;

-- BHL range-harvest staging. Title + Item monthly TSV are joined before promotion.
create table if not exists public.bulk_harvest_state(
  provider_key text primary key,byte_offset bigint not null default 0,total_bytes bigint,header_columns text[] not null default '{}',
  status text not null default 'initialized',rows_seen bigint not null default 0,rows_stored bigint not null default 0,last_error text,
  metadata jsonb not null default '{}',updated_at timestamptz not null default now());
create table if not exists public.bhl_title_staging(
  title_id bigint primary key,marc_bib_id text,marc_leader text,full_title text,short_title text,publication_details text,call_number text,
  start_year integer,end_year integer,language_code text,tl2_author text,title_url text,creation_date text,updated_at timestamptz not null default now());
create table if not exists public.bhl_item_staging(
  item_id bigint primary key,title_id bigint not null,thumbnail_page_id bigint,barcode text,marc_item_id text,call_number text,volume_info text,
  item_url text,item_text_url text,item_pdf_url text,item_images_url text,local_id text,year_text text,institution_name text,zquery text,creation_date text,
  copyright_status text,rights_statement text,license_type text,rights_holder text,updated_at timestamptz not null default now());
create index if not exists bhl_item_staging_title_idx on public.bhl_item_staging(title_id);
insert into public.bulk_harvest_state(provider_key,status,metadata) values
 ('bhl-title','ready',jsonb_build_object('url','https://www.biodiversitylibrary.org/data/TSV/hosted/title.txt')),
 ('bhl-item','ready',jsonb_build_object('url','https://www.biodiversitylibrary.org/data/TSV/hosted/item.txt')) on conflict(provider_key) do nothing;

create or replace function public.promote_bhl_candidates(p_limit integer default 2000) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count int:=0;
begin
  with eligible as (
    select i.item_id,i.title_id,t.full_title,t.short_title,t.publication_details,t.start_year,t.language_code,t.tl2_author,t.title_url,t.marc_leader,
      i.item_url,i.item_text_url,i.item_pdf_url,i.year_text,i.institution_name,i.copyright_status,i.rights_statement,i.license_type,i.rights_holder,
      lower(concat_ws(' ',i.copyright_status,i.rights_statement,i.license_type)) rights_text
    from public.bhl_item_staging i join public.bhl_title_staging t on t.title_id=i.title_id
    where nullif(trim(coalesce(i.item_text_url,'')),'') is not null
      and nullif(trim(coalesce(t.full_title,t.short_title,'')),'') is not null
      and substring(coalesce(t.marc_leader,'') from 8 for 1)='m'
      and not exists(select 1 from public.open_book_candidates c where c.source_id='bhl' and c.external_id=i.item_id::text)
    order by i.item_id limit greatest(1,least(coalesce(p_limit,2000),10000))
  ), ins as (
    insert into public.open_book_candidates(source_id,external_id,title,contributor_names,language,publication_year,license_uri,download_url,subject_tags,content_kind,status,rights_decision,provider_metadata)
    select 'bhl',e.item_id::text,coalesce(nullif(trim(e.full_title),''),e.short_title),
      case when nullif(trim(coalesce(e.tl2_author,'')),'') is null then '{}'::text[] else array[e.tl2_author] end,
      nullif(trim(coalesce(e.language_code,'')),''),
      coalesce(case when e.year_text ~ '(1[0-9]{3}|20[0-9]{2})' then substring(e.year_text from '(1[0-9]{3}|20[0-9]{2})')::int end,e.start_year),
      null,e.item_text_url,'{}'::text[],'book','discovered',
      case when e.rights_text ~ '(noncommercial|non-commercial|cc[ -]?by[ -]?nc|/by-nc/|no derivatives|cc[ -]?by[ -]?nd|/by-nd/|all rights reserved|tous droits)' then 'deny'
           when e.rights_text ~ '(public domain|domaine public|publicdomain/mark|publicdomain/zero|cc[ -]?by([^a-z]|$)|creative commons attribution|cc[ -]?by[ -]?sa|/licenses/by/|/licenses/by-sa/)' then 'allow' else 'pending' end,
      jsonb_build_object('bhlTitleId',e.title_id,'bhlItemId',e.item_id,'marcLeader',e.marc_leader,'publicationDetails',e.publication_details,'institution',e.institution_name,'titleUrl',e.title_url,'itemUrl',e.item_url,'pdfUrl',e.item_pdf_url,'copyrightStatus',e.copyright_status,'rightsStatement',e.rights_statement,'licenseType',e.license_type,'rightsHolder',e.rights_holder,'sourceFormat','plaintext-ocr','institutionalBibliography',true)
    from eligible e returning 1
  ) select count(*) into v_count from ins;
  return jsonb_build_object('ok',true,'promoted',v_count);
end$$;

-- Internet Archive: metadata only, strict institutional collection seed.
insert into public.provider_sync_state(source_id,last_status,last_count,last_error,metadata)
values ('internet-archive','initialized',0,null,jsonb_build_object('mode','advancedsearch','collection','americana','page',1,'rows',500,'cycleComplete',false,'recordsSeen',0,'accepted',0))
on conflict(source_id) do nothing;

-- Dispatchers use the existing server-side master-corpus run token.
create or replace function public.dispatch_gallica_oai_discover_page() returns bigint
language plpgsql security definer set search_path=public,vault,net,extensions,pg_temp as $$
declare v_token text;v_request bigint;begin
 select decrypted_secret into v_token from vault.decrypted_secrets where name='omnia_master_corpus_runner_token' order by created_at desc limit 1;
 if v_token is null then raise exception 'Master corpus runner token missing';end if;
 v_request:=net.http_get(url:='https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-gallica-oai-discover-page',headers:=jsonb_build_object('x-omnia-run-token',v_token),timeout_milliseconds:=120000);return v_request;end$$;

create or replace function public.dispatch_oapen_doab_discover_page() returns bigint
language plpgsql security definer set search_path=public,vault,net,extensions,pg_temp as $$
declare v_token text;v_request bigint;begin
 select decrypted_secret into v_token from vault.decrypted_secrets where name='omnia_master_corpus_runner_token' order by created_at desc limit 1;
 if v_token is null then raise exception 'Master corpus runner token missing';end if;
 v_request:=net.http_get(url:='https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-oapen-oai-discover-page',headers:=jsonb_build_object('x-omnia-run-token',v_token),timeout_milliseconds:=120000);return v_request;end$$;

create or replace function public.dispatch_bhl_bulk_chunk(p_kind text) returns bigint
language plpgsql security definer set search_path=public,vault,net,extensions,pg_temp as $$
declare v_token text;v_request bigint;begin
 if p_kind not in ('title','item') then raise exception 'invalid BHL bulk kind';end if;
 select decrypted_secret into v_token from vault.decrypted_secrets where name='omnia_master_corpus_runner_token' order by created_at desc limit 1;
 if v_token is null then raise exception 'Master corpus runner token missing';end if;
 v_request:=net.http_get(url:='https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-bhl-bulk-harvest-chunk',params:=jsonb_build_object('kind',p_kind),headers:=jsonb_build_object('x-omnia-run-token',v_token),timeout_milliseconds:=120000);return v_request;end$$;

create or replace function public.dispatch_internet_archive_institutional_discover() returns bigint
language plpgsql security definer set search_path=public,vault,net,extensions,pg_temp as $$
declare v_token text;v_request bigint;begin
 select decrypted_secret into v_token from vault.decrypted_secrets where name='omnia_master_corpus_runner_token' order by created_at desc limit 1;
 if v_token is null then raise exception 'Master corpus runner token missing';end if;
 v_request:=net.http_get(url:='https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-internet-archive-institutional-discover',headers:=jsonb_build_object('x-omnia-run-token',v_token),timeout_milliseconds:=120000);return v_request;end$$;

-- Production cron jobs are created idempotently by the applied migrations:
-- omnia-gallica-oai-metadata: */5 * * * *
-- omnia-oapen-doab-metadata: */15 * * * * (dispatcher now points to OAI-PMH)
-- omnia-bhl-title-bulk: */2 * * * *
-- omnia-bhl-item-bulk: 1-59/2 * * * *
-- omnia-internet-archive-institutional-metadata: */5 * * * *

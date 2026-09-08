-- University Reading Corpus v1
-- Provenance layer for official university reading lists / syllabi / open courseware.
-- Does not bypass AN.KI rights/readiness/publication gates.

create table if not exists public.university_reading_sources (
  id uuid primary key default gen_random_uuid(),
  institution text not null,
  faculty text,
  course_code text,
  course_title text not null,
  academic_year text,
  source_url text not null unique,
  source_kind text not null check (source_kind in ('official-reading-list','official-course-page','official-syllabus','open-courseware')),
  source_is_official boolean not null default true,
  verified_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.university_reading_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.university_reading_sources(id) on delete cascade,
  recommendation_scope text not null default 'work' check (recommendation_scope in ('work','author','collection')),
  author_text text,
  title_text text not null,
  prescribed_edition text,
  item_role text not null default 'primary' check (item_role in ('primary','secondary','textbook','recommended','context')),
  work_id text references public.works(id) on update cascade on delete set null,
  resolution_status text not null default 'unresolved' check (resolution_status in ('unresolved','matched','queued','ready','published','rights-blocked','review')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id,recommendation_scope,title_text,author_text)
);

create index if not exists university_reading_items_work_id_idx
  on public.university_reading_items(work_id);
create index if not exists university_reading_items_resolution_idx
  on public.university_reading_items(resolution_status);
create index if not exists university_reading_sources_institution_idx
  on public.university_reading_sources(institution);

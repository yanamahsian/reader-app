-- Catalog curation reconciliation v3
--
-- Operational data corrections applied during the 2026-09-07 curated publication pass.
-- This file intentionally DOES NOT publish Works. Publication remains an explicit
-- service-role call through public.publish_free_catalog_works(text[]) after runtime
-- completeness review of the selected edition.
--
-- Safe replay assumptions:
--   * UPDATEs are idempotent.
--   * hold UPSERTs are idempotent.
--   * rows that are not present are simply unaffected.

-- -----------------------------------------------------------------------------
-- Joseph Conrad: canonical language/title correction.
-- Conrad wrote these Works in English. Earlier discovery metadata incorrectly
-- treated French Wikisource translations as originals.
-- -----------------------------------------------------------------------------

update public.master_corpus_authors
set original_language = 'en', updated_at = now()
where canonical_author_id = 'joseph-conrad';

update public.works
set title = 'Heart of Darkness',
    original_title = 'Heart of Darkness',
    original_language = 'en',
    alternative_titles = array[
      'Le Cœur des ténèbres',
      'Jeunesse, suivi du Cœur des ténèbres/Le Cœur des ténèbres'
    ]::text[]
where id = 'ws-q129778';

update public.works
set title = 'Youth, a Narrative',
    original_title = 'Youth, a Narrative',
    original_language = 'en',
    alternative_titles = array[
      'Youth',
      'Jeunesse',
      'Jeunesse, suivi du Cœur des ténèbres/Jeunesse'
    ]::text[]
where id = 'ws-q1339248';

update public.works
set title = 'Lord Jim', original_title = 'Lord Jim', original_language = 'en'
where id = 'ws-q727408';

update public.works
set title = 'Typhoon',
    original_title = 'Typhoon',
    original_language = 'en',
    alternative_titles = array['Typhon']::text[]
where id = 'typhon';

-- French Wikisource editions are translations. They must not inherit an
-- original-author-only German public-domain determination.
update public.editions
set is_original = false
where id in (
  'ws-q129778-wikisource-q129778',
  'ws-q1339248-wikisource-q1339248',
  'ws-q727408-wikisource-q727408'
);

update public.rights_assertions
set status = 'unknown',
    asserted_at = now(),
    rights_metadata = jsonb_build_object(
      'assessment', 'translation-rights-requires-translator',
      'reason', 'Conrad French Wikisource edition is a translation; translator identity must be resolved before DE publication.',
      'corrected_by', 'catalog_curation_reconciliation_v3'
    )
where jurisdiction = 'DE'
  and edition_id in (
    'ws-q129778-wikisource-q129778',
    'ws-q1339248-wikisource-q1339248',
    'ws-q727408-wikisource-q727408'
  );

-- Gutenberg sound/audio derivatives that had been normalized as though they
-- were canonical text editions. Keep them fail-closed.
update public.editions
set ingestion_status = 'failed'
where id in (
  'ws-q129778-gutenberg-20270',
  'ws-q727408-gutenberg-21435',
  'ws-q727408-gutenberg-7874'
);

update public.book_files
set ingestion_status = 'failed'
where edition_id in (
  'ws-q129778-gutenberg-20270',
  'ws-q727408-gutenberg-21435',
  'ws-q727408-gutenberg-7874'
);

update public.ingestion_jobs
set status = 'failed',
    last_error = 'Quarantined: Project Gutenberg record is audio/sound, not a canonical text edition.'
where source_id = 'gutenberg'
  and external_id in ('20270', '21435', '7874');

-- -----------------------------------------------------------------------------
-- Publication holds: source containers / fragments / known duplicates.
-- -----------------------------------------------------------------------------

insert into public.catalog_publication_holds(work_id, reason_code, note, enabled, updated_at)
values
  ('mardi-and-a-voyage-thither-vol-1-of-2', 'split-volume-fragment',
   'Mardi is represented as Vol. 1 of 2; assemble a complete canonical edition before publication.', true, now()),
  ('mardi-and-a-voyage-thither-vol-2-of-2', 'split-volume-fragment',
   'Mardi is represented as Vol. 2 of 2; assemble a complete canonical edition before publication.', true, now()),
  ('the-works-of-robert-louis-stevenson-swanston-edition-vol-20', 'collection-volume',
   'Swanston collected-works volume; source container, not a standalone publication Work.', true, now()),
  ('the-works-of-robert-louis-stevenson-swanston-edition-vol-24', 'collection-volume',
   'Swanston collected-works volume; source container, not a standalone publication Work.', true, now()),
  ('the-works-of-robert-louis-stevenson-swanston-edition-vol-25', 'collection-volume',
   'Swanston collected-works volume; source container, not a standalone publication Work.', true, now()),
  ('ws-q16254942', 'nested-subwork-duplicate',
   'The Reluctant Dragon is nested inside Dream Days in this source representation; hold until standalone editorial modeling is intentional.', true, now()),
  ('the-philosophy-of-the-plays-of-shakespere-unfolded-loc', 'attribution-review',
   'Current LoC-derived catalog attribution to Nathaniel Hawthorne is incorrect; do not publish until authorship is repaired.', true, now()),
  ('the-scarlet-letter-and-the-blithedale-romance-loc', 'combined-volume',
   'LoC source combines The Scarlet Letter and The Blithedale Romance; clean standalone Scarlet Letter is preferred.', true, now()),
  ('our-old-home-and-english-note-books-loc', 'combined-volume',
   'LoC volume combines separate Hawthorne works/notes; keep as a source container pending deliberate modeling.', true, now()),
  ('passages-from-the-french-and-italian-note-books-of-nathaniel-hawthorne-loc', 'source-container-review',
   'Notebook volume is not part of the current curated literary release wave.', true, now())
on conflict(work_id) do update
set reason_code = excluded.reason_code,
    note = excluded.note,
    enabled = excluded.enabled,
    updated_at = now();

-- Known duplicate Works are retained as hidden historical rows. Their editions
-- and identity references were reassigned to canonical Works during the live
-- reconciliation pass; the holds below prevent accidental resurfacing.
insert into public.catalog_publication_holds(work_id, reason_code, note, enabled, updated_at)
values
  ('ws-q2463076', 'duplicate-canonical-work', 'Duplicate Typee Work; canonical Work is typee-a-romance-of-the-south-seas.', true, now()),
  ('ws-q7736982', 'duplicate-canonical-work', 'Duplicate The Golden Age Work; canonical Work is the-golden-age.', true, now()),
  ('dream-days', 'duplicate-canonical-work', 'Duplicate Gutenberg-created Dream Days Work; canonical Work is ws-q23823967.', true, now()),
  ('catriona', 'duplicate-canonical-work', 'Duplicate Gutenberg-created Catriona Work; canonical Work is ws-q2277829.', true, now()),
  ('the-black-arrow-a-tale-of-the-two-roses', 'duplicate-canonical-work', 'Duplicate Gutenberg-created Black Arrow Work; canonical Work is ws-q1196792.', true, now()),
  ('the-master-of-ballantrae-a-winters-tale', 'duplicate-canonical-work', 'Duplicate Gutenberg-created Master of Ballantrae Work; canonical Work is ws-q2615930.', true, now())
on conflict(work_id) do update
set reason_code = excluded.reason_code,
    note = excluded.note,
    enabled = excluded.enabled,
    updated_at = now();

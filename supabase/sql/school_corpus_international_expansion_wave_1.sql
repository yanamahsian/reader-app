create table if not exists public.school_curriculum_country_queue (
  country_code text primary key,
  country_name text not null,
  region text,
  status text not null default 'source-discovery' check (status in ('source-discovery','curriculum-indexed','textbook-discovery','rights-review','ingesting','complete','blocked')),
  priority integer not null default 100,
  official_source_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.school_curriculum_country_queue(country_code,country_name,region,status,priority,official_source_count,notes)
values
('AU','Australia','Oceania','curriculum-indexed',20,1,'Australian Curriculum official national source seeded'),
('NZ','New Zealand','Oceania','curriculum-indexed',20,1,'National curriculum / NCEA official sources seeded'),
('JP','Japan','Asia','curriculum-indexed',20,1,'MEXT Courses of Study source seeded'),
('FI','Finland','Europe','curriculum-indexed',20,1,'Finnish National Agency for Education source seeded'),
('PT','Portugal','Europe','curriculum-indexed',20,1,'Direção-Geral da Educação source seeded'),
('NO','Norway','Europe','curriculum-indexed',20,1,'Udir LK20 source seeded'),
('IE','Ireland','Europe','curriculum-indexed',20,1,'NCCA Curriculum Online source seeded'),
('ZA','South Africa','Africa','curriculum-indexed',20,1,'Department of Basic Education CAPS source seeded'),
('TR','Türkiye','Asia/Europe','curriculum-indexed',20,1,'MEB upper-secondary curriculum source seeded'),
('BR','Brazil','South America','curriculum-indexed',20,1,'MEC BNCC Ensino Médio source seeded'),
('GB-ENG','England','Europe','curriculum-indexed',10,1,'Existing official national curriculum source'),
('DE','Germany','Europe','curriculum-indexed',10,1,'Existing KMK Bildungsstandards source'),
('FR','France','Europe','curriculum-indexed',10,1,'Existing Ministère programme source'),
('PL','Poland','Europe','curriculum-indexed',10,1,'Existing MEN source'),
('UA','Ukraine','Europe','curriculum-indexed',10,2,'Existing MON school-programme sources'),
('ES','Spain','Europe','curriculum-indexed',10,1,'Existing LOMLOE source')
on conflict (country_code) do update set
  country_name=excluded.country_name,
  region=excluded.region,
  status=excluded.status,
  priority=least(public.school_curriculum_country_queue.priority,excluded.priority),
  official_source_count=greatest(public.school_curriculum_country_queue.official_source_count,excluded.official_source_count),
  notes=excluded.notes,
  updated_at=now();

with src(country_code,country_name,authority,curriculum_name,education_level,subject,academic_year,source_url,source_kind,metadata) as (
values
('AU','Australia','Australian Curriculum, Assessment and Reporting Authority','Australian Curriculum / Senior Secondary Curriculum','F-10 and senior secondary','cross-subject',null,'https://www.australiancurriculum.edu.au/senior-secondary-curriculum','official-curriculum',jsonb_build_object('subjects',array['English','Literature','Mathematics','Biology','Chemistry','Earth and Environmental Science','Physics','Ancient History','Modern History','Geography'])),
('NZ','New Zealand','Ministry of Education','New Zealand Curriculum / NCEA','secondary / Years 11-13','cross-subject','2026','https://ncea.education.govt.nz/','official-curriculum',jsonb_build_object('subjects',array['English','Mathematics and Statistics','Science','Chemistry and Biology','Physics, Earth and Space Science','History','Geography','Commerce','Social Studies','French','German','Spanish','Chinese','Japanese','Korean','Visual Arts','Music'])),
('JP','Japan','Ministry of Education, Culture, Sports, Science and Technology','Courses of Study','upper secondary','cross-subject',null,'https://www.mext.go.jp/en/policy/education/elsec/title02/detail02/1373859.htm','official-standards',jsonb_build_object('note','MEXT national Courses of Study; subject-level extraction to follow')),
('FI','Finland','Finnish National Agency for Education','National Core Curriculum for General Upper Secondary Education 2019','general upper secondary','cross-subject','2019','https://www.oph.fi/en/education-and-qualifications/what-general-upper-secondary-education','official-curriculum',jsonb_build_object('subjects',array['Mother tongue and literature','Languages','Mathematics','Physics','Chemistry','Biology','Geography','Philosophy','History','Social studies','Psychology','Music','Visual arts'])),
('PT','Portugal','Direção-Geral da Educação','Aprendizagens Essenciais - Ensino Secundário','secondary','cross-subject',null,'https://www.dge.mec.pt/aprendizagens-essenciais-ensino-secundario','official-curriculum',jsonb_build_object('subjects',array['Português','Filosofia','Inglês','Alemão'])),
('NO','Norway','Norwegian Directorate for Education and Training','LK20 curricula','primary and upper secondary','cross-subject','2026','https://www.udir.no/lk20/','official-curriculum',jsonb_build_object('subjects',array['Norwegian','English'])),
('IE','Ireland','National Council for Curriculum and Assessment','Senior Cycle Subjects','senior cycle','cross-subject','2026','https://curriculumonline.ie/senior-cycle/senior-cycle-subjects/','official-curriculum',jsonb_build_object('subjects',array['English','Mathematics','Biology','Chemistry','Physics','History','Geography','Economics','Classical Studies','Ancient Greek','Latin','French','German','Italian','Spanish','Art','Music','Politics and Society'])),
('ZA','South Africa','Department of Basic Education','National Curriculum Statement / CAPS','Grades R-12','cross-subject','2026','https://www.education.gov.za/Curriculum/CAPS/tabid/419/Default.aspx','official-curriculum',jsonb_build_object('note','CAPS national curriculum; FET literature and LTSM catalogues available as linked official sub-sources')),
('TR','Türkiye','Millî Eğitim Bakanlığı','Türkiye Yüzyılı Maarif Modeli - Ortaöğretim','grades 9-12','cross-subject','2026','https://tymm.meb.gov.tr/ogretim-programlari/tarih-dersi','official-curriculum',jsonb_build_object('subjects',array['Türk Dili ve Edebiyatı','Matematik','Fizik','Kimya','Biyoloji','Tarih','Coğrafya','Felsefe','İngilizce','Görsel Sanatlar','Müzik'])),
('BR','Brazil','Ministério da Educação','BNCC - Ensino Médio','upper secondary','cross-subject',null,'https://portal.mec.gov.br/e-mec-sp-257584288/323-secretarias-112877938/orgaos-vinculados-82187207/62391-bncc-ensino-medio','official-curriculum',jsonb_build_object('areas',array['Linguagens e suas Tecnologias','Matemática e suas Tecnologias','Ciências da Natureza e suas Tecnologias','Ciências Humanas e Sociais Aplicadas']))
)
insert into public.school_curriculum_sources(country_code,country_name,authority,curriculum_name,education_level,subject,academic_year,source_url,source_kind,source_is_official,verified_at,metadata)
select country_code,country_name,authority,curriculum_name,education_level,subject,academic_year,source_url,source_kind,true,now(),metadata
from src s
where not exists(select 1 from public.school_curriculum_sources x where x.source_url=s.source_url);

insert into public.school_curriculum_items(source_id,grade_band,subject,item_type,recommendation_scope,rights_requirement,resolution_status,notes)
select s.id,s.education_level,subj,'topic','official curriculum subject/learning area','verify-edition-rights','unresolved','Subject-level seed; later resolve to specific required/recommended works, textbooks and open editions.'
from public.school_curriculum_sources s
cross join lateral unnest(coalesce(array(select jsonb_array_elements_text(s.metadata->'subjects')),array(select jsonb_array_elements_text(s.metadata->'areas')))) subj
where s.country_code in ('AU','NZ','FI','PT','NO','IE','TR','BR')
  and not exists(select 1 from public.school_curriculum_items i where i.source_id=s.id and i.subject=subj and i.item_type='topic');

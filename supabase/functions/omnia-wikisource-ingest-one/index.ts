import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SOURCE_ID="wikisource",MIN_TEXT=20000,TYPE_DEPTH=3;const ROOT_TYPES=new Set(["Q571","Q7725634","Q25379"]);
function json(body:unknown,status=200){return new Response(JSON.stringify(body,null,2),{status,headers:{"Content-Type":"application/json"}});}
async function sha256Hex(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");}
function apiBase(l:string){return`https://${l}.wikisource.org/w/api.php`;}
async function wd(ids:string[]){const u=new URL("https://www.wikidata.org/w/api.php");for(const[k,v]of Object.entries({action:"wbgetentities",format:"json",ids:ids.join("|"),props:"claims",origin:"*"}))u.searchParams.set(k,v);const r=await fetch(u.toString(),{headers:{"User-Agent":"OmniaLibrary/1.0 (book ingestion)"}});if(!r.ok)throw new Error(`Wikidata API ${r.status}`);return(await r.json()).entities??{};}
function claimIds(e:any,p:string){const o:string[]=[];for(const c of e?.claims?.[p]??[]){const id=c?.mainsnak?.datavalue?.value?.id;if(typeof id==="string")o.push(id);}return o;}
function confirmedAuthorship(e:any,authorQid:string){const claims=(e?.claims?.P50??[]).filter((c:any)=>c?.rank!=="deprecated"&&c?.mainsnak?.snaktype==="value");if(claims.length!==1)return false;const c=claims[0],id=c?.mainsnak?.datavalue?.value?.id;if(id!==authorQid)return false;const q=c?.qualifiers??{};if((q.P1480?.length??0)>0||(q.P2241?.length??0)>0)return false;return true;}
async function allowedType(qid:string){const e=(await wd([qid]))[qid];let f=new Set(claimIds(e,"P31"));if([...f].some(x=>ROOT_TYPES.has(x)))return true;const seen=new Set<string>();for(let d=0;d<TYPE_DEPTH&&f.size;d++){const ids=[...f].filter(x=>!seen.has(x));ids.forEach(x=>seen.add(x));const next=new Set<string>();for(let i=0;i<ids.length;i+=40){const es=await wd(ids.slice(i,i+40));for(const[,v]of Object.entries(es)){const p=claimIds(v,"P279");if(p.some(x=>ROOT_TYPES.has(x)))return true;p.forEach(x=>next.add(x));}}f=next;}return false;}
function decodeHtml(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));}
// Do not drop every <table> block. Some Wikisource works (notably de:Der Sandmann)
// contain the actual transcribed body inside table-shaped layout markup. Removing tables
// greedily can erase the entire literary text. We keep table contents and let the generic
// tag stripper below remove only the markup; non-literary chrome is still removed by the
// script/style/figure/nav/footer/header filters and the downstream minimum-text/identity gates.
function htmlToText(h:string){return decodeHtml(h).replace(/<!--[\s\S]*?-->/g," ").replace(/<(script|style|figure|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi,"\n").replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi," ").replace(/<(br|hr)\b[^>]*>/gi,"\n").replace(/<\/(p|div|li|h[1-6]|section|blockquote)>/gi,"\n").replace(/<[^>]+>/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n").replace(/[ \t]{2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();}
async function parsePage(l:string,t:string){const u=new URL(apiBase(l));for(const[k,v]of Object.entries({action:"parse",page:t,prop:"text",redirects:"1",format:"json",formatversion:"2",origin:"*"}))u.searchParams.set(k,v);const r=await fetch(u.toString(),{headers:{"User-Agent":"OmniaLibrary/1.0 (book ingestion)"}});if(!r.ok)throw new Error(`Wikisource parse ${r.status}: ${t}`);const d=await r.json();if(typeof d?.parse?.text!=="string")throw new Error(`No parsed text: ${t}`);return htmlToText(d.parse.text);}
async function subpages(l:string,t:string){const out:string[]=[];let cont:string|undefined;do{const u=new URL(apiBase(l));const p:Record<string,string>={action:"query",list:"allpages",apprefix:`${t}/`,apnamespace:"0",aplimit:"500",format:"json",formatversion:"2",origin:"*"};if(cont)p.apcontinue=cont;for(const[k,v]of Object.entries(p))u.searchParams.set(k,v);const r=await fetch(u.toString(),{headers:{"User-Agent":"OmniaLibrary/1.0 (book ingestion)"}});if(!r.ok)throw new Error(`Wikisource subpages ${r.status}`);const d=await r.json();for(const p of d?.query?.allpages??[])if(typeof p.title==="string")out.push(p.title);cont=d?.continue?.apcontinue;}while(cont&&out.length<500);return Array.from(new Set(out)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"})).slice(0,500);}
async function extractBook(l:string,t:string){const subs=await subpages(l,t);let chapters:Array<{title:string|null,text:string}>=[];if(subs.length){for(let i=0;i<subs.length;i+=6){const batch=subs.slice(i,i+6),texts=await Promise.all(batch.map(x=>parsePage(l,x).catch(()=>"")));for(let j=0;j<batch.length;j++){const text=texts[j].trim();if(text.length>=150)chapters.push({title:batch[j].slice(t.length+1).replaceAll("_"," ")||null,text});}}if(chapters.reduce((n,c)=>n+c.text.length,0)<MIN_TEXT)chapters=[];}if(!chapters.length){const text=await parsePage(l,t);chapters=[{title:null,text}];}const textLength=chapters.reduce((n,c)=>n+c.text.length,0),sourceText=chapters.map(c=>(c.title?`${c.title}\n\n`:"")+c.text).join("\n\n");return{chapters,textLength,sourceText};}
// Built from character codes rather than literal/escaped Unicode in the regex source -- this
// codebase has observed both literal-character corruption during manual transcription AND
// deploy-time decoding of \uXXXX escapes (see anki-multilingual-discover's identical rationale
// for its own COMBINING_MARKS_PATTERN). Constructing the range numerically avoids both risks.
const COMBINING_MARKS_PATTERN=new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,"g");
const CYRILLIC_YO_LOWER=String.fromCharCode(0x0451);
const CYRILLIC_YE_LOWER=String.fromCharCode(0x0435);
function normalize(s:string){return s.normalize("NFD").replace(COMBINING_MARKS_PATTERN,"").toLowerCase().split(CYRILLIC_YO_LOWER).join(CYRILLIC_YE_LOWER).replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");}
// Deterministic (non-fuzzy) structural cleanup: Wikisource disambiguates work pages by appending
// " (AuthorName)" or similar trailing parenthetical annotations to the page title (e.g.
// "Анна Каренина (Толстой)"). Our own catalog titles never carry that suffix. Stripping exactly one
// trailing parenthetical group before comparing lets a Wikisource candidate exact-match an existing
// Work's title/original_title/alternative_titles even when the page title carries this annotation.
// This is still an EXACT string comparison after a well-defined structural strip -- not fuzzy matching.
function stripTrailingParen(s:string){return s.replace(/\s*\([^()]*\)\s*$/," ").trim();}

const IDENTITY_SCHEME = "wikidata-work";

Deno.serve(async req=>{if(req.method!=="GET")return json({error:"Method not allowed"},405);const u=new URL(req.url),token=req.headers.get("x-omnia-run-token")??u.searchParams.get("token")??"",authorId=u.searchParams.get("authorId")??"",externalId=u.searchParams.get("externalId")??"";if(!token||!authorId||!externalId)return json({error:"Missing token, authorId, or externalId"},400);const base=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!base||!key)return json({error:"Missing server secrets"},500);const sb=createClient(base,key);const hash=await sha256Hex(token);const{data:rt}=await sb.from("master_corpus_run_tokens").select("id,expires_at,remaining_calls").eq("token_hash",hash).maybeSingle();if(!rt||new Date(rt.expires_at).getTime()<=Date.now()||rt.remaining_calls<=0)return json({error:"Invalid, expired, or exhausted token"},401);await sb.from("master_corpus_run_tokens").update({remaining_calls:rt.remaining_calls-1,last_used_at:new Date().toISOString()}).eq("id",rt.id).eq("remaining_calls",rt.remaining_calls);const{data:m,error:me}=await sb.from("master_corpus_authors").select("id,display_name,canonical_author_id,original_language,status").eq("canonical_author_id",authorId).maybeSingle();if(me||!m)return json({error:me?.message??"Master author missing"},404);if(!["ready-for-discovery","ingesting"].includes(m.status))return json({error:"Author is not approved"},403);const{data:c,error:ce}=await sb.from("master_corpus_candidates").select("id,title,language,status,work_id,edition_id,provider_metadata").eq("master_author_id",m.id).eq("source_id",SOURCE_ID).eq("external_id",externalId).maybeSingle();if(ce||!c)return json({error:ce?.message??"Candidate not found"},404);const meta=c.provider_metadata??{},l=meta.wikiLanguage,authorQid=meta.authorQid,workQid=meta.workQid;if(typeof l!=="string"||typeof authorQid!=="string"||typeof workQid!=="string")return json({error:"Candidate lacks verified Wikisource metadata"},409);try{
  const entity=(await wd([workQid]))[workQid];
  if(!confirmedAuthorship(entity,authorQid))throw new Error("Authorship is not a single unambiguous non-deprecated Wikidata P50 claim");
  if(!(await allowedType(workQid)))throw new Error("Wikidata type is not an approved book/literary-work type");
  const{data:existing}=await sb.from("editions").select("id,work_id,ingestion_status").eq("source_id",SOURCE_ID).eq("external_id",externalId).maybeSingle();
  if(existing?.ingestion_status==="ready"){await sb.from("master_corpus_candidates").update({status:"ready",work_id:existing.work_id,edition_id:existing.id,last_error:null,processing_started_at:null,updated_at:new Date().toISOString()}).eq("id",c.id);return json({ok:true,status:"already_ready",authorId,externalId,workId:existing.work_id,editionId:existing.id});}
  const book=await extractBook(l,c.title);
  if(book.textLength<MIN_TEXT)throw new Error(`Wikisource text too short (${book.textLength} chars); not storing as a book`);

  // ---- CROSS-LANGUAGE WORK IDENTITY BRIDGE v1, section 10: identity-first lookup ----
  // External Work identity now takes priority over title matching. If this Wikidata
  // work QID is already bound to a canonical Work in work_external_identifiers, use
  // that Work directly -- title matching is a fallback for when no identity binding
  // exists yet, never the primary mechanism.
  const normalizedQid = workQid.toUpperCase();
  const{data:existingIdentity}=await sb.from("work_external_identifiers").select("work_id").eq("scheme",IDENTITY_SCHEME).eq("external_id",normalizedQid).maybeSingle();

  let workId:string;
  let matchedViaIdentity=false;
  let isNewWork=false;

  if(existingIdentity?.work_id){
    workId=existingIdentity.work_id;
    matchedViaIdentity=true;
  } else {
    const{data:works,error:we}=await sb.from("works").select("id,title,original_title,alternative_titles").eq("author_id",authorId);
    if(we)throw new Error(we.message);
    const rawTarget=normalize(c.title);
    const strippedRaw=stripTrailingParen(c.title);
    const strippedTarget=strippedRaw!==c.title?normalize(strippedRaw):null;
    const matches=(works??[]).filter((w:any)=>{const cands=[w.title,w.original_title,...(w.alternative_titles??[])].filter(Boolean).map((t:string)=>normalize(t));return cands.includes(rawTarget)||(strippedTarget!==null&&cands.includes(strippedTarget));});
    if(matches.length===1){workId=matches[0].id;}
    else if(matches.length===0){
      workId=`ws-${workQid.toLowerCase()}`;
      isNewWork=true;
      const{error}=await sb.from("works").upsert({id:workId,title:c.title,original_title:c.title,alternative_titles:[],author_id:authorId,original_language:m.original_language,available_languages:m.original_language?[m.original_language]:[],publication_status:"draft"},{onConflict:"id"});
      if(error)throw new Error(`Work upsert: ${error.message}`);
    }
    else throw new Error("Multiple exact Work title matches; review required");

    // Register this now-confirmed identity for future lookups (section 10) so the next
    // candidate carrying the same workQid resolves via identity, not title matching again.
    // Idempotent; if a DIFFERENT work already claims this (scheme, external_id) -- a
    // genuine identity-vs-title disagreement -- the unique constraint silently rejects
    // this row rather than overwriting (section 4/9: never auto-pick a winner). The
    // ingestion itself still proceeds against the title-matched workId; the conflict is
    // left visible for a future reconciliation pass via the identifiers table itself.
    const{error:identityError}=await sb.from("work_external_identifiers").upsert(
      {work_id:workId,scheme:IDENTITY_SCHEME,external_id:normalizedQid,resolution_method:"wikisource-page-pageprops-confirmed-literary-work",provenance:{origin:"omnia-wikisource-ingest-one",wikiLanguage:l,authorQid,matchedViaTitle:!isNewWork}},
      {onConflict:"scheme,external_id",ignoreDuplicates:true}
    );
    if(identityError)console.error("work_external_identifiers upsert failed (non-fatal)",identityError);
  }

  // ---- section 13: conservative alternative-title handling ----
  // Only when this candidate's language edition is being attached to an EXISTING Work via
  // identity (not the brand-new-Work path, and not a same-title match where the title is
  // already redundant) do we consider recording its title as an alternative title -- and
  // only the deterministically-stripped form (no raw Wikisource "(Author)" disambiguation
  // suffix), and only if it isn't already present in any of the Work's known title fields.
  if(matchedViaIdentity && !isNewWork){
    const{data:workRow}=await sb.from("works").select("title,original_title,alternative_titles").eq("id",workId).maybeSingle();
    if(workRow){
      const known=[workRow.title,workRow.original_title,...(workRow.alternative_titles??[])].filter(Boolean).map((t:string)=>normalize(t));
      const cleanTitle=stripTrailingParen(c.title);
      if(cleanTitle && !known.includes(normalize(cleanTitle))){
        const nextAlt=[...(workRow.alternative_titles??[]),cleanTitle];
        await sb.from("works").update({alternative_titles:nextAlt}).eq("id",workId);
      }
    }
  }

  // ---- section 12: original_language / is_original point-fix ----
  // Previously this always wrote language: m.original_language ?? l and is_original: true,
  // unconditionally -- correct only by coincidence, because until now every candidate this
  // function ever processed was discovered on the SAME wiki language as the author's
  // registered original_language (confirmed empirically: zero live mismatches found). Now
  // that identity-first matching (above) can attach a candidate to an EXISTING Work in a
  // DIFFERENT language than this Wikisource page, language must always reflect the actual
  // fetched text's language (l), and is_original must be computed against the Work's own
  // actual original_language -- never assumed true, and never taken from the author record,
  // which is a default for NEW works only, not authoritative for an existing Work.
  const{data:workForLanguage}=await sb.from("works").select("original_language").eq("id",workId).maybeSingle();
  const workOriginalLanguage=workForLanguage?.original_language??null;
  const isOriginalEdition = workOriginalLanguage!==null ? (l===workOriginalLanguage) : true;

  const editionId=`${workId}-wikisource-${workQid.toLowerCase()}`,normalized={formatVersion:1,hasRealChapters:book.chapters.length>1,chapters:book.chapters},normalizedJson=JSON.stringify(normalized),safeQid=workQid.toLowerCase(),sourcePath=`sources/wikisource/${l}/${safeQid}/original.txt`,normalizedPath=`normalized/${editionId}/content.json`;
  const up1=await sb.storage.from("book-files").upload(sourcePath,book.sourceText,{contentType:"text/plain; charset=utf-8",upsert:true});if(up1.error)throw new Error(`source upload: ${up1.error.message}`);
  const up2=await sb.storage.from("book-files").upload(normalizedPath,normalizedJson,{contentType:"application/json",upsert:true});if(up2.error)throw new Error(`normalized upload: ${up2.error.message}`);
  const{error:ee}=await sb.from("editions").upsert({id:editionId,work_id:workId,language:l,is_original:isOriginalEdition,translator_name:null,source_id:SOURCE_ID,external_id:externalId,ingestion_status:"processing"},{onConflict:"id"});if(ee)throw new Error(`Edition upsert: ${ee.message}`);
  await sb.from("rights_assertions").delete().eq("edition_id",editionId);
  await sb.from("book_files").delete().eq("edition_id",editionId);
  const{data:files,error:fe}=await sb.from("book_files").insert([{edition_id:editionId,kind:"source",format:"plaintext",storage_path:sourcePath,byte_size:new TextEncoder().encode(book.sourceText).byteLength,ingestion_status:"ready"},{edition_id:editionId,kind:"normalized",format:"anki-json",storage_path:normalizedPath,byte_size:new TextEncoder().encode(normalizedJson).byteLength,ingestion_status:"ready"}]).select();if(fe||!files)throw new Error(`Book files: ${fe?.message}`);
  const nf=files.find((f:any)=>f.kind==="normalized");
  const{error:re}=await sb.from("rights_assertions").insert({edition_id:editionId,book_file_id:nf?.id??null,status:"unknown",jurisdiction:"DE"});if(re)throw new Error(`Rights placeholder: ${re.message}`);
  await sb.from("editions").update({ingestion_status:"ready"}).eq("id",editionId);
  await sb.from("master_corpus_candidates").update({status:"ready",work_id:workId,edition_id:editionId,last_error:null,processing_started_at:null,updated_at:new Date().toISOString()}).eq("id",c.id);
  return json({ok:true,status:"ingested",sourceId:SOURCE_ID,authorId,externalId,title:c.title,workId,editionId,chapters:book.chapters.length,textLength:book.textLength,rights:"unknown-DE-not-published",matchedViaIdentity,isOriginalEdition,editionLanguage:l});
}catch(e){const msg=e instanceof Error?e.message:String(e);await sb.from("master_corpus_candidates").update({status:"failed",last_error:msg,processing_started_at:null,next_attempt_at:new Date(Date.now()+10*60*1000).toISOString(),updated_at:new Date().toISOString()}).eq("id",c.id);return json({ok:false,status:"failed",authorId,externalId,title:c.title,error:msg},500);}});

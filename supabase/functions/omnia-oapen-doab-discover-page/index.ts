import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SOURCE_ID = "oapen";
const API = "https://library.oapen.org/rest/search";
const PAGE = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
}
async function sha256Hex(v: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function vals(item: any, key: string) {
  return (item?.metadata ?? []).filter((m: any) => m?.key === key).map((m: any) => String(m?.value ?? "").trim()).filter(Boolean);
}
function first(item: any, keys: string[]) {
  for (const k of keys) { const v = vals(item, k)[0]; if (v) return v; }
  return null;
}
function normLicense(raw: string | null) {
  if (!raw) return null;
  let s = raw.trim().replace(/^http:\/\//i, "https://");
  if (!s.endsWith("/")) s += "/";
  return s;
}
function licenseDecision(uri: string | null) {
  const u = normLicense(uri);
  if (!u) return null;
  if (/^https:\/\/creativecommons\.org\/licenses\/by\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)\/$/i.test(u)) return { status: "open-license", licenseUri: u, kind: "cc-by" };
  if (/^https:\/\/creativecommons\.org\/licenses\/by-sa\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)\/$/i.test(u)) return { status: "open-license", licenseUri: u, kind: "cc-by-sa" };
  if (/^https:\/\/creativecommons\.org\/publicdomain\/zero\/(?:1\.0\/)?$/i.test(u)) return { status: "open-license", licenseUri: u, kind: "cc0" };
  if (/^https:\/\/creativecommons\.org\/publicdomain\/mark\/(?:1\.0\/)?$/i.test(u)) return { status: "public-domain", licenseUri: u, kind: "public-domain-mark" };
  return null;
}
function downloadUrl(item: any) {
  const direct = first(item, ["oapen.identifier.downloadUrl"]);
  if (direct) return direct;
  for (const b of item?.bitstreams ?? []) {
    for (const m of b?.metadata ?? []) if (m?.key === "oapen.identifier.downloadUrl" && m?.value) return String(m.value);
    const link = String(b?.retrieveLink ?? b?.link ?? "");
    if (/^https?:\/\//i.test(link) && /\.(?:pdf|epub)(?:$|\?)/i.test(link)) return link;
  }
  return null;
}
function lang(item: any) { return first(item, ["dc.language", "dc.language.iso", "dc.language.other"]) ?? null; }
function pubYear(item: any) {
  const v = first(item, ["dc.date.issued", "dc.date.publication"]);
  const m = v?.match(/(?:1[5-9]|20)\d{2}/);
  return m ? Number(m[0]) : null;
}
function isBook(item: any) {
  const types = [...vals(item, "dc.type"), ...vals(item, "oapen.type")].map(v => v.toLowerCase());
  if (types.some(v => v.includes("chapter"))) return false;
  const pages = first(item, ["oapen.pages"]);
  const title = String(item?.name ?? first(item, ["dc.title"]) ?? "");
  if (/\bchapter\b/i.test(title) && pages) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const u = new URL(req.url);
  const token = req.headers.get("x-omnia-run-token") ?? u.searchParams.get("token") ?? "";
  if (!token) return json({ error: "Missing run token" }, 400);
  const base = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) return json({ error: "Missing server secrets" }, 500);
  const sb = createClient(base, key);
  const hash = await sha256Hex(token);
  const { data: rt } = await sb.from("master_corpus_run_tokens").select("id,expires_at,remaining_calls").eq("token_hash", hash).maybeSingle();
  if (!rt || new Date(rt.expires_at).getTime() <= Date.now() || rt.remaining_calls <= 0) return json({ error: "Invalid, expired, or exhausted token" }, 401);
  await sb.from("master_corpus_run_tokens").update({ remaining_calls: rt.remaining_calls - 1, last_used_at: new Date().toISOString() }).eq("id", rt.id).eq("remaining_calls", rt.remaining_calls);

  const { data: state } = await sb.from("provider_sync_state").select("metadata").eq("source_id", SOURCE_ID).maybeSingle();
  let offset = Number(state?.metadata?.offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  await sb.from("provider_sync_state").upsert({ source_id: SOURCE_ID, last_started_at: new Date().toISOString(), last_status: "running", last_error: null }, { onConflict: "source_id" });

  try {
    const q = new URL(API);
    q.searchParams.set("query", "*:*");
    q.searchParams.set("expand", "metadata,bitstreams");
    q.searchParams.set("limit", String(PAGE));
    q.searchParams.set("offset", String(offset));
    const r = await fetch(q.toString(), { headers: { Accept: "application/json", "User-Agent": "OmniaLibrary/1.0 (OAPEN metadata harvester)" } });
    if (!r.ok) throw new Error(`OAPEN REST HTTP ${r.status}`);
    const items = await r.json();
    if (!Array.isArray(items)) throw new Error("Unexpected OAPEN response");

    let accepted = 0, noAuthor = 0, licenseRejected = 0, noDownload = 0, notBook = 0;
    const rows: any[] = [];
    for (const item of items) {
      if (!isBook(item)) { notBook++; continue; }
      const title = String(item?.name ?? first(item, ["dc.title"]) ?? "").trim();
      const externalId = String(item?.handle ?? item?.uuid ?? "").trim();
      if (!title || !externalId) continue;
      const authors = Array.from(new Set([...vals(item, "dc.contributor.author"), ...vals(item, "dc.creator")])).filter(Boolean);
      if (!authors.length) { noAuthor++; continue; }
      const decision = licenseDecision(first(item, ["dc.rights.uri"]));
      if (!decision) { licenseRejected++; continue; }
      const dl = downloadUrl(item);
      if (!dl || !/^https?:\/\//i.test(dl)) { noDownload++; continue; }
      const subjects = Array.from(new Set([...vals(item, "dc.subject"), ...vals(item, "dc.subject.classification")])).slice(0, 30);
      const format = /\.epub(?:$|\?)/i.test(dl) ? "epub" : /\.pdf(?:$|\?)/i.test(dl) ? "pdf" : "other";
      rows.push({
        source_id: SOURCE_ID, external_id: externalId, title, contributor_names: authors,
        language: lang(item), publication_year: pubYear(item), license_uri: decision.licenseUri,
        download_url: dl, subject_tags: subjects, content_kind: "book", status: "discovered", rights_decision: "allow",
        provider_metadata: { oapenUuid: item?.uuid ?? null, handle: item?.handle ?? null, licenseKind: decision.kind, licenseStatus: decision.status, sourceFormat: format, doi: first(item, ["dc.identifier.doi"]), publisher: first(item, ["dc.publisher"]), isbn: vals(item, "dc.identifier.isbn") },
        updated_at: new Date().toISOString()
      });
      accepted++;
    }
    if (rows.length) {
      const { error } = await sb.from("open_book_candidates").upsert(rows, { onConflict: "source_id,external_id", ignoreDuplicates: true });
      if (error) throw new Error(`Candidate upsert: ${error.message}`);
    }
    const nextOffset = items.length < PAGE ? 0 : offset + PAGE;
    await sb.from("provider_sync_state").upsert({ source_id: SOURCE_ID, last_completed_at: new Date().toISOString(), last_status: "ok", last_count: accepted, last_error: null, metadata: { offset: nextOffset, lastBatchSize: items.length, lastBatchAccepted: accepted, cycleComplete: items.length < PAGE, endpoint: "OAPEN Library" } }, { onConflict: "source_id" });
    return json({ ok: true, sourceId: SOURCE_ID, offset, items: items.length, accepted, noAuthor, licenseRejected, noDownload, notBook, nextOffset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("provider_sync_state").upsert({ source_id: SOURCE_ID, last_completed_at: new Date().toISOString(), last_status: "failed", last_error: msg }, { onConflict: "source_id" });
    return json({ ok: false, error: msg }, 500);
  }
});

/**
 * website-lead edge function v6
 * Receives form submissions from Fluoron website.
 * Writes ONLY to web_inquiries table — no deals/contacts/companies.
 * Promotion to CRM is a manual human step in the Web Inquiries triage UI.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Internal domains/cities to silently skip
const INTERNAL_EMAILS = ["@fluoron.com", "@aegis-advanced.com", "@spectrumadvanced.com", "@spectrumlab"];
const INTERNAL_CITIES = ["newark", "elkton"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    // ── Internal traffic filter ───────────────────────────────────────────────
    const email = (payload.email ?? "").toLowerCase();
    const city  = (payload.city ?? "").toLowerCase();

    if (INTERNAL_EMAILS.some(d => email.endsWith(d))) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "internal_email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (INTERNAL_CITIES.some(c => city.includes(c))) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "internal_city" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Deduplicate: check if this email already has a pending inquiry ────────
    const { data: existing } = await supabase
      .from("web_inquiries")
      .select("id, draft_status")
      .ilike("email", email)
      .in("draft_status", ["pending_review"])
      .limit(1);

    if (existing && existing.length > 0) {
      // Already pending — update the existing record instead of creating duplicate
      await supabase
        .from("web_inquiries")
        .update({ form_fields: payload, submitted_at: new Date().toISOString() })
        .eq("id", existing[0].id);

      return new Response(JSON.stringify({ ok: true, deduplicated: true, id: existing[0].id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Build the web_inquiry record ──────────────────────────────────────────
    const firstName = payload.first_name || ((payload.full_name || "").split(" ")[0] || "");
    const lastName  = payload.last_name  || ((payload.full_name || "").split(" ").slice(1).join(" ") || "");
    const fullName  = payload.full_name  || ([firstName, lastName].filter(Boolean).join(" ") || payload.name || "");

    const record: Record<string, unknown> = {
      submitted_at:       new Date().toISOString(),
      name:               fullName,
      first_name:         firstName,
      last_name:          lastName,
      email:              payload.email ?? null,
      phone:              payload.phone ?? null,
      company:            payload.company ?? null,
      message:            payload.message ?? null,
      job_title:          payload.title ?? payload.job_title ?? null,
      industry:           payload.industry_segment ?? payload.industry ?? null,
      product_interest:   payload.product_interest ?? null,
      form_type_detail:   payload.form_type_detail ?? payload.form_type ?? null,
      utm_source:         payload.utm_source ?? null,
      utm_medium:         payload.utm_medium ?? null,
      utm_campaign:       payload.utm_campaign ?? null,
      draft_status:       "pending_review",
      routing_status:     "unassigned",
      // Store full payload as form_fields for complete record
      form_fields:        payload,
    };

    // ── MQL/TQL auto-scoring ──────────────────────────────────────────────────
    let mqlScore = 0;
    const ff = payload; // form fields alias

    // MQL scoring (out of 100)
    if (ff.qual_issue_type)        mqlScore += 20;
    if (ff.qual_buying_role)       mqlScore += 20;
    if (ff.qual_urgency)           mqlScore += 20;
    if (ff.qual_current_solution)  mqlScore += 15;
    if (ff.qual_process_type || ff.industry_segment) mqlScore += 15;
    if (ff.product_interest)       mqlScore += 10;
    record.mql_score = mqlScore;

    let tqlScore = 0;
    // TQL scoring (out of 100) — requires spec data
    if (ff.spec_roll_type)         tqlScore += 25;
    if (ff.spec_diameter)          tqlScore += 20;
    if (ff.spec_face_length)       tqlScore += 20;
    if (ff.spec_substrate)         tqlScore += 20;
    if (ff.spec_temperature)       tqlScore += 15;
    record.tql_score = tqlScore;

    // ── Insert into web_inquiries ─────────────────────────────────────────────
    const { data: inserted, error } = await supabase
      .from("web_inquiries")
      .insert(record)
      .select("id")
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ ok: true, id: inserted?.id, mql_score: mqlScore, tql_score: tqlScore }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("website-lead error:", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

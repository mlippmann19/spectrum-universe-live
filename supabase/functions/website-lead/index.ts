/**
 * Spectrum Universe — Website Lead Webhook (Fluoron PDF download form)
 * Public endpoint — no auth required. CORS allows *.fluoron.com and localhost.
 *
 * Two form types:
 *   - pdf_download : minimal data (name + email), always Prospect stage
 *                   → inserts into web_inquiries, fires send-inquiry-reply (Brevo)
 *   - contact      : handled by handle-web-inquiry; falls through here as legacy
 *
 * Creates company / contact / deal with lead_source='website'.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── PDF catalogue — label (as sent by form checkbox) → public URL ─────────────
const PDF_MAP: Record<string, string> = {
  "Spectrum Advanced Capability Statement":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_CapabilityDoc_Final_Feb26-1-comp.pdf",
  "Fluoron Heat Shrink Fluoropolymer Sleeves":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_Fluoron_FullOfferingLeaveBehind_FinalComp_March26.pdf",
  "Fluoron Flexible Packaging Roll Cover Guide":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_FlexPackagingDoc_Final_March26comp-2.pdf",
  "Spectrum Advanced PFAS Statement":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_PFASStatement_Finalcomp_March26.pdf",
  // Alias variants
  "Fluoron Capability Statement":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_CapabilityDoc_Final_Feb26-1-comp.pdf",
  "Heat Shrink Fluoropolymer Sleeves":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_Fluoron_FullOfferingLeaveBehind_FinalComp_March26.pdf",
  "PFAS Statement":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_PFASStatement_Finalcomp_March26.pdf",
  "Flexible Packaging Roll Cover Guide":
    "https://newsite.fluoron.com/wp-content/uploads/sites/2/2026/05/SpectrumAdvanced_FlexPackagingDoc_Final_March26comp-2.pdf",
};

// ── State / Province / Country tables ────────────────────────────────────────
const US_STATES: Record<string, string> = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
  "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
  "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
  "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
  "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
  "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
  "District of Columbia":"DC","Puerto Rico":"PR",
};
const CA_PROVS: Record<string, string> = {
  "Alberta":"AB","British Columbia":"BC","Manitoba":"MB","New Brunswick":"NB",
  "Newfoundland and Labrador":"NL","Northwest Territories":"NT","Nova Scotia":"NS",
  "Nunavut":"NU","Ontario":"ON","Prince Edward Island":"PE","Quebec":"QC",
  "Saskatchewan":"SK","Yukon":"YT",
};
const COUNTRIES: Record<string, string> = {
  "United States":"US","United States of America":"US","USA":"US",
  "Canada":"CA","Mexico":"MX","United Kingdom":"GB","Germany":"DE",
  "France":"FR","Australia":"AU","Japan":"JP","China":"CN","India":"IN",
  "Brazil":"BR","Netherlands":"NL","Sweden":"SE","Italy":"IT","Spain":"ES",
};

function normState(s?: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  return US_STATES[t] ?? CA_PROVS[t] ?? (t.length <= 3 ? t.toUpperCase() : t);
}
function normCountry(c?: string | null, state?: string | null): string | null {
  if (!c) {
    if (state && Object.values(US_STATES).includes(state)) return "US";
    if (state && Object.values(CA_PROVS).includes(state)) return "CA";
    return null;
  }
  const t = c.trim();
  return COUNTRIES[t] ?? (t.length <= 3 ? t.toUpperCase() : "US");
}
function buildCompanyName(name: string, city: string|null, state: string|null, country: string|null): string {
  return [name, city, state, country].filter(Boolean).join(" - ");
}

// ── MQL scoring ───────────────────────────────────────────────────────────────
function scoreLead(p: any): { score: number; tqlReady: boolean } {
  let score = 0;
  if (p.first_name || p.full_name) score += 10;
  if (p.email)  score += 20;
  if (p.company || p.company_name) score += 20;
  if (p.phone)  score += 5;
  if (p.title)  score += 5;
  if (p.qual_issue_type)       score += 15;
  if (p.qual_process_type)     score += 10;
  if (p.qual_current_solution) score += 10;
  if (p.qual_urgency)          score += 10;
  if (p.qual_buying_role)      score += 5;
  const specFields = [
    "spec_roll_type","spec_roll_position","spec_diameter","spec_face_length",
    "spec_roll_material","spec_substrate","spec_temperature","spec_line_speed",
    "spec_environment","spec_failure_description","spec_current_sleeve","spec_failure_frequency",
  ];
  const specCount = specFields.filter(f => p[f]).length;
  score += specCount * 3;
  return { score, tqlReady: specCount >= 6 };
}

// ── Build PDF delivery email body ─────────────────────────────────────────────
function buildPdfEmail(firstName: string, pdfsRequested: string[]): { subject: string; body: string } {
  const pdfLines: string[] = [];
  const missing: string[] = [];

  for (const label of pdfsRequested) {
    const url = PDF_MAP[label];
    if (url) {
      pdfLines.push(`• ${label}\n  ${url}`);
    } else {
      missing.push(label);
      pdfLines.push(`• ${label}\n  https://fluoron.com/resources/`);
    }
  }
  if (missing.length) console.warn("PDF labels not in PDF_MAP:", missing.join(", "));

  const docBlock = pdfLines.length
    ? pdfLines.join("\n\n")
    : "• All Fluoron Resources\n  https://fluoron.com/resources/";

  const subject = "Your Fluoron Technical Literature";
  const body =
`Hi ${firstName},

Here are the Fluoron documents you requested — click to download directly:

${docBlock}

These are direct download links; no login or account needed.

If you'd like to discuss your application or get a product recommendation, reply to this email or call us at (410) 392-0220.

Best regards,
The Fluoron Team
Spectrum Advanced | info@spectrumadvanced.com | (410) 392-0220`;

  return { subject, body };
}

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-website-key",
  "Access-Control-Max-Age": "86400",
};
const jsonResp = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")   return jsonResp({ error: "Method not allowed" }, 405);

  let payload: any;
  try { payload = await req.json(); }
  catch { return jsonResp({ error: "Invalid JSON" }, 400); }

  // ── Parse names ───────────────────────────────────────────────────────────
  let first_name = (payload?.first_name ?? "").toString().trim();
  let last_name  = (payload?.last_name  ?? "").toString().trim();
  const full_name = (payload?.full_name ?? "").toString().trim();
  if ((!first_name || !last_name) && full_name) {
    const [first, ...rest] = full_name.split(/\s+/);
    if (!first_name) first_name = first || "";
    if (!last_name)  last_name  = rest.join(" ");
  }
  const email = (payload?.email ?? "").toString().trim();
  if (!first_name || !email) return jsonResp({ error: "first_name (or full_name) and email are required" }, 400);
  if (!last_name) last_name = "";

  const form_type = (payload?.form_type ?? "").toString().trim() || "contact";
  const phone      = payload?.phone?.toString().trim() || null;
  const title      = payload?.title?.toString().trim() || null;
  const rawCompany = (payload?.company_name?.toString().trim() || payload?.company?.toString().trim()) || null;
  const city       = payload?.city?.toString().trim() || null;
  const state      = normState(payload?.state);
  const country    = normCountry(payload?.country, state);
  const website    = payload?.website?.toString().trim() || null;
  const industry   = payload?.industry?.toString().trim() || null;
  const product_interest = payload?.product_interest?.toString().trim() || null;
  const message          = payload?.message?.toString().trim() || null;
  const page_url         = payload?.page_url?.toString().trim() || null;
  const form_type_detail = payload?.form_type_detail?.toString().trim() || null;

  const pdfs_requested: string[] = Array.isArray(payload?.pdfs_requested)
    ? payload.pdfs_requested.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  const qualSpecFields = {
    qual_issue_type:         payload?.qual_issue_type?.toString().trim()         || null,
    qual_process_type:       payload?.qual_process_type?.toString().trim()       || null,
    qual_current_solution:   payload?.qual_current_solution?.toString().trim()   || null,
    qual_buying_role:        payload?.qual_buying_role?.toString().trim()         || null,
    qual_urgency:            payload?.qual_urgency?.toString().trim()             || null,
    spec_roll_type:          payload?.spec_roll_type?.toString().trim()           || null,
    spec_roll_position:      payload?.spec_roll_position?.toString().trim()       || null,
    spec_diameter:           payload?.spec_diameter?.toString().trim()            || null,
    spec_face_length:        payload?.spec_face_length?.toString().trim()         || null,
    spec_roll_material:      payload?.spec_roll_material?.toString().trim()       || null,
    spec_substrate:          payload?.spec_substrate?.toString().trim()           || null,
    spec_temperature:        payload?.spec_temperature?.toString().trim()         || null,
    spec_line_speed:         payload?.spec_line_speed?.toString().trim()          || null,
    spec_environment:        payload?.spec_environment?.toString().trim()         || null,
    spec_failure_description:payload?.spec_failure_description?.toString().trim() || null,
    spec_current_sleeve:     payload?.spec_current_sleeve?.toString().trim()      || null,
    spec_failure_frequency:  payload?.spec_failure_frequency?.toString().trim()   || null,
    spec_budget:             payload?.budget?.toString().trim()                   || null,
    spec_spare_available:    payload?.spare_available?.toString().trim()          || null,
    spec_nip_pressure:       payload?.nip_pressure?.toString().trim()             || null,
    spec_surface_finish:     payload?.surface_finish?.toString().trim()           || null,
    spec_abrasion_concern:   payload?.abrasion_concern?.toString().trim()         || null,
    spec_static_concern:     payload?.static_concern?.toString().trim()           || null,
    spec_install_preference: payload?.install_preference?.toString().trim()       || null,
    spec_training_interest:  payload?.training_interest?.toString().trim()        || null,
  };

  const scoringPayload = { ...payload, company: rawCompany, company_name: rawCompany,
    first_name, last_name, full_name, email, phone, title, product_interest, message,
    city, state, ...qualSpecFields };
  const { score: mqlScore, tqlReady } = scoreLead(scoringPayload);

  // pdf_download is always Prospect; contact form advances by score
  const dealStage = form_type === "pdf_download" ? "prospect"
    : mqlScore >= 55 ? "mql" : mqlScore >= 30 ? "contact" : "prospect";

  const personName = `${first_name} ${last_name}`.trim();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const crmOwner = "Matt Lippmann";

  // ── Company upsert ────────────────────────────────────────────────────────
  let companyId: string | null = null;
  let canonicalName: string | null = null;

  if (rawCompany) {
    canonicalName = (city || state || country)
      ? buildCompanyName(rawCompany, city, state, country) : rawCompany;
    const { data: byCanonical } = await supabase.from("companies")
      .select("id").ilike("name", canonicalName).maybeSingle();
    if (byCanonical) {
      companyId = byCanonical.id;
    } else {
      const { data: newCo, error: coErr } = await supabase.from("companies")
        .insert({ name: canonicalName, city, state, country, website, industry_type: industry, bd_owner: crmOwner })
        .select("id").single();
      if (coErr) return jsonResp({ error: "DB error (company)", detail: coErr.message }, 500);
      companyId = newCo.id;
    }
  } else if (form_type !== "pdf_download") {
    canonicalName = (city || state || country)
      ? buildCompanyName(personName, city, state, country) : personName;
    const { data: byCanonical } = await supabase.from("companies")
      .select("id").ilike("name", canonicalName).maybeSingle();
    if (byCanonical) {
      companyId = byCanonical.id;
    } else {
      const { data: newCo, error: coErr } = await supabase.from("companies")
        .insert({ name: canonicalName, city, state, country, website, industry_type: industry, bd_owner: crmOwner })
        .select("id").single();
      if (coErr) return jsonResp({ error: "DB error (company)", detail: coErr.message }, 500);
      companyId = newCo.id;
    }
  }

  // ── Contact upsert ────────────────────────────────────────────────────────
  let contactId: string | null = null;
  const { data: byEmail } = await supabase.from("contacts").select("id").ilike("email", email).maybeSingle();
  if (byEmail) contactId = byEmail.id;
  if (!contactId && companyId) {
    const { data: byNameCo } = await supabase.from("contacts").select("id")
      .ilike("name", personName).eq("company_id", companyId).maybeSingle();
    if (byNameCo) contactId = byNameCo.id;
  }
  if (!contactId) {
    const { data: newC, error: cErr } = await supabase.from("contacts")
      .insert({ name: personName, email, phone, title, company_id: companyId,
                status: "prospect", contact_type: "bd", owner: crmOwner })
      .select("id").single();
    if (!cErr) contactId = newC.id;
  }

  // ── Deal notes ────────────────────────────────────────────────────────────
  const notesLines = [`Source: Fluoron Website (${form_type})`];
  if (product_interest) notesLines.push(`Product Interest: ${product_interest}`);
  if (message)          notesLines.push(`Message:\n${message}`);
  if (pdfs_requested.length) notesLines.push(`PDFs Requested: ${pdfs_requested.join(", ")}`);
  if (form_type_detail) notesLines.push(`Form Detail: ${form_type_detail}`);
  if (page_url)         notesLines.push(`Page: ${page_url}`);
  notesLines.push(`MQL Score: ${mqlScore}/100`);
  const dealNotes = notesLines.join("\n");

  // ── Deal upsert ───────────────────────────────────────────────────────────
  let dealId: string | null = null;
  let duplicateDeal = false;

  if (companyId) {
    const { data: existingDeal } = await supabase.from("deals")
      .select("id,contact_id,lead_source,stage")
      .eq("company_id", companyId).in("stage", ["prospect","contact","mql"]).maybeSingle();
    if (existingDeal) {
      dealId = existingDeal.id;
      duplicateDeal = true;
      const updates: Record<string, any> = { lead_source: "website", is_new_lead: true };
      if (contactId && !existingDeal.contact_id) updates.contact_id = contactId;
      const stageRank: Record<string, number> = { prospect: 0, contact: 1, mql: 2 };
      if ((stageRank[dealStage] ?? 0) > (stageRank[existingDeal.stage] ?? 0)) updates.stage = dealStage;
      const { data: existingFull } = await supabase.from("deals")
        .select(Object.keys(qualSpecFields).concat(["tql_ready"]).join(","))
        .eq("id", dealId).maybeSingle();
      if (existingFull) {
        for (const [key, val] of Object.entries(qualSpecFields)) {
          if (val && !(existingFull as any)[key]) updates[key] = val;
        }
        if (tqlReady && !(existingFull as any).tql_ready) updates.tql_ready = true;
      }
      await supabase.from("deals").update(updates).eq("id", dealId);
    }
  }

  if (!dealId) {
    const dealTitle = (form_type === "pdf_download" && !rawCompany)
      ? `${personName} — PDF Download Lead`
      : `${canonicalName ?? personName} — Website Lead`;
    const { data: newDeal, error: dErr } = await supabase.from("deals")
      .insert({ title: dealTitle, stage: dealStage, company_id: companyId, contact_id: contactId,
                owner: crmOwner, is_new_lead: true, lead_source: "website", notes: dealNotes,
                ...qualSpecFields, tql_ready: tqlReady })
      .select("id").single();
    if (dErr) return jsonResp({ error: "DB error (deal)", detail: dErr.message }, 500);
    dealId = newDeal.id;
    console.log("✓ Deal created:", dealTitle, "stage=", dealStage);
  }

  // ── Email via web_inquiries → send-inquiry-reply (Brevo) ─────────────────
  // For pdf_download: build PDF delivery email and auto-send via Brevo.
  // For contact: insert draft into web_inquiries for human review (handle-web-inquiry handles those).
  let emailSent = false;
  let webInquiryId: string | null = null;

  if (form_type === "pdf_download") {
    const { subject: emailSubject, body: emailBody } = buildPdfEmail(first_name, pdfs_requested);

    // Insert into web_inquiries
    const { data: wiq, error: wiqErr } = await supabase.from("web_inquiries").insert({
      name: personName,
      first_name,
      last_name,
      email,
      company:  rawCompany ?? "",
      phone:    phone ?? "",
      message:  pdfs_requested.length ? `PDFs requested: ${pdfs_requested.join(", ")}` : "PDF download",
      form_fields: { ...payload, form_type: "pdf_download" },
      ai_draft_subject: emailSubject,
      ai_draft_body:    emailBody,
      draft_status:     "pending_review",
      product_interest: product_interest ?? "",
      industry:         industry ?? "",
      mql_score:        mqlScore,
      tql_score:        0,
      mql_tier2:        { qual_urgency: "", qual_issue_type: "", qual_buying_role: "",
                          qual_process_type: "", qual_current_solution: "",
                          mql_breakdown: { need: false, budget: false, timing: false,
                                           identity: !!first_name, authority: false } },
      tql_tier3:        { tql_filled_fields: [] },
      utm_source:       payload?.utm_source ?? "",
      utm_medium:       payload?.utm_medium ?? "",
      utm_campaign:     payload?.utm_campaign ?? "",
      prospect_company_id: companyId,
      routing_status:   "unrouted",
    }).select("id").single();

    if (wiqErr) {
      console.error("web_inquiries insert:", wiqErr);
    } else {
      webInquiryId = wiq.id;
      console.log("✓ web_inquiries record created:", webInquiryId);

      // Fire send-inquiry-reply to deliver via Brevo immediately
      try {
        const sendResp = await fetch(
          `${SUPABASE_URL}/functions/v1/send-inquiry-reply`,
          {
            method: "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${SERVICE_KEY}`,
              "apikey":        SERVICE_KEY,
            },
            body: JSON.stringify({ inquiry_id: webInquiryId }),
          }
        );
        const sendResult = await sendResp.json().catch(() => ({}));
        if (sendResp.ok && sendResult?.message_id) {
          emailSent = true;
          console.log("✓ PDF delivery email sent via Brevo:", sendResult.message_id, "→", email);
        } else {
          console.error("send-inquiry-reply failed:", sendResp.status, JSON.stringify(sendResult));
        }
      } catch (err) {
        console.error("send-inquiry-reply threw:", err);
      }
    }

    // Log activity on the deal
    if (dealId) {
      const actSubject = emailSent
        ? `PDF delivery sent — ${pdfs_requested.join(", ")}`
        : `Draft PDF delivery — ${pdfs_requested.join(", ") || "pdf_download"}`;
      await supabase.from("activities").insert({
        deal_id: dealId, company_id: companyId, contact_id: contactId,
        type: "email", subject: actSubject, body: emailSent ? "Sent via Brevo" : "Draft — not yet sent",
        from_email: emailSent ? "info@spectrumadvanced.com" : null,
        to_email:   emailSent ? email : null,
        logged_by: crmOwner, direction: "outbound",
        occurred_at: new Date().toISOString(), assigned_to: crmOwner,
      });
    }
  }

  return jsonResp({
    ok: true,
    company: canonicalName,
    contact: personName,
    stage: dealStage,
    mql_score: mqlScore,
    deal_id: dealId,
    web_inquiry_id: webInquiryId,
    email_sent: emailSent,
    duplicate_deal: duplicateDeal,
  });
});

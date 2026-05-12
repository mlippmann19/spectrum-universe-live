/**
 * Spectrum Universe — Website Lead Webhook (Fluoron contact / PDF download forms)
 * Public endpoint — no auth required. CORS allows *.fluoron.com and localhost.
 *
 * Two form types:
 *   - pdf_download : minimal data (name + email), always Prospect stage
 *   - contact      : MQL-scoreable, auto-advances to Connected (contact) or MQL
 *
 * Creates company / contact / deal / activity with lead_source='website'.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── State / Province / Country lookup tables ──────────────────────────────────
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

function normState(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (US_STATES[trimmed]) return US_STATES[trimmed];
  if (CA_PROVS[trimmed]) return CA_PROVS[trimmed];
  if (trimmed.length <= 3) return trimmed.toUpperCase();
  return trimmed;
}

function normCountry(c: string | null | undefined, state: string | null): string | null {
  if (!c) {
    if (state && Object.values(US_STATES).includes(state)) return "US";
    if (state && Object.values(CA_PROVS).includes(state)) return "CA";
    return null;
  }
  const trimmed = c.trim();
  if (COUNTRIES[trimmed]) return COUNTRIES[trimmed];
  if (trimmed.length <= 3) return trimmed.toUpperCase();
  return "US";
}

function buildCompanyName(name: string, city: string | null, state: string | null, country: string | null): string {
  const parts = [name];
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (country) parts.push(country);
  return parts.join(" - ");
}

// ── MQL scoring ──────────────────────────────────────────────────────────────
function scoreLead(payload: any): { score: number; tqlReady: boolean } {
  let score = 0;
  // Tier 1
  if (payload.first_name || payload.full_name) score += 10;
  if (payload.email) score += 20;
  if (payload.company || payload.company_name) score += 20;
  if (payload.phone) score += 5;
  if (payload.title) score += 5;
  // Tier 2 — MQL
  if (payload.qual_issue_type) score += 15;
  if (payload.qual_process_type) score += 10;
  if (payload.qual_current_solution) score += 10;
  if (payload.qual_urgency) score += 10;
  if (payload.qual_buying_role) score += 5;
  // Tier 3 — TQL
  const specFields = [
    "spec_roll_type","spec_roll_position","spec_diameter","spec_face_length",
    "spec_roll_material","spec_substrate","spec_temperature","spec_line_speed",
    "spec_environment","spec_failure_description","spec_current_sleeve","spec_failure_frequency"
  ];
  const specCount = specFields.filter(f => payload[f]).length;
  score += specCount * 3;
  const tqlReady = specCount >= 6;
  return { score, tqlReady };
}

// ── Stage routing ────────────────────────────────────────────────────────────
// Note: the deals table uses "prospect" for raw leads, "contact" for the
// "connected" tier of the BD pipeline, and "mql" for marketing-qualified leads.
function determineStage(formType: string, score: number): string {
  if (formType === "pdf_download") return "prospect";
  if (score >= 55) return "mql";
  if (score >= 30) return "contact";
  return "prospect";
}

// ── Follow-up email drafting ─────────────────────────────────────────────────
function draftFollowUpEmail(opts: {
  formType: string;
  firstName: string;
  score: number;
  payload: any;
  ownerName: string;
}): { subject: string; body: string } {
  const { formType, firstName, score, payload, ownerName } = opts;

  if (formType === "pdf_download") {
    const subject = "Your Fluoron Technical Literature";
    const body =
`Subject: ${subject}

Hi ${firstName},

Thank you for downloading our technical literature! We hope it gives you a good overview of our fluoropolymer sleeve capabilities.

To make sure we connect you with the right resources, could you share a couple of quick details?
1. What company are you with and what industry?
2. Which product are you evaluating? (FEP, PFA, PTFE, or Conductive PTFE)
3. What challenge are you trying to solve? (release, wear, corrosion, buildup, contamination, etc.)

If you'd prefer to speak directly with an engineer, call us at (800) XXX-XXXX or simply reply to this email.

Best regards,
The Fluoron Team`;
    return { subject, body };
  }

  // Contact form
  if (score >= 55) {
    const productLabel = (payload.product_interest && payload.product_interest.trim())
      ? payload.product_interest.trim()
      : "Sleeve Specification";
    const subject = `Re: Your Fluoron Inquiry — ${productLabel}`;

    const specLines: string[] = [];
    if (payload.roll_diameter)            specLines.push(`- Roll Diameter: ${payload.roll_diameter}`);
    if (payload.face_length)              specLines.push(`- Face Length: ${payload.face_length}`);
    if (payload.current_roller_material)  specLines.push(`- Current Material: ${payload.current_roller_material}`);
    if (payload.environment)              specLines.push(`- Environment: ${payload.environment}`);
    if (payload.operating_temperature)    specLines.push(`- Operating Temperature: ${payload.operating_temperature}`);
    if (payload.line_speed)               specLines.push(`- Line Speed: ${payload.line_speed}`);
    if (payload.failure_description)      specLines.push(`- Failure Description: ${payload.failure_description}`);
    if (payload.timeline)                 specLines.push(`- Timeline: ${payload.timeline}`);

    const specsBlock = specLines.length
      ? `\nWe've noted the following application details:\n${specLines.join("\n")}\n`
      : "";

    const body =
`Subject: ${subject}

Hi ${firstName},

Thank you for the detailed inquiry! Our engineering team has received your request and will follow up within one business day with a product recommendation.
${specsBlock}
If anything changes or you have additional specs to share, just reply.

Best regards,
${ownerName}
Spectrum Advanced / Fluoron`;
    return { subject, body };
  }

  // Contact form, score < 55
  const subject = "Re: Your Fluoron Inquiry";
  const missingQs: string[] = [];
  if (!(payload.company || payload.company_name)) missingQs.push("- What company are you with?");
  if (!payload.product_interest)                  missingQs.push("- What product(s) are you evaluating?");
  if (!payload.message || (payload.message || "").length <= 40) {
    missingQs.push("- Can you describe your current roller challenge in a bit more detail?");
  }
  if (!payload.timeline) missingQs.push("- What's your timeline?");

  const missingBlock = missingQs.length
    ? `\nTo prepare a product spec for you, our team needs a few more details:\n${missingQs.join("\n")}\n`
    : "";

  const body =
`Subject: ${subject}

Hi ${firstName},

Thank you for reaching out! We received your message and want to make sure we get you the right recommendation.
${missingBlock}
If you'd prefer to talk through it live, call us at (800) XXX-XXXX.

Best regards,
${ownerName}
Spectrum Advanced / Fluoron`;
  return { subject, body };
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-website-key",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  // ── Name handling: support full_name as alias for first_name + last_name ──
  let first_name = (payload?.first_name ?? "").toString().trim();
  let last_name  = (payload?.last_name  ?? "").toString().trim();
  const full_name = (payload?.full_name ?? "").toString().trim();
  if ((!first_name || !last_name) && full_name) {
    const parts = full_name.split(/\s+/);
    const [first, ...rest] = parts;
    if (!first_name) first_name = first || "";
    if (!last_name)  last_name  = rest.join(" ");
  }

  const email = (payload?.email ?? "").toString().trim();

  if (!first_name || !email) {
    return jsonResponse({ error: "first_name (or full_name) and email are required" }, 400);
  }
  // last_name optional when full_name only has one token
  if (!last_name) last_name = "";

  const form_type = (payload?.form_type ?? "").toString().trim() || "contact";

  // ── Common fields ────────────────────────────────────────────────────────
  const phone   = payload?.phone?.toString().trim() || null;
  const title   = payload?.title?.toString().trim() || null;
  // "company" is an alias for "company_name"
  const rawCompany =
    (payload?.company_name?.toString().trim() || payload?.company?.toString().trim()) || null;
  const city    = payload?.city?.toString().trim() || null;
  const state   = normState(payload?.state);
  const country = normCountry(payload?.country, state);
  const website = payload?.website?.toString().trim() || null;
  const industry = payload?.industry?.toString().trim() || null;

  const product_interest = payload?.product_interest?.toString().trim() || null;
  const message          = payload?.message?.toString().trim() || null;
  const page_url         = payload?.page_url?.toString().trim() || null;
  const form_type_detail = payload?.form_type_detail?.toString().trim() || null;

  // Roller-spec fields (free-form)
  const roll_diameter           = payload?.roll_diameter?.toString().trim() || null;
  const face_length             = payload?.face_length?.toString().trim() || null;
  const current_roller_material = payload?.current_roller_material?.toString().trim() || null;
  const environment             = payload?.environment?.toString().trim() || null;
  const operating_temperature   = payload?.operating_temperature?.toString().trim() || null;
  const line_speed              = payload?.line_speed?.toString().trim() || null;
  const failure_description     = payload?.failure_description?.toString().trim() || null;
  const timeline                = payload?.timeline?.toString().trim() || null;

  // PDF download fields
  const pdfs_requested: string[] = Array.isArray(payload?.pdfs_requested)
    ? payload.pdfs_requested.map((s: any) => String(s).trim()).filter((s: string) => s.length > 0)
    : [];

  // ── Tier 2 / Tier 3 qualification fields (structured) ───────────────────────
  const qualSpecFields = {
    qual_issue_type: payload?.qual_issue_type?.toString().trim() || null,
    qual_process_type: payload?.qual_process_type?.toString().trim() || null,
    qual_current_solution: payload?.qual_current_solution?.toString().trim() || null,
    qual_buying_role: payload?.qual_buying_role?.toString().trim() || null,
    qual_urgency: payload?.qual_urgency?.toString().trim() || null,
    spec_roll_type: payload?.spec_roll_type?.toString().trim() || null,
    spec_roll_position: payload?.spec_roll_position?.toString().trim() || null,
    spec_diameter: payload?.spec_diameter?.toString().trim() || null,
    spec_face_length: payload?.spec_face_length?.toString().trim() || null,
    spec_roll_material: payload?.spec_roll_material?.toString().trim() || null,
    spec_substrate: payload?.spec_substrate?.toString().trim() || null,
    spec_temperature: payload?.spec_temperature?.toString().trim() || null,
    spec_line_speed: payload?.spec_line_speed?.toString().trim() || null,
    spec_environment: payload?.spec_environment?.toString().trim() || null,
    spec_failure_description: payload?.spec_failure_description?.toString().trim() || null,
    spec_current_sleeve: payload?.spec_current_sleeve?.toString().trim() || null,
    spec_failure_frequency: payload?.spec_failure_frequency?.toString().trim() || null,
    spec_budget: payload?.budget?.toString().trim() || null,
    spec_spare_available: payload?.spare_available?.toString().trim() || null,
    spec_nip_pressure: payload?.nip_pressure?.toString().trim() || null,
    spec_surface_finish: payload?.surface_finish?.toString().trim() || null,
    spec_abrasion_concern: payload?.abrasion_concern?.toString().trim() || null,
    spec_static_concern: payload?.static_concern?.toString().trim() || null,
    spec_install_preference: payload?.install_preference?.toString().trim() || null,
    spec_training_interest: payload?.training_interest?.toString().trim() || null,
  };

  // Normalised payload for scoring (so aliases work cleanly)
  const scoringPayload = {
    ...payload,
    company: rawCompany,
    company_name: rawCompany,
    first_name, last_name, full_name,
    email, phone, title, product_interest, message, city, state,
    roll_diameter, face_length, current_roller_material,
    environment, operating_temperature, failure_description,
    ...qualSpecFields,
  };
  const { score: mqlScore, tqlReady } = scoreLead(scoringPayload);
  const dealStage = determineStage(form_type, mqlScore);

  const personName = `${first_name} ${last_name}`.trim();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const crmOwner = "Matt Lippmann";

  // ── Company upsert (skipped for pdf_download with no company) ───────────────
  let companyId: string | null = null;
  let canonicalName: string | null = null;

  if (rawCompany) {
    canonicalName = (city || state || country)
      ? buildCompanyName(rawCompany, city, state, country)
      : rawCompany;

    const { data: byCanonical } = await supabase.from("companies").select("id")
      .ilike("name", canonicalName).maybeSingle();
    if (byCanonical) {
      companyId = byCanonical.id;
      console.log("Company exists:", canonicalName);
    } else {
      const { data: newCo, error: coErr } = await supabase.from("companies")
        .insert({
          name: canonicalName,
          city, state, country,
          website,
          industry_type: industry,
          bd_owner: crmOwner,
        })
        .select("id").single();
      if (coErr) {
        console.error("Company insert:", coErr);
        return jsonResponse({ error: "DB error (company)", detail: coErr.message }, 500);
      }
      companyId = newCo.id;
      console.log("✓ Company created:", canonicalName);
    }
  } else if (form_type === "pdf_download") {
    console.log("pdf_download with no company — skipping company upsert");
  } else {
    // Contact form with no company: fall back to person's name as company
    canonicalName = (city || state || country)
      ? buildCompanyName(personName, city, state, country)
      : personName;

    const { data: byCanonical } = await supabase.from("companies").select("id")
      .ilike("name", canonicalName).maybeSingle();
    if (byCanonical) {
      companyId = byCanonical.id;
    } else {
      const { data: newCo, error: coErr } = await supabase.from("companies")
        .insert({
          name: canonicalName,
          city, state, country,
          website,
          industry_type: industry,
          bd_owner: crmOwner,
        })
        .select("id").single();
      if (coErr) {
        console.error("Company insert:", coErr);
        return jsonResponse({ error: "DB error (company)", detail: coErr.message }, 500);
      }
      companyId = newCo.id;
    }
  }

  // ── Upsert contact ──────────────────────────────────────────────────────────
  let contactId: string | null = null;
  if (email) {
    const { data: byEmail } = await supabase.from("contacts").select("id")
      .ilike("email", email).maybeSingle();
    if (byEmail) contactId = byEmail.id;
  }
  if (!contactId && companyId) {
    const { data: byNameCo } = await supabase.from("contacts").select("id")
      .ilike("name", personName).eq("company_id", companyId).maybeSingle();
    if (byNameCo) contactId = byNameCo.id;
  }
  if (!contactId) {
    const { data: newC, error: cErr } = await supabase.from("contacts")
      .insert({
        name: personName, email, phone, title,
        company_id: companyId, status: "prospect",
        contact_type: "bd", owner: crmOwner,
      })
      .select("id").single();
    if (cErr) {
      console.error("Contact insert:", cErr);
    } else {
      contactId = newC.id;
      console.log("✓ Contact created:", personName);
    }
  }

  // ── Build deal notes ────────────────────────────────────────────────────────
  const notesLines: string[] = [];
  notesLines.push(`Source: Fluoron Website (${form_type})`);
  if (product_interest) notesLines.push(`Product Interest: ${product_interest}`);
  if (message)          notesLines.push(`Message:\n${message}`);

  const specSheet: string[] = [];
  if (roll_diameter)           specSheet.push(`  Roll Diameter: ${roll_diameter}`);
  if (face_length)             specSheet.push(`  Face Length: ${face_length}`);
  if (current_roller_material) specSheet.push(`  Current Material: ${current_roller_material}`);
  if (environment)             specSheet.push(`  Environment: ${environment}`);
  if (operating_temperature)   specSheet.push(`  Operating Temperature: ${operating_temperature}`);
  if (line_speed)              specSheet.push(`  Line Speed: ${line_speed}`);
  if (failure_description)     specSheet.push(`  Failure Description: ${failure_description}`);
  if (timeline)                specSheet.push(`  Timeline: ${timeline}`);
  if (specSheet.length) notesLines.push(`Roller Specs:\n${specSheet.join("\n")}`);

  if (pdfs_requested.length) notesLines.push(`PDFs Requested: ${pdfs_requested.join(", ")}`);
  if (form_type_detail) notesLines.push(`Form Detail: ${form_type_detail}`);
  if (page_url)         notesLines.push(`Page: ${page_url}`);
  notesLines.push(`MQL Score: ${mqlScore}/100`);

  if (form_type === "pdf_download" && !rawCompany) {
    notesLines.push("---");
    notesLines.push("No company or product context provided. Follow-up email drafted.");
  }
  const dealNotes = notesLines.join("\n");

  // ── Deal: skip duplicate if an active deal already exists for this company ──
  let dealId: string | null = null;
  let duplicateDeal = false;

  if (companyId) {
    const { data: existingDeal } = await supabase.from("deals")
      .select("id,contact_id,lead_source,stage")
      .eq("company_id", companyId)
      .in("stage", ["prospect", "contact", "mql"])
      .maybeSingle();

    if (existingDeal) {
      dealId = existingDeal.id;
      duplicateDeal = true;
      const updates: Record<string, any> = {};
      if (contactId && !existingDeal.contact_id) updates.contact_id = contactId;
      // Promote stage if new submission scores higher
      const stageRank: Record<string, number> = { prospect: 0, contact: 1, mql: 2 };
      if ((stageRank[dealStage] ?? 0) > (stageRank[existingDeal.stage] ?? 0)) {
        updates.stage = dealStage;
      }
      // Overwrite null qual_*/spec_* fields with values from new submission
      const { data: existingFull } = await supabase.from("deals")
        .select(Object.keys(qualSpecFields).concat(["tql_ready"]).join(","))
        .eq("id", dealId).maybeSingle();
      if (existingFull) {
        for (const [key, val] of Object.entries(qualSpecFields)) {
          if (val && !(existingFull as any)[key]) {
            updates[key] = val;
          }
        }
        if (tqlReady && !(existingFull as any).tql_ready) {
          updates.tql_ready = true;
        }
      }
      if (Object.keys(updates).length) {
        await supabase.from("deals").update(updates).eq("id", dealId);
      }
      console.log("Active deal exists for company — not creating duplicate.");
    }
  }

  if (!dealId) {
    const dealTitle = (form_type === "pdf_download" && !rawCompany)
      ? `${personName} — PDF Download Lead`
      : `${canonicalName ?? personName} — Website Lead`;

    const { data: newDeal, error: dErr } = await supabase.from("deals")
      .insert({
        title: dealTitle,
        stage: dealStage,
        company_id: companyId,
        contact_id: contactId,
        owner: crmOwner,
        is_new_lead: true,
        lead_source: "website",
        notes: dealNotes,
        ...qualSpecFields,
        tql_ready: tqlReady,
      })
      .select("id").single();
    if (dErr) {
      console.error("Deal insert:", dErr);
      return jsonResponse({ error: "DB error (deal)", detail: dErr.message }, 500);
    }
    dealId = newDeal.id;
    console.log("✓ Deal created:", dealTitle, "stage=", dealStage);
  }

  // ── Activity: follow-up email (sent via Resend, or drafted if unavailable) ──
  if (dealId) {
    const { subject: emailSubject, body: emailBodyRaw } = draftFollowUpEmail({
      formType: form_type,
      firstName: first_name,
      score: mqlScore,
      payload: scoringPayload,
      ownerName: crmOwner,
    });

    // Strip the leading "Subject: ...\n\n" line — that's for activity display only.
    const emailBody = emailBodyRaw.replace(/^Subject:[^\n]*\n\n?/, "");

    let emailSent = false;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("RESEND_API_KEY missing — skipping email send, logging draft only.");
    } else {
      try {
        const resendResp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Fluoron <info@fluoron.com>",
            to: [email],
            subject: emailSubject,
            text: emailBody,
          }),
        });
        if (resendResp.ok) {
          const result = await resendResp.json().catch(() => ({}));
          emailSent = true;
          console.log("✓ Resend email sent:", result?.id ?? "(no id)");
        } else {
          const errBody = await resendResp.text().catch(() => "");
          console.error("Resend send failed:", resendResp.status, errBody);
        }
      } catch (err) {
        console.error("Resend send threw:", err);
      }
    }

    const activitySubject = emailSent
      ? "Follow-up email sent"
      : `Draft follow-up email — ${form_type}`;

    await supabase.from("activities").insert({
      deal_id: dealId, company_id: companyId, contact_id: contactId,
      type: "email",
      subject: activitySubject,
      body: emailBody,
      logged_by: crmOwner,
      occurred_at: new Date().toISOString(),
      assigned_to: crmOwner,
    });
    console.log(`✓ Activity logged (${emailSent ? "sent" : "draft"}):`, emailSubject);
  }

  return jsonResponse({
    ok: true,
    company: canonicalName,
    contact: personName,
    stage: dealStage,
    mql_score: mqlScore,
    deal_id: dealId,
    duplicate_deal: duplicateDeal,
  });
});

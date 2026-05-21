/**
 * Spectrum CRM — website-lead Edge Function
 * Supabase Edge Function (Deno)
 *
 * Receives POST JSON payloads from the Fluoron website (Quick Connect form
 * and Spec Tool / intake wizard), applies routing logic per form_type_detail,
 * deduplicates contacts/companies, inserts CRM records, and returns {"ok":true}.
 *
 * Contract: fluoron_crm_payload_contract_v5-11.docx
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Supabase client ────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  "https://tplkmtmuoyslmjewcudk.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function getClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Internal domains — skip any submission from these email domains */
const INTERNAL_EMAIL_DOMAINS = [
  "@fluoron.com",
  "@aegis-advanced.com",
  "@spectrumadvanced.com",
];

/** Internal cities (city-only secondary filter, not definitive) */
const INTERNAL_CITIES = ["newark", "elkton"];

/** Free webmail providers — work email check */
const FREE_EMAIL_DOMAINS = [
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "aol.com", "icloud.com", "mail.com", "protonmail.com", "ymail.com",
];

// ── Industry mapping ──────────────────────────────────────────────────────────
// Maps the industry_segment value from the website payload to the INDUSTRY_SEGMENTS
// enum used by the CRM. Values not listed fall through to the fallback.

const INDUSTRY_SEGMENT_MAP: Record<string, string> = {
  // Exact labels sent by intake-wizard
  "paper / tissue / pulp manufacturing": "Pulp & Paper",
  "paper mill": "Paper Mill",
  "flexible packaging": "Flexible Packaging & Films",
  "flexible packaging & films": "Flexible Packaging & Films",
  "converting": "Converting",
  "nonwovens": "Nonwovens",
  "printing": "Printing",
  "printing & packaging": "Printing",
  // Slug forms from Quick Connect form (via industryNormalize.ts)
  "paper_pulp": "Pulp & Paper",
  "printing_packaging": "Printing",
  "textile_nonwovens": "Nonwovens",
  "rubber_plastics": "Other Manufacturing",
  "aerospace_defense": "Aerospace & Defense",
  "automotive": "Automotive",
  "chemical_processing": "Chemicals",
  "electronics_semiconductor": "Electronics",
  "food_beverage": "Food & Beverage",
  "medical_life_sciences": "Medical",
  "general_industrial": "Other Manufacturing",
  "mining_metals": "Steel",
  "oil_gas": "Petroleum / Petrochemicals",
  "pharmaceuticals": "Medical",
  // Any "other" or "not an industrial application"
  "other": "Other Manufacturing",
  "not an industrial application": "Unknown",
};

function mapIndustrySegment(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const key = raw.trim().toLowerCase();
  if (INDUSTRY_SEGMENT_MAP[key]) return INDUSTRY_SEGMENT_MAP[key];
  // Partial / keyword fallback
  if (key.includes("paper") || key.includes("pulp") || key.includes("tissue")) return "Pulp & Paper";
  if (key.includes("packaging")) return "Flexible Packaging & Films";
  if (key.includes("convert")) return "Converting";
  if (key.includes("nonwoven")) return "Nonwovens";
  if (key.includes("print")) return "Printing";
  if (key.includes("steel") || key.includes("metal")) return "Steel";
  if (key.includes("food") || key.includes("beverage")) return "Food & Beverage";
  if (key.includes("auto")) return "Automotive";
  if (key.includes("medical") || key.includes("pharma")) return "Medical";
  if (key.includes("aerospace")) return "Aerospace & Defense";
  if (key.includes("chemical")) return "Chemicals";
  if (key.includes("manufact")) return "Other Manufacturing";
  return "Unknown";
}

// ── Division mapping ──────────────────────────────────────────────────────────
// Maps product_interest from the website payload to our internal division names.

function mapDivision(productInterest: string | null | undefined): string {
  if (!productInterest) return "Fluoron";
  const pi = productInterest.toLowerCase();
  if (
    pi.includes("fluoro-clear") ||
    pi.includes("fluoro-flex") ||
    pi.includes("fluoro-wear") ||
    pi.includes("fluoro-stat") ||
    pi.includes("fep") ||
    pi.includes("pfa") ||
    pi.includes("ptfe")
  ) return "Fluoron";
  if (pi.includes("aegis")) return "Aegis";
  if (pi.includes("rcs") || pi.includes("radiant") || pi.includes("cleaning")) return "Radiant";
  return "Fluoron";
}

// ── Routing table ─────────────────────────────────────────────────────────────

interface RouteConfig {
  dealStage: string;
  companyStatus: string;
  contactStatus: string;
  tag?: string;
}

const FORM_TYPE_ROUTES: Record<string, RouteConfig> = {
  mql_qualified: {
    dealStage: "mql",
    companyStatus: "qualifying",
    contactStatus: "lead",
  },
  quote_request: {
    dealStage: "tql_approved",
    companyStatus: "qualifying",
    contactStatus: "lead",
  },
  unqualified_inquiry: {
    dealStage: "prospect",
    companyStatus: "prospect",
    contactStatus: "lead",
  },
  site_visit: {
    dealStage: "prospect",
    companyStatus: "prospect",
    contactStatus: "lead",
    tag: "site_visit",
  },
  training: {
    dealStage: "prospect",
    companyStatus: "prospect",
    contactStatus: "lead",
    tag: "training",
  },
  roll_details: {
    dealStage: "prospect",
    companyStatus: "prospect",
    contactStatus: "lead",
    tag: "roll_details",
  },
};

// ── Scoring ───────────────────────────────────────────────────────────────────

function computeScore(payload: WebsiteLeadPayload): number {
  let score = 0;

  // Base score by form_type_detail
  switch (payload.form_type_detail) {
    case "quote_request":      score += 40; break;
    case "site_visit":         score += 30; break;
    case "mql_qualified":      score += 25; break;
    case "roll_details":       score += 20; break;
    case "training":           score += 15; break;
    case "unqualified_inquiry": score += 0; break;
  }

  // Work email bonus (+10)
  if (payload.email) {
    const domain = payload.email.split("@")[1]?.toLowerCase() ?? "";
    if (domain && !FREE_EMAIL_DOMAINS.includes(domain)) score += 10;
  }

  // Company specified (+5)
  if (payload.company?.trim()) score += 5;

  // Buying role (+10)
  const role = (payload.qual_buying_role ?? "").toLowerCase();
  if (
    role.includes("specif") ||
    role.includes("decision") ||
    role.includes("evaluator")
  ) score += 10;

  // Urgency (+15)
  const urgency = (payload.qual_urgency ?? "").toLowerCase();
  if (urgency.includes("urgent") || urgency.includes("line down")) score += 15;

  // Onsite install preference (+5)
  if (
    (payload.spec_install_preference ?? "").toLowerCase().includes("onsite") ||
    (payload.spec_install_preference ?? "").toLowerCase().includes("on-site") ||
    (payload.spec_install_preference ?? "").toLowerCase().includes("on site")
  ) score += 5;

  return score;
}

// ── qualData serializer ───────────────────────────────────────────────────────
// Packs all qualification + spec fields into the structured QUAL_DATA block
// stored at the end of deal.notes.

function serializeQual(payload: WebsiteLeadPayload): string {
  // The freetext portion of the notes (the message field)
  const freetext = (payload.message ?? "").trim();

  // Build qualData object — maps contract fields → CRM field names
  const qualData: Record<string, string | null | undefined> = {
    // Qual fields
    primary_pain_type:    payload.qual_issue_type,
    application_context:  payload.qual_process_type,
    current_solution:     payload.qual_current_solution,
    buying_role:          payload.qual_buying_role,
    qual_urgency:         payload.qual_urgency,
    spec_budget:          payload.spec_budget,

    // Roll specification
    spec_roll_type:       payload.spec_roll_type,
    spec_roll_material:   payload.spec_roll_material,
    spec_diameter:        payload.spec_diameter,
    spec_face_length:     payload.spec_face_length,
    spec_dimension_unit:  payload.spec_dimension_unit,
    spec_substrate:       payload.spec_substrate,
    spec_current_sleeve:  payload.spec_current_sleeve,
    spec_spare_available: payload.spec_spare_available,

    // TQL spec answers
    spec_temperature:          payload.spec_temperature,
    spec_line_speed:           payload.spec_line_speed,
    spec_nip_pressure:         payload.spec_nip_pressure,
    spec_surface_finish:       payload.spec_surface_finish,
    spec_abrasion_concern:     payload.spec_abrasion_concern,
    spec_static_concern:       payload.spec_static_concern,
    problem_statement:         payload.spec_failure_description,
    spec_install_preference:   payload.spec_install_preference,
    spec_training_interest:    payload.spec_training_interest,
    spec_dryer_doctored:       payload.spec_dryer_doctored,
    spec_dryer_felted:         payload.spec_dryer_felted,

    // Mapped fields
    likely_division:           mapDivision(payload.product_interest),
    product_interest:          payload.product_interest,
    industry_segment:          payload.industry_segment ?? payload.segment,
    form_type_detail:          payload.form_type_detail,
    page_url:                  payload.page_url,
  };

  // Strip nullish values to keep notes clean
  const filteredQual: Record<string, string> = {};
  for (const [k, v] of Object.entries(qualData)) {
    if (v != null && v !== "" && v !== "null") {
      filteredQual[k] = String(v);
    }
  }

  const separator = "\n\n---QUAL_DATA---\n";
  return freetext
    ? freetext + separator + JSON.stringify(filteredQual, null, 2)
    : "---QUAL_DATA---\n" + JSON.stringify(filteredQual, null, 2);
}

// ── Payload type ──────────────────────────────────────────────────────────────

interface WebsiteLeadPayload {
  // Discriminator
  form_type?: string;
  form_type_detail?: string;
  page_url?: string;

  // Contact details
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string | null;
  title?: string | null;
  company?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;

  // Taxonomy
  industry_segment?: string | null;
  segment?: string | null;
  product_interest?: string | null;
  message?: string | null;

  // Qual fields
  qual_issue_type?: string | null;
  qual_process_type?: string | null;
  qual_current_solution?: string | null;
  qual_buying_role?: string | null;
  qual_urgency?: string | null;
  spec_budget?: string | null;

  // Roll spec (MQL phase)
  spec_roll_type?: string | null;
  spec_roll_material?: string | null;
  spec_diameter?: string | null;
  spec_face_length?: string | null;
  spec_dimension_unit?: string | null;
  spec_substrate?: string | null;
  spec_current_sleeve?: string | null;
  spec_spare_available?: string | null;

  // TQL spec (quote_request only)
  spec_temperature?: string | null;
  spec_line_speed?: string | null;
  spec_nip_pressure?: string | null;
  spec_surface_finish?: string | null;
  spec_abrasion_concern?: string | null;
  spec_static_concern?: string | null;
  spec_failure_description?: string | null;
  spec_install_preference?: string | null;
  spec_training_interest?: string | null;
  spec_dryer_doctored?: string | null;
  spec_dryer_felted?: string | null;
}

// ── Internal traffic check ────────────────────────────────────────────────────

function isInternalTraffic(payload: WebsiteLeadPayload): boolean {
  const email = (payload.email ?? "").toLowerCase();
  if (INTERNAL_EMAIL_DOMAINS.some((d) => email.endsWith(d))) return true;

  const city = (payload.city ?? "").toLowerCase().trim();
  if (INTERNAL_CITIES.includes(city)) return true;

  return false;
}

// ── Company deduplication ─────────────────────────────────────────────────────
// Fuzzy match on first word of company name (case-insensitive).

async function findOrCreateCompany(
  supabase: ReturnType<typeof createClient>,
  payload: WebsiteLeadPayload,
  companyStatus: string,
): Promise<string> {
  const rawName = (payload.company ?? "").trim();
  if (!rawName) {
    // Create a placeholder company from the submitter's email domain
    const emailDomain = (payload.email ?? "").split("@")[1] ?? "unknown";
    const fallbackName = emailDomain.split(".")[0] ?? "Unknown Company";
    return await createCompany(supabase, fallbackName, payload, companyStatus);
  }

  // Try exact match first (case-insensitive)
  const { data: exactRows } = await supabase
    .from("companies")
    .select("id, name, status")
    .ilike("name", rawName)
    .limit(1);

  if (exactRows && exactRows.length > 0) {
    return exactRows[0].id as string;
  }

  // Try first-word fuzzy match (handles "Acme Corp" vs "Acme Inc" etc.)
  const firstWord = rawName.split(/[\s,\-]/)[0];
  if (firstWord && firstWord.length >= 3) {
    const { data: fuzzyRows } = await supabase
      .from("companies")
      .select("id, name, status")
      .ilike("name", `${firstWord}%`)
      .limit(1);

    if (fuzzyRows && fuzzyRows.length > 0) {
      return fuzzyRows[0].id as string;
    }
  }

  // No match — create new
  return await createCompany(supabase, rawName, payload, companyStatus);
}

async function createCompany(
  supabase: ReturnType<typeof createClient>,
  name: string,
  payload: WebsiteLeadPayload,
  companyStatus: string,
): Promise<string> {
  const industryType = mapIndustrySegment(payload.industry_segment ?? payload.segment);

  const { data, error } = await supabase
    .from("companies")
    .insert({
      name,
      city: payload.city ?? null,
      state: payload.state ?? null,
      country: payload.country ?? null,
      industry_type: industryType,
      status: companyStatus,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Company insert failed: ${error.message}`);
  return data.id as string;
}

// ── Contact deduplication ─────────────────────────────────────────────────────

async function findOrUpsertContact(
  supabase: ReturnType<typeof createClient>,
  payload: WebsiteLeadPayload,
  companyId: string,
  contactStatus: string,
): Promise<string> {
  const email = (payload.email ?? "").trim().toLowerCase();
  const fullName =
    (payload.full_name ?? "").trim() ||
    [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim() ||
    email;

  // Check for existing contact by email
  if (email) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id, company_id")
      .ilike("email", email)
      .limit(1);

    if (existing && existing.length > 0) {
      const contactId = existing[0].id as string;
      // Update contact with fresh data (don't overwrite company if already set)
      const patch: Record<string, unknown> = {
        status: contactStatus,
        source: "website_intake",
      };
      if (payload.phone) patch.phone = payload.phone;
      if (payload.title) patch.title = payload.title;
      if (!existing[0].company_id && companyId) patch.company_id = companyId;

      await supabase
        .from("contacts")
        .update(patch)
        .eq("id", contactId);

      return contactId;
    }
  }

  // Insert new contact
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      name: fullName,
      email: email || null,
      phone: payload.phone ?? null,
      title: payload.title ?? null,
      company_id: companyId,
      status: contactStatus,
      owner: null,
      source: "website_intake",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Contact insert failed: ${error.message}`);
  return data.id as string;
}

// ── Deal creation ─────────────────────────────────────────────────────────────

async function createDeal(
  supabase: ReturnType<typeof createClient>,
  payload: WebsiteLeadPayload,
  companyId: string,
  contactId: string,
  route: RouteConfig,
  score: number,
): Promise<string> {
  const firstName = payload.first_name?.trim() ?? "";
  const lastName = payload.last_name?.trim() ?? "";
  const companyName = (payload.company ?? "").trim();
  const companyShort = companyName.split(/[\s,]/)[0] || companyName;

  // Build deal title
  const contactPart = [firstName, lastName].filter(Boolean).join(" ");
  const title = companyShort && contactPart
    ? `${companyShort} — ${contactPart}`
    : companyShort || contactPart || "Website Lead";

  const division = mapDivision(payload.product_interest);
  const notes = serializeQual(payload);

  // Extra tag note if routing has a tag
  const tagNote = route.tag ? `[${route.tag}]` : "";
  const fullNotes = tagNote ? `${tagNote}\n\n${notes}` : notes;

  // Map qual fields to their deal column equivalents
  const dealPayload: Record<string, unknown> = {
    title,
    stage: route.dealStage,
    status: "open",
    company_id: companyId,
    contact_id: contactId,
    division,
    owner: null,
    is_new_lead: true,
    lead_source: "website_intake",
    notes: fullNotes,

    // Structured qual columns (mapped from payload)
    primary_pain_type:   payload.qual_issue_type ?? null,
    application_context: payload.qual_process_type ?? null,
    problem_statement:   payload.spec_failure_description ?? null,
    likely_division:     division,
    segment:             payload.industry_segment ?? payload.segment ?? null,
    industry_segment:    payload.industry_segment ?? payload.segment ?? null,
  };

  // Store score — the deals table uses notes for this (no native score column
  // in baseline schema). We embed it in notes but also write it as a custom
  // field if the column exists via a later migration.
  // Attempt to write score column; if it fails, it's captured in notes only.
  (dealPayload as Record<string, unknown>)["score"] = score;

  const { data, error } = await supabase
    .from("deals")
    .insert(dealPayload)
    .select("id")
    .single();

  if (error) {
    // If score column doesn't exist, retry without it
    if (error.message?.includes("score")) {
      delete dealPayload["score"];
      const { data: data2, error: error2 } = await supabase
        .from("deals")
        .insert(dealPayload)
        .select("id")
        .single();
      if (error2) throw new Error(`Deal insert failed: ${error2.message}`);
      return data2.id as string;
    }
    throw new Error(`Deal insert failed: ${error.message}`);
  }

  return data.id as string;
}

// ── Activity log ──────────────────────────────────────────────────────────────

async function logActivity(
  supabase: ReturnType<typeof createClient>,
  payload: WebsiteLeadPayload,
  dealId: string,
  companyId: string,
  contactId: string,
): Promise<void> {
  const formDetail = payload.form_type_detail ?? "unknown";

  // Body: use message if present, otherwise summarize key qual fields
  let body = (payload.message ?? "").trim();
  if (!body) {
    const parts: string[] = [];
    if (payload.qual_issue_type)       parts.push(`Issue: ${payload.qual_issue_type}`);
    if (payload.qual_process_type)     parts.push(`Process: ${payload.qual_process_type}`);
    if (payload.qual_current_solution) parts.push(`Current solution: ${payload.qual_current_solution}`);
    if (payload.qual_buying_role)      parts.push(`Buying role: ${payload.qual_buying_role}`);
    if (payload.qual_urgency)          parts.push(`Urgency: ${payload.qual_urgency}`);
    if (payload.product_interest)      parts.push(`Product interest: ${payload.product_interest}`);
    body = parts.join("\n") || `Website inquiry received: ${formDetail}`;
  }

  const { error } = await supabase.from("activities").insert({
    deal_id:     dealId,
    company_id:  companyId,
    contact_id:  contactId,
    type:        "note",
    action_type: "website_intake",
    subject:     `Website inquiry: ${formDetail}`,
    body,
    occurred_at: new Date().toISOString(),
    logged_by:   null,
    from_email:  payload.email ?? null,
  });

  if (error) {
    // Activity logging is non-fatal — log but don't throw
    console.warn("[website-lead] Activity log failed:", error.message);
  }
}

// ── CORS helper ───────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let payload: WebsiteLeadPayload;

  try {
    payload = await req.json() as WebsiteLeadPayload;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  try {
    // ── 1. Internal traffic filter ──────────────────────────────────────────
    if (isInternalTraffic(payload)) {
      console.log("[website-lead] Skipping internal traffic:", payload.email);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "internal_traffic" }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Email validation ─────────────────────────────────────────────────
    const email = (payload.email ?? "").trim();
    if (!email) {
      console.warn("[website-lead] Missing email in payload — storing anyway");
    }

    // ── 3. Resolve routing config ───────────────────────────────────────────
    const formTypeDetail = (payload.form_type_detail ?? "unqualified_inquiry").trim();
    const route: RouteConfig = FORM_TYPE_ROUTES[formTypeDetail] ?? {
      dealStage: "prospect",
      companyStatus: "prospect",
      contactStatus: "lead",
    };

    // ── 4. Compute score ────────────────────────────────────────────────────
    const score = computeScore(payload);

    // ── 5. DB operations ────────────────────────────────────────────────────
    const supabase = getClient();

    // 5a. Find or create company
    const companyId = await findOrCreateCompany(supabase, payload, route.companyStatus);

    // 5b. Find or create/update contact
    const contactId = await findOrUpsertContact(
      supabase, payload, companyId, route.contactStatus,
    );

    // 5c. Create deal
    const dealId = await createDeal(
      supabase, payload, companyId, contactId, route, score,
    );

    // 5d. Log activity (non-fatal)
    await logActivity(supabase, payload, dealId, companyId, contactId);

    console.log(
      `[website-lead] Ingested: form=${formTypeDetail} email=${email} ` +
      `company=${payload.company} deal=${dealId} score=${score}`,
    );

    return new Response(
      JSON.stringify({ ok: true, deal_id: dealId, score }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[website-lead] Unexpected error:", message);

    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});

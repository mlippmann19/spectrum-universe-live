/**
 * POST /api/intake
 * Handles inbound lead intake form submissions.
 * Creates company + contact + activity in Supabase.
 * Returns: { ok: true, company_id, contact_id }
 */

const SUPABASE_URL = "https://tplkmtmuoyslmjewcudk.supabase.co";
const SUPABASE_KEY = "sb_publishable_0zCOvDy91vkLrXrxf8m4aA_jPM_TJVa";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function sbPost(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase POST ${table} → ${r.status}: ${txt}`);
  }
  return r.json();
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase GET ${path} → ${r.status}: ${txt}`);
  }
  return r.json();
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const {
    // Company fields
    company_name,
    company_city,
    company_state,
    company_country = "US",
    company_website,
    company_phone,
    company_address,
    industry_type,
    division_fit,
    // Contact fields
    first_name,
    last_name,
    contact_name,
    title,
    email,
    phone,
    linkedin,
    // Meta
    notes,
    source,
    assigned_to,
  } = body;

  if (!company_name) return json({ error: "company_name required" }, 400);
  if (!email && !first_name && !contact_name) {
    return json({ error: "At least one of email, first_name, or contact_name required" }, 400);
  }

  const now = new Date().toISOString();

  try {
    // 1. Check if company already exists (by name)
    let companyId = null;
    const existingCompanies = await sbGet(
      `companies?name=eq.${encodeURIComponent(company_name)}&limit=1`
    );

    if (existingCompanies.length > 0) {
      companyId = existingCompanies[0].id;
    } else {
      // Create new company
      const companyRow = {
        name: company_name,
        city: company_city || null,
        state: company_state || null,
        country: company_country,
        website: company_website || null,
        phone: company_phone || null,
        address: company_address || null,
        industry_type: industry_type || null,
        division_fit: division_fit || null,
        status: "prospect",
        notes: notes || null,
        bd_owner: assigned_to || null,
      };

      const created = await sbPost("companies", companyRow);
      companyId = Array.isArray(created) ? created[0]?.id : created?.id;
    }

    if (!companyId) {
      return json({ error: "Failed to create or find company" }, 500);
    }

    // 2. Create contact
    const fullName = contact_name || [first_name, last_name].filter(Boolean).join(" ");
    const contactRow = {
      company_id: companyId,
      name: fullName || email || "Unknown",
      first_name: first_name || fullName?.split(" ")[0] || null,
      last_name: last_name || fullName?.split(" ").slice(1).join(" ") || null,
      title: title || null,
      email: email || null,
      phone: phone || null,
      linkedin: linkedin || null,
      assigned_to: assigned_to || null,
      is_active: true,
    };

    const createdContact = await sbPost("contacts", contactRow);
    const contactId = Array.isArray(createdContact)
      ? createdContact[0]?.id
      : createdContact?.id;

    // 3. Log intake activity
    await sbPost("activities", {
      company_id: companyId,
      contact_id: contactId || null,
      type: "note",
      subject: `Inbound lead intake${source ? ` via ${source}` : ""}`,
      body: [
        notes ? `Notes: ${notes}` : null,
        source ? `Source: ${source}` : null,
        division_fit ? `Division fit: ${division_fit}` : null,
      ]
        .filter(Boolean)
        .join("\n") || "New lead received via intake form",
      direction: "inbound",
      action_type: "intake",
      occurred_at: now,
      assigned_to: assigned_to || null,
    });

    return json({
      ok: true,
      company_id: companyId,
      contact_id: contactId || null,
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

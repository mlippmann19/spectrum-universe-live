/**
 * Apollo person enrichment proxy
 *
 * Phone strategy (in order):
 * 1. contacts/search  — returns already-revealed phones instantly, zero credits
 * 2. people/match with reveal_phone_number + webhook_url — same as "Access Mobile"
 *    in Apollo UI, costs 8 credits, fires webhook async (~5-15s)
 * 3. If phone found in step 1, write to Supabase immediately (no wait needed)
 */

const APOLLO_API_KEY = "mrP_gnR6DZoiJfGAr8A72w";
const WEBHOOK_BASE   = "https://universe.spectrumadvanced.com/api/apollo-webhook";
const SUPABASE_URL   = "https://tplkmtmuoyslmjewcudk.supabase.co";

export async function onRequestPost(context) {
  try {
    const { first_name, last_name, domain, title, apollo_id, contact_id } =
      await context.request.json();

    const SUPABASE_KEY = context.env?.SUPABASE_SECRET_KEY;

    // ── Step 1: people/match — get identity + email ────────────────────────
    const matchBody = apollo_id
      ? { id: apollo_id, reveal_personal_emails: true }
      : { first_name, last_name, organization_domain: domain, title, reveal_personal_emails: true };

    const matchResp = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(matchBody),
    });
    const matchData  = await matchResp.json();
    const person     = matchData?.person ?? null;
    const resolvedId = person?.id ?? apollo_id ?? null;

    // Extract email
    let email = null;
    if (person) {
      const rawEmail = person.email;
      if (rawEmail && !/email_not_unlocked|^email_/i.test(rawEmail)) email = rawEmail;
      if (!email && Array.isArray(person.personal_emails) && person.personal_emails.length > 0) {
        email = person.personal_emails[0] || null;
      }
    }

    // ── Step 2: contacts/search — already-revealed phones, free & instant ──
    let phone = null;
    const searchName = [first_name, last_name].filter(Boolean).join(" ").trim() || person?.name || "";

    if (searchName) {
      try {
        const searchResp = await fetch("https://api.apollo.io/api/v1/contacts/search", {
          method: "POST",
          headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ q_keywords: searchName, page: 1, per_page: 5 }),
        });
        const searchData = await searchResp.json();
        for (const c of (searchData?.contacts ?? [])) {
          const phones = c.phone_numbers ?? [];
          const mobile = phones.find(p => p?.type === "mobile" && p?.sanitized_number);
          const any    = phones.find(p => p?.sanitized_number);
          phone = mobile?.sanitized_number ?? any?.sanitized_number ?? null;
          if (phone) break;
        }
      } catch { /* non-fatal */ }
    }

    // ── Step 3: if still no phone, fire reveal_phone_number (= "Access Mobile") ──
    // This costs 8 Apollo credits and sends the result async via webhook
    let webhookFired = false;
    if (!phone && contact_id && resolvedId) {
      try {
        const webhookUrl = `${WEBHOOK_BASE}?contact_id=${encodeURIComponent(contact_id)}`;
        await fetch("https://api.apollo.io/api/v1/people/match", {
          method: "POST",
          headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json", "Cache-Control": "no-cache" },
          body: JSON.stringify({
            id: resolvedId,
            reveal_phone_number: true,
            webhook_url: webhookUrl,
          }),
        });
        webhookFired = true;
      } catch { /* non-fatal */ }
    } else if (!phone && contact_id && !resolvedId) {
      // No Apollo ID yet — use name+domain match with webhook
      try {
        const webhookUrl = `${WEBHOOK_BASE}?contact_id=${encodeURIComponent(contact_id)}`;
        await fetch("https://api.apollo.io/api/v1/people/match", {
          method: "POST",
          headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json", "Cache-Control": "no-cache" },
          body: JSON.stringify({
            first_name, last_name, organization_domain: domain, title,
            reveal_phone_number: true,
            webhook_url: webhookUrl,
          }),
        });
        webhookFired = true;
      } catch { /* non-fatal */ }
    }

    // ── Step 4: if phone found synchronously, write to Supabase now ────────
    if (phone && contact_id && SUPABASE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(contact_id)}`, {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ phone }),
        });
      } catch { /* non-fatal */ }
    }

    return new Response(
      JSON.stringify({
        ...matchData,
        _phone_sync: phone,
        _webhook_fired: webhookFired,
        _contact_id: contact_id ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

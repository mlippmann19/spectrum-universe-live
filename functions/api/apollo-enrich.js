/**
 * Apollo person enrichment proxy
 *
 * Strategy:
 * 1. Call people/match to get email + person data
 * 2. If phone not returned, call contacts/search — this returns already-revealed
 *    phones from your account synchronously with no extra credit cost
 * 3. If still no phone, fire waterfall webhook as last-resort async fallback
 */

const APOLLO_API_KEY = "mrP_gnR6DZoiJfGAr8A72w";
const WEBHOOK_BASE   = "https://universe.spectrumadvanced.com/api/apollo-webhook";
const SUPABASE_URL   = "https://tplkmtmuoyslmjewcudk.supabase.co";

export async function onRequestPost(context) {
  try {
    const { first_name, last_name, domain, title, apollo_id, contact_id } =
      await context.request.json();

    const SUPABASE_KEY = context.env?.SUPABASE_SECRET_KEY;

    // ── Step 1: people/match for email + identity ──────────────────────────
    const matchBody = apollo_id
      ? { id: apollo_id, reveal_personal_emails: true }
      : { first_name, last_name, organization_domain: domain, title, reveal_personal_emails: true };

    const matchResp = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(matchBody),
    });
    const matchData = await matchResp.json();
    const person = matchData?.person ?? null;

    // Extract email from match
    let email = null;
    if (person) {
      const rawEmail = person.email;
      if (rawEmail && !/email_not_unlocked|^email_/i.test(rawEmail)) email = rawEmail;
      if (!email && Array.isArray(person.personal_emails) && person.personal_emails.length > 0) {
        email = person.personal_emails[0] || null;
      }
    }

    // ── Step 2: contacts/search for already-revealed phone (free, sync) ────
    let phone = null;
    const searchName = [first_name, last_name].filter(Boolean).join(" ").trim()
      || person?.name
      || "";

    if (searchName) {
      try {
        const searchResp = await fetch("https://api.apollo.io/api/v1/contacts/search", {
          method: "POST",
          headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ q_keywords: searchName, page: 1, per_page: 5 }),
        });
        const searchData = await searchResp.json();
        const contacts = searchData?.contacts ?? [];

        // Find the best match — prefer mobile number
        for (const c of contacts) {
          const phones = c.phone_numbers ?? [];
          const mobile = phones.find(p => p?.type === "mobile" && p?.sanitized_number);
          const any    = phones.find(p => p?.sanitized_number);
          phone = mobile?.sanitized_number ?? any?.sanitized_number ?? null;
          if (phone) break;
        }
      } catch { /* non-fatal */ }
    }

    // ── Step 3: if still no phone, fire waterfall webhook (async, costs credits) ──
    let webhookRegistered = false;
    if (!phone && contact_id) {
      try {
        const webhookUrl = `${WEBHOOK_BASE}?contact_id=${encodeURIComponent(contact_id)}`;
        await fetch("https://api.apollo.io/api/v1/people/match", {
          method: "POST",
          headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json", "Cache-Control": "no-cache" },
          body: JSON.stringify({
            ...(apollo_id ? { id: apollo_id } : { first_name, last_name, organization_domain: domain, title }),
            reveal_phone_number: true,
            run_waterfall_phone: true,
            webhook_url: webhookUrl,
          }),
        });
        webhookRegistered = true;
      } catch { /* non-fatal */ }
    }

    // ── Step 4: if we got a phone synchronously, write it to DB now ────────
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
        _webhook_registered: webhookRegistered,
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

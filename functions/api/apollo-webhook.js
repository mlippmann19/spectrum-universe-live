/**
 * Apollo phone enrichment webhook
 * Apollo calls this endpoint after async phone reveal completes.
 * We extract the phone and update the contact in Supabase.
 */

const SUPABASE_URL = "https://tplkmtmuoyslmjewcudk.supabase.co";
const SUPABASE_KEY = "sb_publishable_0zCOvDy91vkLrXrxf8m4aA_jPM_TJVa";

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();

    // Apollo sends the enriched person object + our custom metadata
    const person = payload?.person ?? payload?.contact ?? null;
    if (!person) {
      return new Response(JSON.stringify({ ok: true, note: "no person in payload" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Extract phone — try all fields Apollo may use
    let phone = null;
    if (Array.isArray(person.phone_numbers) && person.phone_numbers.length > 0) {
      const p = person.phone_numbers.find(x => x?.sanitized_number || x?.raw_number || x?.number);
      phone = p?.sanitized_number ?? p?.raw_number ?? p?.number ?? null;
    }
    phone = phone
      ?? person.sanitized_phone
      ?? person.direct_phone
      ?? person.mobile_phone
      ?? person.phone
      ?? null;

    if (!phone) {
      return new Response(JSON.stringify({ ok: true, note: "no phone in payload" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Identify the contact — Apollo passes back our metadata field
    // We encode contact_id in the webhook URL as a query param: ?contact_id=xxx
    const url = new URL(context.request.url);
    const contactId = url.searchParams.get("contact_id")
      ?? payload?.metadata?.contact_id
      ?? payload?.contact_id
      ?? null;

    const email = person.email ?? person.primary_email ?? null;

    if (!contactId && !email) {
      return new Response(JSON.stringify({ ok: false, error: "cannot identify contact" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Update the contact
    const filter = contactId
      ? `id=eq.${contactId}`
      : `email=ilike.${encodeURIComponent(email)}`;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/contacts?${filter}`,
      {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ phone }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("Supabase patch failed:", err);
      return new Response(JSON.stringify({ ok: false, error: err }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Apollo webhook: updated phone ${phone} for contact ${contactId ?? email}`);
    return new Response(JSON.stringify({ ok: true, phone, contact_id: contactId }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Apollo webhook error:", err.message);
    // Always return 200 so Apollo doesn't retry infinitely
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
}

// Apollo also sends a GET to verify the webhook URL is reachable
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, service: "apollo-webhook" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

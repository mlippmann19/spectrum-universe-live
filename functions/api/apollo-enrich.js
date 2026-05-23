/**
 * Apollo person enrichment proxy
 * Adds webhook_url for async phone reveal.
 * contact_id is appended to the webhook URL so we can identify the contact on callback.
 */

const APOLLO_API_KEY = "mrP_gnR6DZoiJfGAr8A72w";
const WEBHOOK_BASE   = "https://universe.spectrumadvanced.com/api/apollo-webhook";

export async function onRequestPost(context) {
  try {
    const { first_name, last_name, domain, title, apollo_id, contact_id } =
      await context.request.json();

    // Build the webhook URL — encode contact_id as a query param so the
    // webhook handler can identify which contact to update.
    const webhookUrl = contact_id
      ? `${WEBHOOK_BASE}?contact_id=${encodeURIComponent(contact_id)}`
      : WEBHOOK_BASE;

    // run_waterfall_phone checks Apollo + 3rd-party sources (much broader coverage)
    // reveal_phone_number only uses Apollo's own phone credits (limited plan)
    const body = apollo_id
      ? {
          id: apollo_id,
          reveal_personal_emails: true,
          reveal_phone_number: true,
          run_waterfall_phone: true,
          webhook_url: webhookUrl,
        }
      : {
          first_name,
          last_name,
          organization_domain: domain,
          title,
          reveal_personal_emails: true,
          reveal_phone_number: true,
          run_waterfall_phone: true,
          webhook_url: webhookUrl,
        };

    const response = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "x-api-key": APOLLO_API_KEY,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // If Apollo returns a phone synchronously (paid plan), include it directly.
    // Otherwise the phone will arrive via webhook within ~30 seconds.
    const person = data?.person ?? null;
    let phone = null;
    if (person) {
      if (Array.isArray(person.phone_numbers) && person.phone_numbers.length > 0) {
        const p = person.phone_numbers.find(x => x?.sanitized_number || x?.raw_number);
        phone = p?.sanitized_number ?? p?.raw_number ?? null;
      }
      phone = phone ?? person.sanitized_phone ?? person.direct_phone ?? person.mobile_phone ?? null;
    }

    return new Response(
      JSON.stringify({ ...data, _phone_sync: phone, _webhook_registered: !!contact_id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

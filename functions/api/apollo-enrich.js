export async function onRequestPost(context) {
  try {
    const { first_name, last_name, domain, title, apollo_id } = await context.request.json();
    const body = apollo_id
      ? { id: apollo_id, reveal_personal_emails: true }
      : { first_name, last_name, organization_domain: domain, title, reveal_personal_emails: true };

    const response = await fetch('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: {
        'x-api-key': 'mrP_gnR6DZoiJfGAr8A72w',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

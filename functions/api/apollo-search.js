export async function onRequestPost(context) {
  try {
    const { domain } = await context.request.json();

    const response = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'x-api-key': 'mrP_gnR6DZoiJfGAr8A72w',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        q_organization_domains_list: [domain],
        person_titles: [
          'production manager', 'maintenance manager', 'plant manager',
          'operations manager', 'manufacturing manager', 'production supervisor',
          'maintenance supervisor', 'plant superintendent', 'process engineer',
          'reliability engineer', 'equipment engineer', 'facilities manager'
        ],
        per_page: 15,
        page: 1
      })
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, people: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

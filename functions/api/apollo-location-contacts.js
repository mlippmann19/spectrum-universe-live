/**
 * POST /api/apollo-location-contacts
 * Searches Apollo for ICP contacts at a SPECIFIC plant location (city+state scoped).
 * Body: { company_id, company_name, city, state, parent_name? }
 * Returns: { contacts: [{first_name, last_name, title, email, linkedin, city, state}] }
 */

const APOLLO_KEY = "mrP_gnR6DZoiJfGAr8A72w";

const ICP_TITLES = [
  "maintenance manager",
  "maintenance supervisor",
  "plant manager",
  "operations manager",
  "production manager",
  "production supervisor",
  "manufacturing manager",
  "plant superintendent",
  "process engineer",
  "reliability engineer",
  "equipment engineer",
  "facilities manager",
  "plant engineer",
  "plant director",
  "VP of operations",
  "director of operations",
  "roll shop manager",
  "coating manager",
  "technical manager",
  "engineering manager",
  "maintenance director",
  "manufacturing engineer",
  "industrial engineer",
];

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

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { company_id, company_name, city, state, parent_name } = body;
  if (!company_name) return json({ error: "company_name required" }, 400);

  const apolloKey = (context.env && context.env.APOLLO_KEY) || APOLLO_KEY;

  // Build location filter — city + state specific
  const locationFilters = [];
  if (city && state) {
    locationFilters.push(`${city}, ${state}`);
    locationFilters.push(`${city}, ${state}, United States`);
  } else if (state) {
    locationFilters.push(state);
    locationFilters.push(`${state}, United States`);
  }

  const searchPayload = {
    per_page: 25,
    page: 1,
    person_titles: ICP_TITLES,
    q_organization_name: parent_name || company_name,
  };

  if (locationFilters.length > 0) {
    searchPayload.person_locations = locationFilters;
  }

  let apolloData = null;
  try {
    const r = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "x-api-key": apolloKey,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(searchPayload),
    });

    apolloData = await r.json();
  } catch (err) {
    return json({ error: `Apollo API error: ${err.message}`, contacts: [] }, 500);
  }

  // If city-scoped search returns nothing, try with just the org name
  if (
    (!apolloData?.people || apolloData.people.length === 0) &&
    locationFilters.length > 0 &&
    parent_name
  ) {
    try {
      const fallback = await fetch("https://api.apollo.io/v1/mixed_people/search", {
        method: "POST",
        headers: {
          "x-api-key": apolloKey,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify({
          per_page: 25,
          page: 1,
          person_titles: ICP_TITLES,
          q_organization_name: company_name,
          person_locations: locationFilters,
        }),
      });
      const fallbackData = await fallback.json();
      if (fallbackData.people?.length > 0) {
        apolloData = fallbackData;
      }
    } catch {
      // Use original result
    }
  }

  const people = apolloData?.people || [];

  const contacts = people.map((p) => ({
    first_name: p.first_name || "",
    last_name: p.last_name || "",
    title: p.title || "",
    email: p.email || null,
    linkedin: p.linkedin_url || null,
    city: p.city || city || "",
    state: p.state || state || "",
    company: p.organization?.name || company_name,
  }));

  return json({
    contacts,
    total: apolloData?.pagination?.total_entries || people.length,
    company_id: company_id || null,
  });
}

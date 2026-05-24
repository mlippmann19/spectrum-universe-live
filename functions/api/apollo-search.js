/**
 * Apollo people search proxy
 * Searches for contacts at a company by domain or company name
 * Uses mixed_people/search (the correct endpoint for people database search)
 */

const APOLLO_API_KEY = "mrP_gnR6DZoiJfGAr8A72w";

const ICP_TITLES = [
  "maintenance manager", "maintenance supervisor", "plant manager",
  "operations manager", "production manager", "production supervisor",
  "manufacturing manager", "plant superintendent", "process engineer",
  "reliability engineer", "equipment engineer", "facilities manager",
  "plant engineer", "plant director", "VP operations", "director of operations",
  "roll shop", "coating manager", "technical manager"
];

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { domain, company_name, location } = body;

    if (!domain && !company_name) {
      return new Response(JSON.stringify({ people: [], error: "domain or company_name required" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    // Build search payload — prefer domain, fall back to org name
    const searchPayload = {
      person_titles: ICP_TITLES,
      per_page: 20,
      page: 1,
    };

    if (domain) {
      searchPayload.q_organization_domains_list = [domain];
    } else {
      searchPayload.q_organization_name = company_name;
    }

    // Add location filter if provided (city/state)
    if (location) {
      searchPayload.person_locations = [location];
    }

    const response = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "x-api-key": APOLLO_API_KEY,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(searchPayload),
    });

    const data = await response.json();

    // If domain search returns nothing, try company name search as fallback
    if (domain && (!data.people || data.people.length === 0) && company_name) {
      const fallback = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
        method: "POST",
        headers: {
          "x-api-key": APOLLO_API_KEY,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify({
          q_organization_name: company_name,
          person_titles: ICP_TITLES,
          per_page: 20,
          page: 1,
          ...(location ? { person_locations: [location] } : {}),
        }),
      });
      const fallbackData = await fallback.json();
      if (fallbackData.people?.length > 0) {
        return new Response(JSON.stringify(fallbackData), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify(data), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, people: [] }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * /api/place-details
 * Given a company name + city + state, returns real business details
 * from SerpAPI Google Maps local search: address, phone, website, hours.
 *
 * GET /api/place-details?name=Florists+Newark+De&city=Newark&state=DE
 */

const SERP_API_KEY = "d431b88863f9b29dbb60ea60c6f54e73b6469a982f47d8b2632fea51bef5cb68";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function onRequestGet(context) {
  const url   = new URL(context.request.url);
  const name  = (url.searchParams.get("name")  ?? "").trim();
  const city  = (url.searchParams.get("city")  ?? "").trim();
  const state = (url.searchParams.get("state") ?? "").trim();

  if (!name) return json({ error: "name required" }, 400);

  const query = [name, city, state].filter(Boolean).join(" ");

  try {
    // SerpAPI Google Maps local search
    const serpUrl = new URL("https://serpapi.com/search.json");
    serpUrl.searchParams.set("engine",  "google_maps");
    serpUrl.searchParams.set("q",       query);
    serpUrl.searchParams.set("type",    "search");
    serpUrl.searchParams.set("gl",      "us");
    serpUrl.searchParams.set("hl",      "en");
    serpUrl.searchParams.set("api_key", SERP_API_KEY);

    const resp = await fetch(serpUrl.toString());
    if (!resp.ok) throw new Error(`SerpAPI HTTP ${resp.status}`);

    const data = await resp.json();
    const places = data.local_results ?? [];

    if (places.length === 0) {
      // Fallback: try regular Google search for the business
      return json({ found: false, name, city, state });
    }

    // Pick the best match — prefer exact name match in the city
    const best = places.find(p =>
      p.title?.toLowerCase().includes(name.toLowerCase().split(" ")[0]) &&
      (p.address ?? "").toLowerCase().includes((city || state).toLowerCase())
    ) ?? places[0];

    // Extract hours as a simple string
    const hours = best.hours
      ? best.hours
      : best.operating_hours
        ? Object.entries(best.operating_hours)
            .map(([d, h]) => `${d}: ${h}`)
            .join(" · ")
        : null;

    return json({
      found:    true,
      name:     best.title    ?? name,
      address:  best.address  ?? null,
      phone:    best.phone    ?? null,
      website:  best.website  ?? null,
      rating:   best.rating   ?? null,
      reviews:  best.reviews  ?? null,
      type:     best.type     ?? null,
      hours:    hours         ?? null,
      thumbnail: best.thumbnail ?? null,
      gps_coords: best.gps_coordinates ?? null,
      place_id: best.place_id ?? null,
      google_maps_link: best.links?.directions ?? best.links?.website ?? null,
    });

  } catch (err) {
    console.error("place-details error:", err.message);
    return json({ found: false, error: err.message, name, city, state });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

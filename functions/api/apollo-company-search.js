/**
 * Apollo + Hunter company search proxy for Prospector map
 * Searches for companies by name, returns locations with lat/lng
 * Used to find new prospect companies not yet in the BD pipeline
 */

const APOLLO_API_KEY = "mrP_gnR6DZoiJfGAr8A72w";
const HUNTER_API_KEY = "5b51bdc012bdaa5b4e59c32e8a4fe7282a4a1b78";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Apollo org search — returns parent + subsidiaries/divisions
    const apolloResp = await fetch(
      `https://api.apollo.io/api/v1/organizations/search?q_organization_name=${encodeURIComponent(q)}&per_page=15`,
      { headers: { "x-api-key": APOLLO_API_KEY, "Content-Type": "application/json" } }
    );
    const apolloData = await apolloResp.json();
    const orgs = apolloData?.organizations ?? [];

    // Geocode via Apollo data — they return city/state but not always lat/lng
    // We'll use a simple geocoding approach from known data
    const results = orgs
      .filter(o => o.name && (o.city || o.state || o.country))
      .map(o => ({
        id:       `apollo_${o.id ?? o.primary_domain ?? o.name}`,
        name:     o.name,
        domain:   o.primary_domain ?? o.website_url ?? null,
        city:     o.city ?? null,
        state:    o.state ?? null,
        country:  o.country ?? "United States",
        industry: o.industry ?? null,
        employees: o.estimated_num_employees ?? null,
        apollo_id: o.id ?? null,
        source:   "apollo",
        // Apollo sometimes returns lat/lng directly
        lat: o.latitude ?? o.lat ?? null,
        lng: o.longitude ?? o.lng ?? null,
      }));

    // Geocode any results missing lat/lng using a simple nominatim lookup
    const geocoded = await Promise.all(
      results.map(async (r) => {
        if (r.lat && r.lng) return r;
        if (!r.city && !r.state) return r;
        const location = [r.city, r.state, r.country].filter(Boolean).join(", ");
        try {
          const geo = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
            { headers: { "User-Agent": "SpectrumUniverseCRM/1.0" } }
          );
          const geoData = await geo.json();
          if (geoData?.[0]) {
            r.lat = parseFloat(geoData[0].lat);
            r.lng = parseFloat(geoData[0].lon);
          }
        } catch { /* non-fatal */ }
        return r;
      })
    );

    // Filter to results that have coordinates
    const withCoords = geocoded.filter(r => r.lat && r.lng);

    return new Response(JSON.stringify({ results: withCoords, total: withCoords.length }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, results: [] }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

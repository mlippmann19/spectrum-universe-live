/**
 * Company search endpoint — queries internal prospect_targets DB first,
 * falls back to Nominatim OSM for companies not yet in the database.
 * 
 * This keeps the map independent of Apollo for company discovery.
 * Apollo is only used for contact lookup (people), not company locations.
 */

const SUPABASE_URL = "https://tplkmtmuoyslmjewcudk.supabase.co";
const SUPABASE_KEY = "sb_publishable_0zCOvDy91vkLrXrxf8m4aA_jPM_TJVa";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ results: [], source: "none" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Query internal DB: find all prospect_targets where name contains the query
  // Uses ilike for case-insensitive partial match
  const dbUrl = `${SUPABASE_URL}/rest/v1/prospect_targets?` +
    `select=id,name,facility,city,state,country,lat,lng,category,aegis_score,products,data_source` +
    `&or=(name.ilike.*${encodeURIComponent(q)}*,facility.ilike.*${encodeURIComponent(q)}*)` +
    `&is_active=eq.true` +
    `&order=aegis_score.desc` +
    `&limit=100`;

  const dbResp = await fetch(dbUrl, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    }
  });
  const dbResults = await dbResp.json();

  if (Array.isArray(dbResults) && dbResults.length > 0) {
    // Parse parent company from products array
    const results = dbResults.map(r => {
      const parent = (r.products || []).find(p => p.startsWith("parent:"))?.slice(7) || r.name;
      const type   = (r.products || []).find(p => p.startsWith("type:"))?.slice(5) || "";
      return {
        id:        r.id,
        name:      r.name,
        facility:  r.facility,
        parent:    parent,
        city:      r.city,
        state:     r.state,
        country:   r.country,
        lat:       r.lat,
        lng:       r.lng,
        category:  r.category,
        score:     r.aegis_score,
        type:      type,
        source:    r.data_source === "company_db" ? "internal" : "aegis",
        inDb:      true,
      };
    });

    // Group by parent company for UI display
    const grouped = {};
    for (const r of results) {
      if (!grouped[r.parent]) grouped[r.parent] = [];
      grouped[r.parent].push(r);
    }

    return new Response(JSON.stringify({
      results,
      grouped,
      total: results.length,
      source: "internal",
      parents: Object.keys(grouped),
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Fallback: Nominatim OSM search for companies not in internal DB
  try {
    const osmUrl = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(q)}` +
      `&format=json&limit=10&addressdetails=1&countrycodes=us,ca`;

    const osmResp = await fetch(osmUrl, {
      headers: { "User-Agent": "SpectrumUniverseCRM/1.0 contact@spectrumadvanced.com" }
    });
    const osmData = await osmResp.json();

    const results = osmData
      .filter(r => r.lat && r.lon)
      .map(r => ({
        id:       `osm_${r.osm_id}`,
        name:     r.display_name.split(",")[0],
        facility: r.display_name.split(",")[0],
        parent:   q,
        city:     r.address?.city || r.address?.town || r.address?.village || "",
        state:    r.address?.state || "",
        country:  r.address?.country_code?.toUpperCase() || "US",
        lat:      parseFloat(r.lat),
        lng:      parseFloat(r.lon),
        category: "other",
        score:    40,
        type:     r.type || "",
        source:   "nominatim",
        inDb:     false,
      }));

    return new Response(JSON.stringify({
      results,
      total: results.length,
      source: "nominatim",
      parents: results.length > 0 ? [q] : [],
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ results: [], error: err.message, source: "error" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

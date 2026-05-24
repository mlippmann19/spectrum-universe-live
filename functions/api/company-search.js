/**
 * Company search — reads from internal company-db.json (static, fast, no API)
 * Falls back to Nominatim OSM for companies not yet in the database.
 * Apollo is never used here — only for contact lookup in the detail panel.
 */

export async function onRequestGet(context) {
  const url  = new URL(context.request.url);
  const q    = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ results: [], source: "none" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Load internal company DB (static JSON — fast, no DB query)
  const dbUrl = new URL("/company-db.json", context.request.url).href;
  let allRecords = [];
  try {
    const dbResp = await fetch(dbUrl);
    const dbData = await dbResp.json();
    allRecords = dbData.records ?? [];
  } catch { /* fallback to Nominatim */ }

  // Search: match on parent name or facility name
  const matches = allRecords.filter(r =>
    (r.parent ?? "").toLowerCase().includes(q) ||
    (r.name   ?? "").toLowerCase().includes(q) ||
    (r.facility ?? "").toLowerCase().includes(q)
  );

  if (matches.length > 0) {
    // Group by parent for display
    const grouped = {};
    for (const r of matches) {
      if (!grouped[r.parent]) grouped[r.parent] = [];
      grouped[r.parent].push(r);
    }
    return new Response(JSON.stringify({
      results: matches,
      grouped,
      total:   matches.length,
      source:  "internal",
      parents: Object.keys(grouped),
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Fallback: Nominatim OSM
  try {
    const osmResp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=10&countrycodes=us,ca`,
      { headers: { "User-Agent": "SpectrumUniverseCRM/1.0 contact@spectrumadvanced.com" } }
    );
    const osmData = await osmResp.json();
    const results = osmData.filter(r => r.lat && r.lon).map(r => ({
      id:       `osm_${r.osm_id}`,
      name:     r.display_name.split(",")[0],
      facility: r.display_name.split(",")[0],
      parent:   q,
      city:     r.address?.city || r.address?.town || r.address?.village || "",
      state:    r.address?.state || "",
      country:  (r.address?.country_code ?? "us").toUpperCase(),
      lat:      parseFloat(r.lat),
      lng:      parseFloat(r.lon),
      category: "other",
      score:    40,
      type:     r.type || "",
      source:   "nominatim",
    }));
    return new Response(JSON.stringify({
      results, total: results.length, source: "nominatim",
      parents: results.length > 0 ? [q] : [],
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ results: [], error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

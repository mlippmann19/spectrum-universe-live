/**
 * Company location search
 * 1. Check internal company-db.json first (pre-cached, instant)
 * 2. SerpAPI → Google Search targeting Indeed/LinkedIn location listings
 * 3. Parse city/state from results
 * 4. Geocode with Nominatim
 */

const SERP_API_KEY = "d431b88863f9b29dbb60ea60c6f54e73b6469a982f47d8b2632fea51bef5cb68";

const US_STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]);
const CA_PROVINCES = new Set(["ON","QC","BC","AB","MB","SK","NS","NB","NL","PE"]);
const ALL_STATES = new Set([...US_STATES, ...CA_PROVINCES]);

const CITY_STATE_RE = /\b([A-Z][a-zA-Z\u00C0-\u017E\s\.]{1,24}),\s*([A-Z]{2})(?:\s|\.|·|$)/g;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q   = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q || q.length < 2) return json({ results: [], source: "none" });

  // ── 1. Internal cache ──────────────────────────────────────────────────────
  try {
    const dbData = await (await fetch(new URL("/company-db.json", context.request.url).href)).json();
    const matches = (dbData.records ?? []).filter(r =>
      [r.parent, r.name, r.facility].some(s => (s ?? "").toLowerCase().includes(q))
    );
    if (matches.length > 0) {
      return json({ results: matches, grouped: groupBy(matches), total: matches.length, source: "internal" });
    }
  } catch {}

  // ── 2. SerpAPI — find locations via Indeed/LinkedIn ───────────────────────
  try {
    const companyName = q.replace(/\b\w/g, c => c.toUpperCase()); // Title Case

    // Query 1: Indeed locations page (most reliable)
    const q1 = `${q} locations site:indeed.com/cmp`;
    // Query 2: Manufacturing facilities
    const q2 = `"${q}" manufacturing plant facility "United States" OR "Canada" locations`;

    const [r1, r2] = await Promise.all([
      serpSearch(q1),
      serpSearch(q2),
    ]);

    const cityStates = extractCityStates([...r1, ...r2]);

    if (cityStates.length === 0) {
      // Query 3: Their own website
      const domain = q.replace(/\s+/g, "") + ".com";
      const q3 = `site:${domain} locations OR facilities OR plants`;
      const r3 = await serpSearch(q3);
      cityStates.push(...extractCityStates(r3));
    }

    if (cityStates.length > 0) {
      // Geocode in parallel (max 20)
      const toGeocode = cityStates.slice(0, 20);
      const geocoded = (await Promise.all(toGeocode.map(cs => geocode(cs, companyName)))).filter(Boolean);

      if (geocoded.length > 0) {
        return json({ results: geocoded, grouped: groupBy(geocoded), total: geocoded.length, source: "serp" });
      }
    }
  } catch (err) {
    console.error("SerpAPI error:", err.message);
  }

  // ── 3. Nominatim fallback ──────────────────────────────────────────────────
  try {
    const osmData = await (await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&countrycodes=us,ca&addressdetails=1`,
      { headers: { "User-Agent": "SpectrumUniverseCRM/1.0 contact@spectrumadvanced.com" } }
    )).json();

    const results = osmData.filter(r => r.lat && r.lon).map(r => ({
      id:       `osm_${r.osm_id}`,
      name:     r.display_name.split(",")[0],
      facility: r.display_name.split(",")[0],
      parent:   q,
      city:     r.address?.city || r.address?.town || r.address?.village || "",
      state:    r.address?.state || "",
      country:  (r.address?.country_code || "us").toUpperCase(),
      lat:      parseFloat(r.lat),
      lng:      parseFloat(r.lon),
      category: "flex_packaging",
      score:    40,
      source:   "nominatim",
    }));

    return json({ results, total: results.length, source: "nominatim" });
  } catch {}

  return json({ results: [], source: "none" });
}

async function serpSearch(query) {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=10&gl=us&hl=en&api_key=${SERP_API_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  return (data.organic_results || []).map(r => `${r.title || ""} ${r.snippet || ""}`);
}

function extractCityStates(textArray) {
  const found = new Map();
  for (const text of textArray) {
    CITY_STATE_RE.lastIndex = 0;
    let m;
    while ((m = CITY_STATE_RE.exec(text)) !== null) {
      const city = m[1].trim();
      const state = m[2].trim();
      if (!ALL_STATES.has(state)) continue;
      if (city.length < 2 || city.length > 28) continue;
      // Skip common false positives
      if (/^(United|North|South|New|Inc|Corp|Ltd|LLC|Co\.)$/i.test(city)) continue;
      const key = `${city.toLowerCase()},${state}`;
      if (!found.has(key)) found.set(key, { city, state, country: CA_PROVINCES.has(state) ? "CA" : "US" });
    }
  }
  return [...found.values()];
}

async function geocode({ city, state, country }, companyName) {
  const cc  = country === "CA" ? "ca" : "us";
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${city}, ${state}`)}&format=json&limit=1&countrycodes=${cc}`;
  try {
    const data = await (await fetch(url, {
      headers: { "User-Agent": "SpectrumUniverseCRM/1.0 contact@spectrumadvanced.com" }
    })).json();
    if (!data[0]) return null;
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const name = companyName.replace(/\b\w/g, c => c.toUpperCase());
    return {
      id:       `serp_${companyName}_${city}_${state}`.replace(/[^a-z0-9_]/gi,"_").toLowerCase(),
      name:     `${name} — ${city}`,
      facility: `${name} ${city}`,
      parent:   name,
      city,
      state,
      country,
      lat:  parseFloat(data[0].lat),
      lng:  parseFloat(data[0].lon),
      category: "flex_packaging",
      score:    55,
      source:   "serp",
    };
  } catch { return null; }
}

function groupBy(records) {
  return records.reduce((g, r) => {
    const p = r.parent || r.name;
    (g[p] = g[p] || []).push(r);
    return g;
  }, {});
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

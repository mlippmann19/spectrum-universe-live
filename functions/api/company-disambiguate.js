/**
 * GET /api/company-disambiguate?q=westrock
 * Uses Google Places to find companies matching query, groups by canonical root name.
 */

const GOOGLE_PLACES_KEY = "AIzaSyAQztdsE8SqQk3zCUPsaIv-n8RuT_RGYbM";

// CANONICAL normalization table
const CANONICAL_MAP = [
  { pattern: /^smurfit\s+westrock/i, canonical: "Smurfit WestRock" },
  { pattern: /^westrock/i, canonical: "WestRock" },
  { pattern: /^international\s+paper/i, canonical: "International Paper" },
  { pattern: /^georgia[\s-]pacific/i, canonical: "Georgia-Pacific" },
  { pattern: /^packaging\s+corp/i, canonical: "Packaging Corp of America" },
  { pattern: /^graphic\s+packaging/i, canonical: "Graphic Packaging" },
  { pattern: /^domtar/i, canonical: "Domtar" },
  { pattern: /^kimberly[\s-]clark/i, canonical: "Kimberly-Clark" },
  { pattern: /^clearwater\s+paper/i, canonical: "Clearwater Paper" },
  { pattern: /^sappi/i, canonical: "Sappi" },
  { pattern: /^ahlstrom/i, canonical: "Ahlstrom" },
  { pattern: /^mativ/i, canonical: "Mativ" },
  { pattern: /^andritz/i, canonical: "Andritz" },
  { pattern: /^voith/i, canonical: "Voith" },
  { pattern: /^finzer/i, canonical: "Finzer Roller" },
  { pattern: /^american\s+roller/i, canonical: "American Roller" },
];

// City words to strip from the end of company names
const TRAILING_CITY_PATTERN = /\s+(north|south|east|west|new|old|upper|lower|greater)?\s*[A-Z][a-z]+([\s-][A-Z][a-z]+)*\s*$/;

function rootName(name) {
  // Check canonical map first
  for (const { pattern, canonical } of CANONICAL_MAP) {
    if (pattern.test(name)) return canonical;
  }

  // Strip trailing city-like words: "WestRock Dallas" → "WestRock"
  // Remove anything after a comma (location suffix)
  let cleaned = name.split(",")[0].trim();

  // Remove common suffixes
  cleaned = cleaned
    .replace(/\s+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?|company|group|holdings|international|north america)$/gi, "")
    .trim();

  // Try to strip trailing proper-noun city words (heuristic: last word is Title Case and not part of known company)
  const words = cleaned.split(/\s+/);
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    // If last word looks like a city (Title Case, not all-caps abbreviation)
    if (/^[A-Z][a-z]{2,}$/.test(lastWord)) {
      // Check if removing it matches a canonical
      const withoutLast = words.slice(0, -1).join(" ");
      for (const { pattern, canonical } of CANONICAL_MAP) {
        if (pattern.test(withoutLast)) return canonical;
      }
      // Remove trailing city word heuristically if there are at least 2 words left
      if (words.length > 2) {
        cleaned = withoutLast;
      }
    }
  }

  return cleaned;
}

function parseLocation(formattedAddress) {
  const parts = (formattedAddress || "").split(",").map((p) => p.trim());
  let city = "", state = "", type_label = "";
  if (parts.length >= 3) {
    city = parts[parts.length - 3] || "";
    const stateZip = parts[parts.length - 2] || "";
    state = stateZip.replace(/\s*\d{5}(-\d{4})?$/, "").trim();
  } else if (parts.length === 2) {
    city = parts[0];
    state = parts[1].replace(/\s*\d{5}(-\d{4})?$/, "").trim();
  }
  return { city, state };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return json({ error: "q parameter required (min 2 chars)" }, 400);
  }

  // Search Google Places
  let results = [];
  try {
    const encoded = encodeURIComponent(`${q} manufacturing`);
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encoded}&key=${GOOGLE_PLACES_KEY}`
    );
    const data = await r.json();
    results = data.results || [];
  } catch (err) {
    return json({ error: `Places API error: ${err.message}` }, 500);
  }

  // Group by canonical root name, deduplicate
  const seen = new Set();
  const companies = [];

  for (const place of results) {
    const name = place.name || "";
    const canonical = rootName(name);

    if (seen.has(canonical.toLowerCase())) continue;
    seen.add(canonical.toLowerCase());

    const { city, state } = parseLocation(place.formatted_address || "");
    const types = place.types || [];
    const type_label = types
      .filter((t) => !["point_of_interest", "establishment"].includes(t))
      .map((t) => t.replace(/_/g, " "))
      .join(", ") || "business";

    companies.push({
      name: canonical,
      city,
      state,
      type_label,
    });
  }

  return json({ companies, query: q });
}

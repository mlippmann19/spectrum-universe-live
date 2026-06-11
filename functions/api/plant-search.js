/**
 * POST /api/plant-search
 * Finds plant/facility locations for a company using Google Places textsearch.
 * Body: { company_name, location_type, search_aliases[] }
 * Returns: { locations: [{full_name, city, state, country, lat, lng, address, phone, website, confidence}] }
 */

const GOOGLE_PLACES_KEY = "AIzaSyAQztdsE8SqQk3zCUPsaIv-n8RuT_RGYbM";

// Types to EXCLUDE — non-manufacturing
const EXCLUDE_TYPES = new Set([
  "lodging", "restaurant", "food", "bar", "cafe", "bakery", "meal_delivery",
  "meal_takeaway", "night_club", "spa", "beauty_salon", "hair_care",
  "bank", "atm", "finance", "insurance_agency", "real_estate_agency",
  "lawyer", "doctor", "hospital", "pharmacy", "dentist", "health",
  "school", "university", "church", "place_of_worship", "park",
  "amusement_park", "museum", "library", "movie_theater", "gym",
  "shopping_mall", "store", "clothing_store", "grocery_or_supermarket",
  "supermarket", "convenience_store", "department_store", "shoe_store",
  "home_goods_store", "hardware_store", "furniture_store", "florist",
  "jewelry_store", "book_store", "pet_store", "bicycle_store",
  "car_dealer", "car_rental", "car_repair", "car_wash", "gas_station",
  "parking", "transit_station", "airport", "train_station", "bus_station",
  "campground", "rv_park",
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function cleanCompanyName(name) {
  // Remove location suffixes that appear in company names
  return (name || "")
    .replace(/\s+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?|company|group|holdings|international|north america)$/gi, "")
    .replace(/\s+(plant|facility|mill|works|factory|division|location)\s*#?\d*$/gi, "")
    .trim();
}

function parseAddressParts(formattedAddress) {
  // "123 Main St, Springfield, IL 62701, USA"
  const parts = (formattedAddress || "").split(",").map((p) => p.trim());
  let city = "", state = "", country = "US";
  if (parts.length >= 3) {
    city = parts[parts.length - 3] || "";
    const stateZip = parts[parts.length - 2] || "";
    state = stateZip.replace(/\s*\d{5}(-\d{4})?$/, "").trim();
    const countryPart = parts[parts.length - 1] || "";
    if (countryPart && countryPart.length <= 3) country = countryPart;
  } else if (parts.length === 2) {
    city = parts[0];
    state = parts[1].replace(/\s*\d{5}(-\d{4})?$/, "").trim();
  }
  return { city, state, country };
}

function hasExcludedType(types = []) {
  return types.some((t) => EXCLUDE_TYPES.has(t));
}

function dedupeByCity(locations) {
  const seen = new Set();
  return locations.filter((loc) => {
    const key = `${loc.city?.toLowerCase()}-${loc.state?.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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

  const { company_name, location_type, search_aliases = [] } = body;
  if (!company_name) return json({ error: "company_name required" }, 400);

  const cleanName = cleanCompanyName(company_name);
  const queries = [cleanName, ...search_aliases].filter(Boolean);

  // Add manufacturing-focused query variants
  const searchQueries = [
    ...queries.map((q) => `${q} manufacturing plant`),
    ...queries.map((q) => `${q} ${location_type || "facility"}`),
    cleanName, // bare name search
  ];

  const allResults = [];

  for (const q of searchQueries.slice(0, 5)) {
    try {
      const encoded = encodeURIComponent(q);
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encoded}&key=${GOOGLE_PLACES_KEY}`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.results) {
        allResults.push(...data.results);
      }
    } catch {
      // Continue with other queries
    }
  }

  // Filter and normalize
  const locations = allResults
    .filter((place) => {
      const name = (place.name || "").toLowerCase();
      const cleanLower = cleanName.toLowerCase();
      // Must mention the company name
      if (!name.includes(cleanLower) && !cleanLower.includes(name.split(" ")[0])) {
        // Try first word of company name
        const firstWord = cleanLower.split(" ")[0];
        if (firstWord.length > 3 && !name.includes(firstWord)) return false;
      }
      // Exclude non-manufacturing types
      if (hasExcludedType(place.types || [])) return false;
      return true;
    })
    .map((place) => {
      const loc = place.geometry?.location || {};
      const { city, state, country } = parseAddressParts(place.formatted_address);
      const types = place.types || [];
      const isManufacturing =
        types.includes("point_of_interest") ||
        types.includes("establishment") ||
        types.includes("industrial");

      return {
        full_name: place.name,
        city,
        state,
        country,
        lat: loc.lat || null,
        lng: loc.lng || null,
        address: place.formatted_address || "",
        phone: place.formatted_phone_number || null,
        website: place.website || null,
        confidence: isManufacturing ? "high" : "medium",
        place_id: place.place_id,
      };
    });

  const deduped = dedupeByCity(locations);

  return json({ locations: deduped, query_count: searchQueries.length });
}

/**
 * POST /api/find-similar
 * Uses Perplexity (sonar) to find US company analogs, then enriches with Google Places.
 * Body: { name, industry_type, products[], known_names[] }
 */

const PPLX_KEY = "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";
const GOOGLE_PLACES_KEY = "AIzaSyAQztdsE8SqQk3zCUPsaIv-n8RuT_RGYbM";

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

  const { name, industry_type, products = [], known_names = [] } = body;
  if (!name && !industry_type) {
    return json({ error: "name or industry_type required" }, 400);
  }

  const pplxKey = (context.env && context.env.PPLX_KEY) || PPLX_KEY;

  // Build Perplexity prompt
  const productStr = products.length > 0 ? products.join(", ") : "industrial products";
  const knownStr = known_names.length > 0 ? `Known examples: ${known_names.join(", ")}. Find 8 MORE similar companies.` : "Find 8 similar companies.";
  const prompt = `I'm looking for US manufacturing companies similar to "${name}" in the ${industry_type || "industrial"} sector that use ${productStr}.
${knownStr}
Return EXACTLY 8 companies as a numbered list in this format:
1. Company Name — City, ST — brief reason why they're similar
2. Company Name — City, ST — brief reason
...
Only include real US companies. Focus on manufacturing plants, not corporate HQs.`;

  let aiResponse = "";
  try {
    const pplxRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pplxKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "You are a B2B sales research assistant. Return only numbered lists in the exact format requested. Do not add extra commentary.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.2,
      }),
    });
    const pplxData = await pplxRes.json();
    aiResponse = pplxData?.choices?.[0]?.message?.content || "";
  } catch (err) {
    return json({ error: `Perplexity error: ${err.message}` }, 500);
  }

  // Parse numbered list: "1. Company Name — City, ST — reason"
  const lines = aiResponse.split("\n").filter((l) => /^\d+\./.test(l.trim()));
  const parsed = lines.map((line) => {
    // Remove leading number
    const clean = line.replace(/^\d+\.\s*/, "").trim();
    const parts = clean.split(/\s*[—–-]\s*/);
    const companyName = parts[0]?.trim() || clean;
    const locationStr = parts[1]?.trim() || "";
    const reason = parts.slice(2).join(" — ").trim() || "";

    // Parse city, state from "City, ST"
    const locMatch = locationStr.match(/^(.+),\s*([A-Z]{2})$/);
    const city = locMatch ? locMatch[1].trim() : locationStr;
    const state = locMatch ? locMatch[2].trim() : "";

    return { name: companyName, city, state, country: "US", reason };
  });

  // Enrich each with Google Places textsearch
  const results = await Promise.all(
    parsed.slice(0, 8).map(async (item, idx) => {
      try {
        const query = encodeURIComponent(
          `${item.name}${item.city ? " " + item.city : ""}${item.state ? " " + item.state : ""} manufacturing`
        );
        const placesRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_PLACES_KEY}`
        );
        const placesData = await placesRes.json();
        const place = placesData?.results?.[0];

        if (place) {
          const loc = place.geometry?.location || {};
          // Parse city/state from formatted_address
          const addrParts = (place.formatted_address || "").split(",");
          const enrichedCity = item.city || addrParts[1]?.trim() || "";
          const stateZip = addrParts[2]?.trim() || "";
          const enrichedState = item.state || stateZip.replace(/\s*\d+.*$/, "").trim() || "";

          return {
            id: `similar-${idx + 1}`,
            name: item.name,
            city: enrichedCity,
            state: enrichedState,
            country: item.country || "US",
            lat: loc.lat || null,
            lng: loc.lng || null,
            reason: item.reason,
            score: 85,
          };
        }
      } catch {
        // Fall through to return basic data
      }
      return {
        id: `similar-${idx + 1}`,
        name: item.name,
        city: item.city,
        state: item.state,
        country: item.country || "US",
        lat: null,
        lng: null,
        reason: item.reason,
        score: 85,
      };
    })
  );

  return json({ results, query: prompt, ai_response: aiResponse });
}

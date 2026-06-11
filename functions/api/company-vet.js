/**
 * POST /api/company-vet
 * Uses Perplexity to check if a company is a real manufacturer that could use Spectrum products.
 * Body: { name, city, state, industry }
 * Returns: { fit_score: 0-100, fit_label: 'Strong'|'Possible'|'Poor', division_tags: [], reasoning }
 */

const PPLX_KEY = "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";

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

  const { name, city, state, industry } = body;
  if (!name) return json({ error: "name required" }, 400);

  const pplxKey = (context.env && context.env.PPLX_KEY) || PPLX_KEY;

  const locationStr = [city, state].filter(Boolean).join(", ");
  const prompt = `Evaluate whether this is a real manufacturing company that would be a good sales prospect for Spectrum Advanced, which sells:
- Fluoron division: fluoropolymer-coated industrial rollers and components for paper, printing, textile, and packaging industries
- Aegis division: industrial coating application services for rollers and equipment  
- RCS division: roller cleaning and maintenance services for industrial equipment

Company: ${name}
Location: ${locationStr || "Unknown"}
Industry: ${industry || "Unknown"}

Answer in this exact JSON format:
{
  "fit_score": 75,
  "fit_label": "Possible",
  "division_tags": ["fluoron", "rcs"],
  "reasoning": "Brief 1-2 sentence explanation",
  "is_manufacturer": true,
  "is_real_company": true
}

fit_score: 0-100 (100 = perfect fit, 0 = not a manufacturer)
fit_label: "Strong" (75-100), "Possible" (40-74), "Poor" (0-39)
division_tags: array of applicable divisions from ["fluoron", "aegis", "rcs"] — empty array if none
is_manufacturer: true if they manufacture or convert physical products
is_real_company: true if this appears to be a real, operating company`;

  let aiText = "";
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
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
            content:
              "You are an industrial B2B sales qualification assistant. Respond with valid JSON only, no markdown, no extra text.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 400,
        temperature: 0.1,
      }),
    });

    const data = await r.json();
    aiText = data?.choices?.[0]?.message?.content || "";
  } catch (err) {
    return json({ error: `Perplexity error: ${err.message}` }, 500);
  }

  let parsed = {};
  try {
    const clean = aiText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    return json({
      fit_score: 50,
      fit_label: "Possible",
      division_tags: [],
      reasoning: aiText,
      is_manufacturer: true,
      is_real_company: true,
      raw: aiText,
    });
  }

  // Normalize fit_label from fit_score if missing
  const score = typeof parsed.fit_score === "number" ? parsed.fit_score : 50;
  let label = parsed.fit_label;
  if (!label) {
    label = score >= 75 ? "Strong" : score >= 40 ? "Possible" : "Poor";
  }

  return json({
    fit_score: score,
    fit_label: label,
    division_tags: Array.isArray(parsed.division_tags) ? parsed.division_tags : [],
    reasoning: parsed.reasoning || "",
    is_manufacturer: parsed.is_manufacturer !== false,
    is_real_company: parsed.is_real_company !== false,
  });
}

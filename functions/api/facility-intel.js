/**
 * POST /api/facility-intel
 * Uses Perplexity to research a specific facility.
 * Body: { company_name, city, state, country }
 * Returns: { summary, products[], employee_range, is_match, verified_company }
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

  const { company_name, city, state, country } = body;
  if (!company_name) return json({ error: "company_name required" }, 400);

  const pplxKey = (context.env && context.env.PPLX_KEY) || PPLX_KEY;

  const locationStr = [city, state, country].filter(Boolean).join(", ");
  const prompt = `Research this specific manufacturing facility:

Company: ${company_name}
Location: ${locationStr || "Unknown location"}

Please provide:
1. What products or materials they manufacture at this facility
2. Key industrial processes used (e.g., paper converting, coating, printing, roll manufacturing)
3. Approximate employee count or range
4. Whether this facility likely uses industrial rollers, coating equipment, cleaning systems, or fluoropolymer-coated parts (relevant for industrial sales)
5. Verified company name (in case the input name is slightly wrong)

Respond in this exact JSON format:
{
  "summary": "2-3 sentence description of the facility",
  "products": ["product1", "product2"],
  "processes": ["process1", "process2"],
  "employee_range": "100-500",
  "is_match": true,
  "verified_company": "Exact Company Name"
}`;

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
              "You are an industrial market research assistant. Always respond with valid JSON only, no markdown code blocks, no extra text.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
    });

    const data = await r.json();
    aiText = data?.choices?.[0]?.message?.content || "";
  } catch (err) {
    return json({ error: `Perplexity error: ${err.message}` }, 500);
  }

  // Parse JSON response
  let parsed = {};
  try {
    // Strip markdown code fences if present
    const clean = aiText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    // Return raw text if JSON parse fails
    return json({
      summary: aiText,
      products: [],
      processes: [],
      employee_range: "Unknown",
      is_match: true,
      verified_company: company_name,
      raw: aiText,
    });
  }

  return json({
    summary: parsed.summary || "",
    products: parsed.products || [],
    processes: parsed.processes || [],
    employee_range: parsed.employee_range || "Unknown",
    is_match: parsed.is_match !== false,
    verified_company: parsed.verified_company || company_name,
  });
}

/**
 * POST /api/drip-send
 * Drip email sender — processes up to 5 active contact_sequences per tick.
 * Auth: x-drip-secret header must equal "drip-run-8f3k2p"
 * NOTE: No replyTo field — replies go straight to cgeary@spectrumadvanced.com
 */

const DRIP_SECRET = "drip-run-8f3k2p";
const SUPABASE_URL = "https://tplkmtmuoyslmjewcudk.supabase.co";
const SUPABASE_KEY = "sb_publishable_0zCOvDy91vkLrXrxf8m4aA_jPM_TJVa";
// BREVO_KEY is read from context.env.BREVO_API_KEY at runtime (set in CF Pages env vars)

// Matt Lippmann user_id
const MATT_USER_ID = "506b5e34-5c1d-4b57-985e-7682ab9c3112";

// Division-aware sender config
const DIVISION_SIGS = {
  FLUORON: {
    name: "Chris Geary",
    title: "Service and Sales Engineer",
    company: "Fluoron, a division of Spectrum Advanced",
    phone: "+1 443.406.5103",
    website: "www.fluoron.com",
    email: "cgeary@spectrumadvanced.com",
  },
  AEGIS: {
    name: "Chris Geary",
    title: "Service and Sales Engineer",
    company: "Aegis Coating Applicators, a division of Spectrum Advanced",
    phone: "+1 443.406.5103",
    website: "www.aegis-advanced.com",
    email: "cgeary@spectrumadvanced.com",
  },
  RCS: {
    name: "Chris Geary",
    title: "Service and Sales Engineer",
    company: "Radiant Cleaning Services, a division of Spectrum Advanced",
    phone: "+1 443.406.5103",
    website: "www.rollercleaning.com",
    email: "cgeary@spectrumadvanced.com",
  },
  RADIANT: {
    name: "Chris Geary",
    title: "Service and Sales Engineer",
    company: "Radiant Cleaning Services, a division of Spectrum Advanced",
    phone: "+1 443.406.5103",
    website: "www.rollercleaning.com",
    email: "cgeary@spectrumadvanced.com",
  },
  DEFENSE: {
    name: "Matt Lippmann",
    title: "Director of Business Development",
    company: "Spectrum Advanced",
    phone: "+1 302.379.0701",
    website: "www.spectrumadvanced.com",
    email: "mlippmann@spectrumadvanced.com",
  },
  AEROSPACE: {
    name: "Matt Lippmann",
    title: "Director of Business Development",
    company: "Spectrum Advanced",
    phone: "+1 302.379.0701",
    website: "www.spectrumadvanced.com",
    email: "mlippmann@spectrumadvanced.com",
  },
};

function getSig(division, ownerUserId) {
  if (ownerUserId === MATT_USER_ID) return DIVISION_SIGS.DEFENSE;
  const key = (division || "").toUpperCase();
  return DIVISION_SIGS[key] || DIVISION_SIGS.FLUORON;
}

function buildSigHtml(sig) {
  return `<br><br>
<table style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-top:2px solid #1a365d;padding-top:10px;margin-top:10px;">
<tr><td><strong>${sig.name}</strong></td></tr>
<tr><td style="color:#555;">${sig.title}</td></tr>
<tr><td style="color:#1a365d;font-weight:600;">${sig.company}</td></tr>
<tr><td style="color:#555;">${sig.phone}</td></tr>
<tr><td><a href="https://${sig.website}" style="color:#1a365d;">${sig.website}</a></td></tr>
</table>`;
}

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase GET ${path} → ${r.status}: ${txt}`);
  }
  return r.json();
}

async function sbPatch(table, id, patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders(),
    body: JSON.stringify(patch),
  });
  return r.ok;
}

async function sbPost(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify(row),
  });
  return r.json();
}

function substituteVars(template, contact, company) {
  return (template || "")
    .replace(/\{first_name\}/gi, contact.first_name || contact.name?.split(" ")[0] || "there")
    .replace(/\{company\}/gi, company.name || "your company");
}

export async function onRequestPost(context) {
  const secret = context.request.headers.get("x-drip-secret");
  if (secret !== DRIP_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Read Brevo key from CF env (set BREVO_API_KEY in CF Pages environment variables)
  const BREVO_KEY = (context.env && context.env.BREVO_API_KEY) || "";

  const now = new Date().toISOString();
  const errors = [];
  let sent = 0;
  let skipped = 0;

  try {
    // Fetch up to 5 due active sequences
    const dueSeqs = await sbGet(
      `contact_sequences?status=eq.active&next_send_at=lte.${now}&order=next_send_at.asc&limit=5`
    );

    if (!Array.isArray(dueSeqs) || dueSeqs.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, skipped: 0, errors: [], message: "Nothing due" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    for (const cs of dueSeqs) {
      try {
        // Get the sequence info
        const seqArr = await sbGet(`sequences?id=eq.${cs.sequence_id}&select=*`);
        const sequence = seqArr[0];
        if (!sequence) { skipped++; continue; }

        // Get the current step
        const stepArr = await sbGet(
          `sequence_steps?sequence_id=eq.${cs.sequence_id}&order_index=eq.${cs.current_step}&select=*`
        );
        const step = stepArr[0];
        if (!step) {
          // No step found — mark completed
          await sbPatch("contact_sequences", cs.id, { status: "completed" });
          skipped++;
          continue;
        }

        // Get contact
        const contactArr = await sbGet(`contacts?id=eq.${cs.contact_id}&select=*`);
        const contact = contactArr[0];
        if (!contact) { skipped++; continue; }

        // Get company
        const companyArr = contact.company_id
          ? await sbGet(`companies?id=eq.${contact.company_id}&select=*`)
          : [];
        const company = companyArr[0] || { name: "" };

        // Determine next step
        const nextStepArr = await sbGet(
          `sequence_steps?sequence_id=eq.${cs.sequence_id}&order_index=eq.${cs.current_step + 1}&select=*`
        );
        const nextStep = nextStepArr[0] || null;

        if (step.step_type === "call") {
          // Log call activity, auto-advance
          await sbPost("activities", {
            company_id: contact.company_id,
            contact_id: cs.contact_id,
            type: "call",
            subject: substituteVars(step.subject || "Scheduled call", contact, company),
            body: substituteVars(step.body || "", contact, company),
            direction: "outbound",
            action_type: "scheduled",
            occurred_at: now,
            assigned_to: contact.assigned_to,
          });

          if (nextStep) {
            const nextSendAt = new Date(
              Date.now() + (nextStep.delay_days || 1) * 86400000
            ).toISOString();
            await sbPatch("contact_sequences", cs.id, {
              current_step: cs.current_step + 1,
              last_sent_at: now,
              next_send_at: nextSendAt,
            });
          } else {
            await sbPatch("contact_sequences", cs.id, {
              status: "completed",
              last_sent_at: now,
            });
          }
          skipped++; // call steps don't count as sent emails
          continue;
        }

        // Email step
        if (!contact.email) { skipped++; continue; }

        const sig = getSig(sequence.division, sequence.owner_user_id);
        const sigHtml = buildSigHtml(sig);

        const subjectText = substituteVars(step.subject || "", contact, company);
        const bodyText = substituteVars(step.body || "", contact, company);
        const htmlBody = bodyText.replace(/\n/g, "<br>") + sigHtml;

        // Send via Brevo — NO replyTo field; replies go straight to sender inbox
        const brevoPayload = {
          sender: { name: sig.name, email: sig.email },
          to: [{ email: contact.email, name: contact.name || contact.email }],
          subject: subjectText,
          htmlContent: htmlBody,
          textContent: bodyText,
        };

        const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": BREVO_KEY,
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(brevoPayload),
        });

        const brevoData = await brevoRes.json();

        if (!brevoRes.ok) {
          errors.push({
            contact_id: cs.contact_id,
            error: brevoData?.message || "Brevo send failed",
          });
          skipped++;
          continue;
        }

        const messageId = brevoData?.messageId || null;

        // Log activity
        await sbPost("activities", {
          company_id: contact.company_id,
          contact_id: cs.contact_id,
          type: "email",
          subject: subjectText,
          body: bodyText,
          from_email: sig.email,
          to_email: contact.email,
          direction: "outbound",
          action_type: "sent",
          occurred_at: now,
          assigned_to: contact.assigned_to,
          message_id: messageId,
          reply_received: false,
        });

        // Advance step or complete
        if (nextStep) {
          const nextSendAt = new Date(
            Date.now() + (nextStep.delay_days || 1) * 86400000
          ).toISOString();
          await sbPatch("contact_sequences", cs.id, {
            current_step: cs.current_step + 1,
            last_sent_at: now,
            next_send_at: nextSendAt,
          });
        } else {
          await sbPatch("contact_sequences", cs.id, {
            status: "completed",
            last_sent_at: now,
            next_send_at: null,
          });
        }

        sent++;
      } catch (err) {
        errors.push({ contact_sequence_id: cs.id, error: err.message });
        skipped++;
      }
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ sent, skipped, errors: [err.message] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ sent, skipped, errors }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/inbox-poll
 * Polls Chris Geary's actual inbox via Microsoft Graph API for replies to drip emails.
 * Auth: x-drip-secret header
 *
 * Graph credentials from CF env vars: GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID
 * Watches: cgeary@spectrumadvanced.com inbox
 * Matches replies by subject (strips "Re: ") against activities table
 * On match: marks activity reply_received=true, pauses contact_sequence
 */

const DRIP_SECRET = "drip-run-8f3k2p";
const SUPABASE_URL = "https://tplkmtmuoyslmjewcudk.supabase.co";
const SUPABASE_KEY = "sb_publishable_0zCOvDy91vkLrXrxf8m4aA_jPM_TJVa";
const CHRIS_EMAIL = "cgeary@spectrumadvanced.com";

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

async function sbPatch(table, filter, patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: sbHeaders(),
    body: JSON.stringify(patch),
  });
  return r.ok;
}

async function getGraphToken(clientId, clientSecret, tenantId) {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const r = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Graph token error ${r.status}: ${txt}`);
  }

  const data = await r.json();
  return data.access_token;
}

export async function onRequestPost(context) {
  const secret = context.request.headers.get("x-drip-secret");
  if (secret !== DRIP_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get Graph credentials from env
  const clientId = context.env?.GRAPH_CLIENT_ID;
  const clientSecret = context.env?.GRAPH_CLIENT_SECRET;
  const tenantId = context.env?.GRAPH_TENANT_ID;

  if (!clientId || !clientSecret || !tenantId) {
    return new Response(
      JSON.stringify({ error: "Graph credentials not configured (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID)" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let token;
  try {
    token = await getGraphToken(clientId, clientSecret, tenantId);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Failed to get Graph token: ${err.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build 24h-ago timestamp in ISO format
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch inbox messages received in last 24h
  let messages = [];
  try {
    const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
    const select = "subject,from,receivedDateTime,bodyPreview";
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${CHRIS_EMAIL}/mailFolders/inbox/messages?$filter=${filter}&$select=${select}&$top=50`;

    const graphRes = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!graphRes.ok) {
      const txt = await graphRes.text();
      throw new Error(`Graph inbox fetch error ${graphRes.status}: ${txt}`);
    }

    const graphData = await graphRes.json();
    messages = graphData.value || [];
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Graph inbox error: ${err.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Filter for replies (subject starts with "Re:")
  const replies = messages.filter((m) =>
    /^re:/i.test((m.subject || "").trim())
  );

  const checked = messages.length;
  let repliesFound = 0;
  const matchLog = [];

  for (const reply of replies) {
    try {
      // Strip "Re: " prefix (handle multiple Re: Re:)
      const originalSubject = (reply.subject || "")
        .replace(/^(re:\s*)+/i, "")
        .trim();

      const senderEmail = reply.from?.emailAddress?.address?.toLowerCase() || "";

      // Look for matching outbound activity
      // Match by subject (case-insensitive) and direction=outbound, type=email
      const subjectEncoded = encodeURIComponent(originalSubject);
      const activities = await sbGet(
        `activities?type=eq.email&direction=eq.outbound&subject=eq.${subjectEncoded}&reply_received=eq.false&select=id,contact_id,subject,to_email`
      );

      let matchedActivity = null;

      if (activities.length > 0) {
        // If we have a sender email, try to find the contact and narrow down
        if (senderEmail) {
          // Look for contact with this email
          const contacts = await sbGet(
            `contacts?email=eq.${encodeURIComponent(senderEmail)}&select=id`
          );
          if (contacts.length > 0) {
            const contactId = contacts[0].id;
            // Find activity for this specific contact
            matchedActivity =
              activities.find((a) => a.contact_id === contactId) ||
              activities[0];
          } else {
            matchedActivity = activities[0];
          }
        } else {
          matchedActivity = activities[0];
        }
      }

      if (matchedActivity) {
        // Mark reply_received on the activity
        await sbPatch("activities", `id=eq.${matchedActivity.id}`, {
          reply_received: true,
          opened_at: reply.receivedDateTime || new Date().toISOString(),
        });

        // Pause the active contact_sequence for this contact
        if (matchedActivity.contact_id) {
          await sbPatch(
            "contact_sequences",
            `contact_id=eq.${matchedActivity.contact_id}&status=eq.active`,
            { status: "paused" }
          );
        }

        repliesFound++;
        matchLog.push({
          subject: reply.subject,
          from: senderEmail,
          activity_id: matchedActivity.id,
          contact_id: matchedActivity.contact_id,
        });
      }
    } catch (err) {
      // Log but continue
      matchLog.push({ error: err.message, subject: reply.subject });
    }
  }

  return new Response(
    JSON.stringify({ checked, replies_found: repliesFound, log: matchLog }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

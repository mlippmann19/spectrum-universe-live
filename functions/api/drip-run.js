/**
 * POST /api/drip-run
 * Scheduled entry-point (called by Cloudflare Cron or external cron).
 * Auth: x-drip-secret header
 * Checks M-F, 9am-4pm ET, then calls drip-send and inbox-poll.
 */

const DRIP_SECRET = "drip-run-8f3k2p";

function isBusinessHoursET() {
  // Get current time in US/Eastern
  const now = new Date();
  const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etString);
  const day = et.getDay(); // 0=Sun, 6=Sat
  const hour = et.getHours();
  // M-F only, 9am-4pm ET
  if (day === 0 || day === 6) return { ok: false, reason: "Weekend" };
  if (hour < 9 || hour >= 16) return { ok: false, reason: `Outside business hours (${hour}:00 ET)` };
  return { ok: true, reason: `Business hours (${hour}:00 ET, day ${day})` };
}

export async function onRequestPost(context) {
  const secret = context.request.headers.get("x-drip-secret");
  if (secret !== DRIP_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { ok, reason } = isBusinessHoursET();
  if (!ok) {
    return new Response(
      JSON.stringify({ ok: true, triggered: false, reason }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const origin = new URL(context.request.url).origin;
  let dripResult = null;
  let pollResult = null;
  const errors = [];

  // Call drip-send
  try {
    const dripRes = await fetch(`${origin}/api/drip-send`, {
      method: "POST",
      headers: {
        "x-drip-secret": DRIP_SECRET,
        "Content-Type": "application/json",
      },
    });
    dripResult = await dripRes.json();
  } catch (err) {
    errors.push({ source: "drip-send", error: err.message });
  }

  // Trigger inbox-poll as background task (non-blocking)
  try {
    const pollPromise = fetch(`${origin}/api/inbox-poll`, {
      method: "POST",
      headers: {
        "x-drip-secret": DRIP_SECRET,
        "Content-Type": "application/json",
      },
    }).then((r) => r.json()).catch((e) => ({ error: e.message }));

    // Use waitUntil if available, otherwise fire-and-forget
    if (context.waitUntil) {
      context.waitUntil(pollPromise);
      pollResult = { status: "background" };
    } else {
      pollResult = await pollPromise;
    }
  } catch (err) {
    errors.push({ source: "inbox-poll", error: err.message });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      triggered: true,
      reason,
      drip: dripResult,
      poll: pollResult,
      errors,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

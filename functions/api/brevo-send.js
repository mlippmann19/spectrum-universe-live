export async function onRequestPost(context) {
  try {
    const BREVO_KEY = context.env.BREVO_API_KEY;
    const { to_email, to_name, subject, body } = await context.request.json();
    if (!to_email || !subject || !body) {
      return new Response(JSON.stringify({ error: 'to_email, subject, and body are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Matt Lippmann', email: 'mlippmann@spectrumadvanced.com' },
        to: [{ email: to_email, name: to_name || to_email }],
        subject,
        textContent: body,
      }),
    });
    const data = await r.json();
    return new Response(JSON.stringify({ ok: r.ok, messageId: data?.messageId }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

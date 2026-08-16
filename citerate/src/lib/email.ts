/**
 * Transactional email via Resend. Templates are the Phase 4 designs, inlined.
 * 3,000 sends/month free; inbound support mail routes through Cloudflare Email
 * Routing for nothing.
 */
import type { Env } from "./env";

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function send(env: Env, args: SendArgs): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY missing — logging instead of sending", args.subject);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? "Citerate <hello@citerate.com>",
        to: Array.isArray(args.to) ? args.to : [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
        reply_to: args.replyTo
      })
    });
    return res.ok;
  } catch (e) {
    console.error("[email] send failed", e);
    return false;
  }
}

// --- shared shell -----------------------------------------------------------
const SHELL = (body: string, preheader: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Citerate</title></head>
<body style="margin:0;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#141B26">
<div style="display:none;max-height:0;overflow:hidden">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E2E5EA;border-radius:10px">
<tr><td style="padding:28px 32px">
<div style="font:600 20px/1 Georgia,serif;letter-spacing:-0.01em;color:#141B26">Citerate</div>
${body}
</td></tr></table>
<div style="max-width:560px;margin:16px auto 0;font:400 11px/1.5 ui-monospace,Menlo,monospace;color:#8A93A1;text-align:left">
Citerate · AI visibility measurement · <a href="{{unsubscribe}}" style="color:#8A93A1">unsubscribe</a>
</div>
</td></tr></table></body></html>`;

export function scanReadyEmail(siteUrl: string, hostname: string, token: string, rate: number) {
  const pct = Math.round(rate * 100);
  return SHELL(
    `<div style="font:500 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8A93A1;margin-top:22px">Scan complete</div>
<h1 style="margin:12px 0 0;font:600 28px/1.2 Georgia,serif;letter-spacing:-0.02em">${hostname} is cited in ${pct}% of AI answer runs</h1>
<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#5B6472">Your causes are separated and your top three fixes are ranked. The result stays available for 90 days.</p>
<a href="${siteUrl}/scan/${token}" style="display:inline-block;margin-top:22px;background:#0E7C66;color:#FFFFFF;text-decoration:none;font-weight:500;font-size:15px;padding:14px 22px;border-radius:6px">Open your readout</a>
<p style="margin:20px 0 0;font:400 11.5px/1.6 ui-monospace,Menlo,monospace;color:#8A93A1">Method: 25 queries, 2 engines, 3 runs each, US region, unpersonalized. What the score cannot see is listed on the readout.</p>`,
    `${hostname}: ${pct}% citation rate`
  );
}

export function contactNotifyEmail(intent: string, name: string, email: string, context: string, message: string) {
  return SHELL(
    `<div style="font:500 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8A93A1;margin-top:22px">New ${intent} request</div>
<h1 style="margin:12px 0 0;font:600 24px/1.25 Georgia,serif">${name}</h1>
<p style="margin:10px 0 0;font:400 13px/1.6 ui-monospace,Menlo,monospace;color:#5B6472">${email}<br>${context}</p>
<div style="margin:18px 0 0;padding:16px;background:#F4F5F7;border-radius:8px;font-size:14px;line-height:1.6;color:#141B26;white-space:pre-wrap">${message}</div>`,
    `${intent}: ${name}`
  );
}

export function contactAckEmail(intent: string, sla: string) {
  return SHELL(
    `<div style="font:500 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8A93A1;margin-top:22px">Received</div>
<h1 style="margin:12px 0 0;font:600 24px/1.25 Georgia,serif">We have your ${intent} request</h1>
<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#5B6472">${sla}</p>`,
    "We received your message"
  );
}

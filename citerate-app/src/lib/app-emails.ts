/**
 * App-side transactional emails. The marketing repo owns the scan and contact
 * templates; these three belong to the dashboard. Same shell: 600px, system
 * fonts, one accent, no images — an email that renders in every client beats an
 * email that looks designed in one.
 */
const SHELL = (body: string, footer = "You're receiving this because someone used your address on Citerate.") => `<!doctype html>
<html><body style="margin:0;background:#F4F5F7;padding:24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#FFFFFF;border:1px solid #E2E5EA;border-radius:14px;padding:32px">
<tr><td style="font:500 17px ui-monospace,Menlo,monospace;letter-spacing:-.03em;color:#141B26">cite<span style="color:#0E7C66">/</span>rate</td></tr>
<tr><td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#141B26">${body}</td></tr>
<tr><td style="padding-top:24px;border-top:1px solid #E2E5EA;font:400 11.5px/1.5 ui-monospace,Menlo,monospace;color:#8A93A1">${footer}</td></tr>
</table></td></tr></table></body></html>`;

const BUTTON = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#0E7C66;color:#FFFFFF;text-decoration:none;font:500 14px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;padding:13px 20px;border-radius:6px">${label}</a>`;

export function signInEmail(code: string, link: string) {
  return {
    subject: `Your Citerate sign-in code: ${code}`,
    html: SHELL(
      `<div style="font:600 26px/1.3 Georgia,'Times New Roman',serif;margin-top:20px">Sign in to Citerate</div>
       <p style="font-size:15px;line-height:1.6;color:#5B6472">Use the code, or click the button. Either works once, and both expire in 15 minutes.</p>
       <div style="font:500 30px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;background:#F4F5F7;border-radius:10px;padding:18px;text-align:center;margin:18px 0">${code}</div>
       <div style="margin:18px 0">${BUTTON(link, "Sign in")}</div>
       <p style="font-size:13px;line-height:1.6;color:#8A93A1">If you didn't ask for this, ignore it — no account was created and nothing changed.</p>`
    ),
    text: `Sign in to Citerate\n\nCode: ${code}\nLink: ${link}\n\nBoth expire in 15 minutes and work once. If you didn't ask for this, ignore it.`
  };
}

export function inviteEmail(inviter: string, workspace: string, role: string, link: string) {
  return {
    subject: `${inviter} invited you to ${workspace} on Citerate`,
    html: SHELL(
      `<div style="font:600 26px/1.3 Georgia,'Times New Roman',serif;margin-top:20px">Join ${workspace}</div>
       <p style="font-size:15px;line-height:1.6;color:#5B6472">${inviter} added you as <strong>${role}</strong>. Citerate measures whether a domain is cited in AI answers — and why not, when it isn't.</p>
       <div style="margin:18px 0">${BUTTON(link, "Accept invitation")}</div>
       <p style="font-size:13px;line-height:1.6;color:#8A93A1">The invite expires in 7 days. Client seats are read-only and free.</p>`
    ),
    text: `${inviter} added you to ${workspace} as ${role}.\n\n${link}\n\nThe invite expires in 7 days.`
  };
}

export function joinApprovedEmail(workspace: string, hostname: string, appUrl: string) {
  return {
    subject: `You've been added to ${workspace} on Citerate`,
    html: SHELL(
      `<div style="font:600 26px/1.3 Georgia,'Times New Roman',serif;margin-top:20px">You're in</div>
       <p style="font-size:15px;line-height:1.6;color:#5B6472">Your request to join ${workspace} (${hostname}) was approved.</p>
       <div style="margin:18px 0">${BUTTON(`${appUrl}/overview`, "Open the readout")}</div>`
    ),
    text: `Your request to join ${workspace} (${hostname}) was approved. Sign in at ${appUrl}/sign-in.`
  };
}

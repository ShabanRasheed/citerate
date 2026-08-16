/**
 * Email change, step 1: issue an email_change token to the NEW address and notify
 * the old one. Step 2 lands on /verify, which consumes the token; the kind tells
 * it to update the user row rather than create a session.
 */
import type { APIRoute } from "astro";
import { env, one, fail } from "../../../lib/db";
import { issueToken, audit } from "../../../lib/auth";
import { send as sendEmail } from "../../../lib/email";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const user = ctx.locals.user;
  if (!user) return fail("unauthorised", 401);

  const form = await ctx.request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ctx.redirect("/settings/email?error=invalid", 303);

  const taken = await one<{ id: string }>(e.DB, `SELECT id FROM users WHERE email = ?`, email);
  // Neutral response: we do not confirm whether an address is already in use.
  if (!taken) {
    const { secret, code } = await issueToken(e, email, "email_change", user.id);
    const link = `${e.PUBLIC_APP_URL}/verify?t=${secret}&c=${code}&next=/settings`;

    await sendEmail(e, {
      to: email,
      subject: "Confirm your new Citerate address",
      html: `<p style="font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">Confirm this address for your Citerate account: <a href="${link}">${link}</a></p><p style="font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#5B6472">The link expires in 15 minutes. Until you confirm, ${user.email} stays on the account.</p>`,
      text: `Confirm this address for your Citerate account:\n${link}\n\nExpires in 15 minutes.`
    }).catch(() => false);

    await sendEmail(e, {
      to: user.email,
      subject: "Someone requested an email change on your Citerate account",
      html: `<p style="font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">A change to <strong>${email}</strong> was requested. If that wasn't you, sign in and use “sign out everywhere else” — the change cannot complete without the new address confirming.</p>`,
      text: `A change to ${email} was requested on your Citerate account. If that wasn't you, sign in and revoke other sessions.`
    }).catch(() => false);

    await audit(e, ctx.locals.workspace?.workspaceId ?? null, user.id, "email.change_requested", email);
  }

  return ctx.redirect("/settings/email?sent=1", 303);
};

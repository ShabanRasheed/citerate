import type { APIRoute } from "astro";
import { env } from "../lib/db";
import { destroySession } from "../lib/session";

export const prerender = false;

const out: APIRoute = async (ctx) => {
  await destroySession(env(ctx), ctx.cookies);
  ctx.cookies.delete("cr_ws", { path: "/" });
  const site = import.meta.env.PUBLIC_SITE_URL ?? "/sign-in";
  return ctx.redirect(`${site}?signed_out=1`, 302);
};

// GET so a plain link works; POST for forms that want CSRF-safe sign-out.
export const GET = out;
export const POST = out;

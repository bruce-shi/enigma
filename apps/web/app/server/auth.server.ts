import { stripe } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import Stripe from "stripe";
import { createDb, type EnigmaDatabase } from "./db/db.server";
import { schema } from "./db/schema";

export function createStripeClient(env: Pick<Env, "STRIPE_SECRET_KEY">) {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-07-29.dahlia",
  });
}

export function createAuth(
  env: Env,
  stripeClient = createStripeClient(env),
  db: EnigmaDatabase = createDb(env),
) {
  return betterAuth({
    appName: "Enigma",
    baseURL: env.PUBLIC_ORIGIN,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_ORIGIN, "enigma://"],
    advanced: {
      cookiePrefix: "enigma",
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        sendMagicLink: async ({ email, url }) => {
          await env.EMAIL.send({
            to: email,
            from: env.EMAIL_FROM,
            subject: "Your Enigma sign-in link",
            text: `Open this one-time link to sign in to Enigma. It expires in 10 minutes:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
            html: `<h1>Sign in to Enigma</h1><p>This one-time link expires in 10 minutes.</p><p><a href="${escapeAttribute(url)}">Sign in to Enigma</a></p><p>If you did not request this, you can ignore this email.</p>`,
          });
        },
      }),
      stripe({
        stripeClient,
        stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
        createCustomerOnSignUp: true,
        subscription: {
          enabled: true,
          requireEmailVerification: true,
          plans: [
            {
              name: "enigma",
              priceId: env.STRIPE_MONTHLY_PRICE_ID,
              annualDiscountPriceId: env.STRIPE_YEARLY_PRICE_ID,
              freeTrial: { days: 7 },
            },
          ],
          getCheckoutSessionParams: async () => ({
            params: {
              payment_method_collection: "always",
              allow_promotion_codes: true,
            },
          }),
        },
      }),
    ],
  });
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export type EnigmaAuth = ReturnType<typeof createAuth>;

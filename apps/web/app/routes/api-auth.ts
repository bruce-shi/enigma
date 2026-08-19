import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createAuth, createStripeClient } from "../server/auth.server";
import { createDb } from "../server/db/db.server";
import { envFrom } from "../server/http.server";
import {
  DrizzleStripeWebhookStore,
  handleIdempotentStripeWebhook,
} from "../server/stripe-webhook.server";

export function loader({ request, context }: LoaderFunctionArgs) {
  return createAuth(envFrom(context)).handler(request);
}

export function action({ request, context }: ActionFunctionArgs) {
  const env = envFrom(context);
  const stripeClient = createStripeClient(env);
  const db = createDb(env);
  const auth = createAuth(env, stripeClient, db);
  if (new URL(request.url).pathname !== "/api/auth/stripe/webhook") {
    return auth.handler(request);
  }
  return handleIdempotentStripeWebhook(
    request,
    stripeClient,
    env.STRIPE_WEBHOOK_SECRET,
    new DrizzleStripeWebhookStore(db),
    (verifiedRequest) => auth.handler(verifiedRequest),
  );
}

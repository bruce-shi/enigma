import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStripeClient } from "./auth.server";
import {
  handleIdempotentStripeWebhook,
  isOlderSubscriptionEvent,
  type StripeWebhookCursor,
  type StripeWebhookRecord,
  type StripeWebhookStore,
} from "./stripe-webhook.server";

const webhookSecret = "whsec_enigma_test_secret";
const stripeClient = createStripeClient({ STRIPE_SECRET_KEY: "sk_test_enigma" });

class MemoryStripeWebhookStore implements StripeWebhookStore {
  readonly events = new Map<string, { processed: boolean; record: StripeWebhookRecord }>();
  readonly cursors = new Map<string, StripeWebhookCursor>();

  async claim(record: StripeWebhookRecord) {
    const existing = this.events.get(record.id);
    if (existing) return existing.processed ? ("processed" as const) : ("processing" as const);
    this.events.set(record.id, { processed: false, record });
    return "claimed" as const;
  }

  async latest(objectId: string) {
    return this.cursors.get(objectId) ?? null;
  }

  async complete(record: StripeWebhookRecord) {
    this.events.set(record.id, { processed: true, record });
    if (record.objectId) {
      const cursor = this.cursors.get(record.objectId);
      if (cursor && isOlderSubscriptionEvent(record, cursor)) return;
      this.cursors.set(record.objectId, {
        eventType: record.eventType,
        eventCreated: record.eventCreated,
      });
    }
  }

  async release(eventId: string) {
    this.events.delete(eventId);
  }
}

let store: MemoryStripeWebhookStore;

beforeEach(() => {
  store = new MemoryStripeWebhookStore();
});

describe("idempotent Stripe webhook boundary", () => {
  it("rejects an invalid signature before claiming or forwarding the event", async () => {
    const event = subscriptionEvent("evt_invalid", "customer.subscription.updated", 20);
    const request = signedRequest(event, "whsec_wrong_secret");
    const forward = vi.fn(async () => Response.json({ success: true }));

    const response = await handleIdempotentStripeWebhook(
      request,
      stripeClient,
      webhookSecret,
      store,
      forward,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_STRIPE_SIGNATURE" },
    });
    expect(store.events.size).toBe(0);
    expect(forward).not.toHaveBeenCalled();
  });

  it("forwards a signed event once and acknowledges its event-id replay", async () => {
    const event = subscriptionEvent("evt_once", "customer.subscription.updated", 20);
    const payload = JSON.stringify(event);
    const forward = vi.fn(async (request: Request) => {
      expect(await request.text()).toBe(payload);
      return Response.json({ success: true });
    });

    const first = await handleIdempotentStripeWebhook(
      signedRequest(event),
      stripeClient,
      webhookSecret,
      store,
      forward,
    );
    const replay = await handleIdempotentStripeWebhook(
      signedRequest(event),
      stripeClient,
      webhookSecret,
      store,
      forward,
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ success: true, duplicate: true });
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("releases a failed delivery so Stripe can retry it", async () => {
    const event = subscriptionEvent("evt_retry", "customer.subscription.updated", 20);
    const forward = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ success: true }));

    const failed = await handleIdempotentStripeWebhook(
      signedRequest(event),
      stripeClient,
      webhookSecret,
      store,
      forward,
    );
    const retried = await handleIdempotentStripeWebhook(
      signedRequest(event),
      stripeClient,
      webhookSecret,
      store,
      forward,
    );

    expect(failed.status).toBe(503);
    expect(retried.status).toBe(200);
    expect(forward).toHaveBeenCalledTimes(2);
    expect(store.events.get(event.id)?.processed).toBe(true);
  });

  it("acknowledges stale subscription snapshots without regressing current state", async () => {
    const current = subscriptionEvent("evt_current", "customer.subscription.deleted", 20);
    const older = subscriptionEvent("evt_older", "customer.subscription.updated", 19);
    const sameSecondLowerRank = subscriptionEvent(
      "evt_same_second",
      "customer.subscription.updated",
      20,
    );
    const forward = vi.fn(async () => Response.json({ success: true }));

    await handleIdempotentStripeWebhook(
      signedRequest(current),
      stripeClient,
      webhookSecret,
      store,
      forward,
    );
    const olderResponse = await handleIdempotentStripeWebhook(
      signedRequest(older),
      stripeClient,
      webhookSecret,
      store,
      forward,
    );
    const sameSecondResponse = await handleIdempotentStripeWebhook(
      signedRequest(sameSecondLowerRank),
      stripeClient,
      webhookSecret,
      store,
      forward,
    );

    await expect(olderResponse.json()).resolves.toEqual({ success: true, stale: true });
    await expect(sameSecondResponse.json()).resolves.toEqual({ success: true, stale: true });
    expect(forward).toHaveBeenCalledTimes(1);
  });
});

function subscriptionEvent(
  id: string,
  type:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted",
  created: number,
): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created,
    data: {
      object: {
        id: "sub_enigma",
        object: "subscription",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  } as unknown as Stripe.Event;
}

function signedRequest(event: Stripe.Event, signingSecret = webhookSecret): Request {
  const payload = JSON.stringify(event);
  const signature = stripeClient.webhooks.generateTestHeaderString({
    payload,
    secret: signingSecret,
  });
  return new Request("https://enigma.example/api/auth/stripe/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
}

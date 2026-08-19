import { and, eq, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import type { EnigmaDatabase } from "./db/db.server";
import { stripeWebhookCursor, stripeWebhookEvent } from "./db/schema";

export interface StripeWebhookRecord {
  id: string;
  eventType: string;
  objectId: string | null;
  eventCreated: number;
}

export interface StripeWebhookCursor {
  eventType: string;
  eventCreated: number;
}

export interface StripeWebhookStore {
  claim(record: StripeWebhookRecord): Promise<"claimed" | "processed" | "processing">;
  latest(objectId: string): Promise<StripeWebhookCursor | null>;
  complete(record: StripeWebhookRecord): Promise<void>;
  release(eventId: string): Promise<void>;
}

export class DrizzleStripeWebhookStore implements StripeWebhookStore {
  constructor(private readonly db: EnigmaDatabase) {}

  async claim(record: StripeWebhookRecord) {
    const inserted = await this.db
      .insert(stripeWebhookEvent)
      .values({
        id: record.id,
        eventType: record.eventType,
        objectId: record.objectId,
        eventCreated: record.eventCreated,
        receivedAt: new Date(),
      })
      .onConflictDoNothing({ target: stripeWebhookEvent.id })
      .returning({ id: stripeWebhookEvent.id });
    if (inserted.length > 0) return "claimed" as const;

    const [existing] = await this.db
      .select({ processedAt: stripeWebhookEvent.processedAt })
      .from(stripeWebhookEvent)
      .where(eq(stripeWebhookEvent.id, record.id))
      .limit(1);
    return existing?.processedAt ? ("processed" as const) : ("processing" as const);
  }

  async latest(objectId: string) {
    const [cursor] = await this.db
      .select({
        eventType: stripeWebhookCursor.eventType,
        eventCreated: stripeWebhookCursor.eventCreated,
      })
      .from(stripeWebhookCursor)
      .where(eq(stripeWebhookCursor.objectId, objectId))
      .limit(1);
    return cursor ?? null;
  }

  async complete(record: StripeWebhookRecord) {
    const processedAt = new Date();
    const markProcessed = this.db
      .update(stripeWebhookEvent)
      .set({ processedAt })
      .where(and(eq(stripeWebhookEvent.id, record.id), isNull(stripeWebhookEvent.processedAt)));
    if (!record.objectId) {
      await markProcessed;
      return;
    }
    const advanceCursor = this.db
      .insert(stripeWebhookCursor)
      .values({
        objectId: record.objectId,
        eventId: record.id,
        eventType: record.eventType,
        eventCreated: record.eventCreated,
        processedAt,
      })
      .onConflictDoUpdate({
        target: stripeWebhookCursor.objectId,
        set: {
          eventId: record.id,
          eventType: record.eventType,
          eventCreated: record.eventCreated,
          processedAt,
        },
        setWhere: sql`excluded.event_created > ${stripeWebhookCursor.eventCreated}
          OR (excluded.event_created = ${stripeWebhookCursor.eventCreated} AND
              CASE excluded.event_type
                WHEN 'customer.subscription.deleted' THEN 3
                WHEN 'customer.subscription.updated' THEN 2
                WHEN 'customer.subscription.created' THEN 1
                ELSE 0
              END >=
              CASE ${stripeWebhookCursor.eventType}
                WHEN 'customer.subscription.deleted' THEN 3
                WHEN 'customer.subscription.updated' THEN 2
                WHEN 'customer.subscription.created' THEN 1
                ELSE 0
              END)`,
      });
    await this.db.batch([markProcessed, advanceCursor]);
  }

  async release(eventId: string) {
    await this.db
      .delete(stripeWebhookEvent)
      .where(and(eq(stripeWebhookEvent.id, eventId), isNull(stripeWebhookEvent.processedAt)));
  }
}

interface WebhookRequestLike {
  headers: { get(name: string): string | null };
  clone(): unknown;
  text(): Promise<string>;
}

export async function handleIdempotentStripeWebhook<TRequest extends WebhookRequestLike>(
  request: TRequest,
  stripeClient: Stripe,
  webhookSecret: string,
  store: StripeWebhookStore,
  forward: (verifiedRequest: TRequest) => Promise<Response>,
): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return webhookError("STRIPE_SIGNATURE_REQUIRED", "Stripe signature is required");

  const verifiedRequest = request.clone() as TRequest;
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripeClient.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch {
    return webhookError("INVALID_STRIPE_SIGNATURE", "Stripe signature is invalid");
  }

  const record: StripeWebhookRecord = {
    id: event.id,
    eventType: event.type,
    objectId: subscriptionObjectId(event),
    eventCreated: event.created,
  };
  const claim = await store.claim(record);
  if (claim === "processed") return webhookJson({ success: true, duplicate: true });
  if (claim === "processing") {
    return webhookJson(
      { error: { code: "STRIPE_EVENT_IN_PROGRESS", message: "Stripe event is in progress" } },
      { status: 409, headers: { "retry-after": "1" } },
    );
  }

  if (record.objectId) {
    const cursor = await store.latest(record.objectId);
    if (cursor && isOlderSubscriptionEvent(record, cursor)) {
      await store.complete(record);
      return webhookJson({ success: true, stale: true });
    }
  }

  try {
    const response = await forward(verifiedRequest);
    if (response.status < 200 || response.status >= 300) {
      await store.release(record.id);
      return response;
    }
    await store.complete(record);
    return response;
  } catch (error) {
    await store.release(record.id);
    throw error;
  }
}

export function isOlderSubscriptionEvent(
  record: Pick<StripeWebhookRecord, "eventType" | "eventCreated">,
  cursor: StripeWebhookCursor,
): boolean {
  if (record.eventCreated !== cursor.eventCreated) {
    return record.eventCreated < cursor.eventCreated;
  }
  return subscriptionEventRank(record.eventType) < subscriptionEventRank(cursor.eventType);
}

function subscriptionObjectId(event: Stripe.Event): string | null {
  if (!event.type.startsWith("customer.subscription.")) return null;
  const object = event.data.object;
  if (!("id" in object) || typeof object.id !== "string") return null;
  return object.id;
}

function subscriptionEventRank(eventType: string): number {
  if (eventType === "customer.subscription.deleted") return 3;
  if (eventType === "customer.subscription.updated") return 2;
  if (eventType === "customer.subscription.created") return 1;
  return 0;
}

function webhookError(code: string, message: string) {
  return webhookJson({ error: { code, message } }, { status: 400 });
}

function webhookJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

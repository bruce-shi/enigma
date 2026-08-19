import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const isoDate = customType<{ data: Date; driverData: string }>({
  dataType: () => "text",
  fromDriver: (value) => new Date(value),
  toDriver: (value) => value.toISOString(),
});

export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text(),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: isoDate("created_at").notNull(),
  updatedAt: isoDate("updated_at").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: isoDate("expires_at").notNull(),
    token: text().notNull().unique(),
    createdAt: isoDate("created_at").notNull(),
    updatedAt: isoDate("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    issuer: text().notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: isoDate("access_token_expires_at"),
    refreshTokenExpiresAt: isoDate("refresh_token_expires_at"),
    scope: text(),
    password: text(),
    createdAt: isoDate("created_at").notNull(),
    updatedAt: isoDate("updated_at").notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: isoDate("expires_at").notNull(),
    createdAt: isoDate("created_at"),
    updatedAt: isoDate("updated_at"),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const subscription = sqliteTable(
  "subscription",
  {
    id: text().primaryKey(),
    plan: text().notNull(),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text().notNull().default("incomplete"),
    periodStart: isoDate("period_start"),
    periodEnd: isoDate("period_end"),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).default(false),
    seats: integer(),
    trialStart: isoDate("trial_start"),
    trialEnd: isoDate("trial_end"),
    cancelAt: isoDate("cancel_at"),
    canceledAt: isoDate("canceled_at"),
    endedAt: isoDate("ended_at"),
    createdAt: isoDate("created_at").notNull(),
    updatedAt: isoDate("updated_at").notNull(),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
  },
  (table) => [
    index("subscription_reference_idx").on(table.referenceId),
    uniqueIndex("subscription_stripe_id_idx").on(table.stripeSubscriptionId),
  ],
);

export const desktopAuthRequest = sqliteTable(
  "desktop_auth_request",
  {
    id: text().primaryKey(),
    state: text().notNull(),
    codeChallenge: text("code_challenge").notNull(),
    installationPublicKey: text("installation_public_key").notNull(),
    computerName: text("computer_name").notNull(),
    platform: text().notNull(),
    channel: text().notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    activationId: text("activation_id"),
    authorizationCodeHash: text("authorization_code_hash"),
    expiresAt: isoDate("expires_at").notNull(),
    createdAt: isoDate("created_at").notNull(),
    approvedAt: isoDate("approved_at"),
    consumedAt: isoDate("consumed_at"),
  },
  (table) => [
    index("desktop_auth_request_expiry_idx").on(table.expiresAt),
    check("desktop_auth_request_platform_check", sql`${table.platform} IN ('macos', 'windows')`),
    check("desktop_auth_request_channel_check", sql`${table.channel} IN ('stable', 'beta')`),
  ],
);

export const desktopActivation = sqliteTable(
  "desktop_activation",
  {
    id: text().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    authRequestId: text("auth_request_id").notNull().unique(),
    slot: integer().notNull(),
    installationPublicKey: text("installation_public_key").notNull(),
    name: text().notNull(),
    platform: text().notNull(),
    channel: text().notNull(),
    createdAt: isoDate("created_at").notNull(),
    lastSeenAt: isoDate("last_seen_at").notNull(),
    revokedAt: isoDate("revoked_at"),
  },
  (table) => [
    index("desktop_activation_user_idx").on(table.userId, table.revokedAt),
    uniqueIndex("desktop_activation_active_slot_idx")
      .on(table.userId, table.slot)
      .where(sql`${table.revokedAt} IS NULL`),
    check("desktop_activation_slot_check", sql`${table.slot} IN (1, 2)`),
    check("desktop_activation_platform_check", sql`${table.platform} IN ('macos', 'windows')`),
    check("desktop_activation_channel_check", sql`${table.channel} IN ('stable', 'beta')`),
  ],
);

export const desktopRefreshToken = sqliteTable(
  "desktop_refresh_token",
  {
    id: text().primaryKey(),
    activationId: text("activation_id")
      .notNull()
      .references(() => desktopActivation.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: isoDate("expires_at").notNull(),
    createdAt: isoDate("created_at").notNull(),
    authorizationRequestId: text("authorization_request_id").unique(),
    rotatedFrom: text("rotated_from").unique(),
    revokedAt: isoDate("revoked_at"),
    rotatedTo: text("rotated_to"),
  },
  (table) => [index("desktop_refresh_activation_idx").on(table.activationId, table.revokedAt)],
);

export const stripeWebhookEvent = sqliteTable(
  "stripe_webhook_event",
  {
    id: text().primaryKey(),
    eventType: text("event_type").notNull(),
    objectId: text("object_id"),
    eventCreated: integer("event_created").notNull(),
    receivedAt: isoDate("received_at").notNull(),
    processedAt: isoDate("processed_at"),
  },
  (table) => [index("stripe_webhook_event_object_idx").on(table.objectId, table.eventCreated)],
);

export const stripeWebhookCursor = sqliteTable("stripe_webhook_cursor", {
  objectId: text("object_id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => stripeWebhookEvent.id),
  eventType: text("event_type").notNull(),
  eventCreated: integer("event_created").notNull(),
  processedAt: isoDate("processed_at").notNull(),
});

export const schema = {
  account,
  desktopActivation,
  desktopAuthRequest,
  desktopRefreshToken,
  session,
  stripeWebhookCursor,
  stripeWebhookEvent,
  subscription,
  user,
  verification,
};

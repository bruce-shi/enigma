import { desc, eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "../server/db/db.server";
import { desktopActivation, subscription as subscriptionTable } from "../server/db/schema";
import {
  createEntitlementPayload,
  isActiveDesktopActivation,
  issueEntitlement,
  verifyAccessToken,
} from "../server/desktop-auth.server";
import { bearerToken, envFrom, json } from "../server/http.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = envFrom(context);
  const claims = await verifyAccessToken(bearerToken(request), env);
  const db = createDb(env);
  const [activation] = await db
    .select({
      id: desktopActivation.id,
      userId: desktopActivation.userId,
      revokedAt: desktopActivation.revokedAt,
    })
    .from(desktopActivation)
    .where(eq(desktopActivation.id, claims.activationId))
    .limit(1);
  if (!isActiveDesktopActivation(activation, claims))
    return json(
      { error: { code: "ACTIVATION_REVOKED", message: "Computer activation is revoked" } },
      { status: 403 },
    );
  const [subscription] = await db
    .select({
      status: subscriptionTable.status,
      billingInterval: subscriptionTable.billingInterval,
    })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.referenceId, claims.userId))
    .orderBy(desc(subscriptionTable.updatedAt))
    .limit(1);
  const payload = createEntitlementPayload(claims.activationId, subscription);
  if (!payload)
    return json(
      {
        error: {
          code: "SUBSCRIPTION_REQUIRED",
          message: "An active subscription or trial is required",
        },
      },
      { status: 402 },
    );

  const token = await issueEntitlement(payload, env);
  await db
    .update(desktopActivation)
    .set({ lastSeenAt: new Date() })
    .where(eq(desktopActivation.id, claims.activationId));
  return json({ token, payload });
}

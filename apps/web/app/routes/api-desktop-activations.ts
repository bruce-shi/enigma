import { and, desc, eq, isNull } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { createDb } from "../server/db/db.server";
import { desktopActivation, desktopRefreshToken } from "../server/db/schema";
import { assertSameOrigin, envFrom, json, readJson, requireSession } from "../server/http.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = envFrom(context);
  const session = await requireSession(request, env);
  const activations = await createDb(env)
    .select({
      id: desktopActivation.id,
      name: desktopActivation.name,
      platform: desktopActivation.platform,
      channel: desktopActivation.channel,
      createdAt: desktopActivation.createdAt,
      lastSeenAt: desktopActivation.lastSeenAt,
      revokedAt: desktopActivation.revokedAt,
    })
    .from(desktopActivation)
    .where(eq(desktopActivation.userId, session.user.id))
    .orderBy(desc(desktopActivation.createdAt));
  return json({ activations });
}

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("rename"),
      activationId: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z.object({ action: z.literal("revoke"), activationId: z.string().uuid() }).strict(),
]);

export async function action({ request, context }: ActionFunctionArgs) {
  const env = envFrom(context);
  assertSameOrigin(request, env);
  const session = await requireSession(request, env);
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success)
    return json(
      { error: { code: "INVALID_REQUEST", message: "Invalid activation update" } },
      { status: 400 },
    );
  const db = createDb(env);
  if (parsed.data.action === "rename") {
    await db
      .update(desktopActivation)
      .set({ name: parsed.data.name })
      .where(
        and(
          eq(desktopActivation.id, parsed.data.activationId),
          eq(desktopActivation.userId, session.user.id),
        ),
      );
  } else {
    const revokedAt = new Date();
    await db.batch([
      db
        .update(desktopActivation)
        .set({ revokedAt })
        .where(
          and(
            eq(desktopActivation.id, parsed.data.activationId),
            eq(desktopActivation.userId, session.user.id),
            isNull(desktopActivation.revokedAt),
          ),
        ),
      db
        .update(desktopRefreshToken)
        .set({ revokedAt })
        .where(
          and(
            eq(desktopRefreshToken.activationId, parsed.data.activationId),
            isNull(desktopRefreshToken.revokedAt),
          ),
        ),
    ]);
  }
  return json({ ok: true });
}

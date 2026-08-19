import { and, eq, isNull } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { createDb } from "../server/db/db.server";
import { desktopActivation, desktopAuthRequest, desktopRefreshToken } from "../server/db/schema";
import {
  isAuthorizationGrantValid,
  issueAccessToken,
  randomToken,
  sha256,
} from "../server/desktop-auth.server";
import { envFrom, json, readJson } from "../server/http.server";

const authorizationCodeSchema = z
  .object({
    grantType: z.literal("authorization_code"),
    requestId: z.string().uuid(),
    code: z.string().min(32).max(256),
    verifier: z.string().min(43).max(128),
    state: z.string().min(32).max(256),
  })
  .strict();

const refreshSchema = z
  .object({
    grantType: z.literal("refresh_token"),
    refreshToken: z.string().min(32).max(256),
  })
  .strict();

export async function action({ request, context }: ActionFunctionArgs) {
  const env = envFrom(context);
  const input = await readJson(request);
  const authorization = authorizationCodeSchema.safeParse(input);
  if (authorization.success) return exchangeAuthorizationCode(authorization.data, env);
  const refresh = refreshSchema.safeParse(input);
  if (refresh.success) return rotateRefreshToken(refresh.data.refreshToken, env);
  return json(
    { error: { code: "INVALID_GRANT", message: "Invalid token request" } },
    { status: 400 },
  );
}

async function exchangeAuthorizationCode(body: z.infer<typeof authorizationCodeSchema>, env: Env) {
  const db = createDb(env);
  const [record] = await db
    .select({
      id: desktopAuthRequest.id,
      state: desktopAuthRequest.state,
      codeChallenge: desktopAuthRequest.codeChallenge,
      userId: desktopAuthRequest.userId,
      activationId: desktopAuthRequest.activationId,
      authorizationCodeHash: desktopAuthRequest.authorizationCodeHash,
      expiresAt: desktopAuthRequest.expiresAt,
      consumedAt: desktopAuthRequest.consumedAt,
    })
    .from(desktopAuthRequest)
    .where(eq(desktopAuthRequest.id, body.requestId))
    .limit(1);
  if (!record?.userId || !record.activationId || !(await isAuthorizationGrantValid(record, body))) {
    return json(
      { error: { code: "INVALID_GRANT", message: "Authorization code is invalid or expired" } },
      { status: 401 },
    );
  }

  const { userId, activationId } = record;

  const refreshToken = randomToken(48);
  const refreshHash = await sha256(refreshToken);
  const refreshId = crypto.randomUUID();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const now = new Date();
  try {
    await db.batch([
      db
        .update(desktopAuthRequest)
        .set({ consumedAt: now })
        .where(and(eq(desktopAuthRequest.id, record.id), isNull(desktopAuthRequest.consumedAt))),
      db.insert(desktopRefreshToken).values({
        id: refreshId,
        activationId,
        tokenHash: refreshHash,
        expiresAt: refreshExpiresAt,
        createdAt: now,
        authorizationRequestId: record.id,
      }),
      db
        .update(desktopActivation)
        .set({ lastSeenAt: now })
        .where(eq(desktopActivation.id, activationId)),
    ]);
  } catch (error) {
    if (error instanceof Error && /constraint|unique/iu.test(error.message)) {
      return json(
        { error: { code: "INVALID_GRANT", message: "Authorization code was already consumed" } },
        { status: 401 },
      );
    }
    throw error;
  }
  const access = await issueAccessToken({ userId, activationId }, env);
  return json({
    accessToken: access.token,
    tokenType: "Bearer",
    expiresIn: access.expiresIn,
    refreshToken,
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    activationId,
  });
}

async function rotateRefreshToken(refreshToken: string, env: Env) {
  const tokenHash = await sha256(refreshToken);
  const db = createDb(env);
  const [record] = await db
    .select({
      id: desktopRefreshToken.id,
      activationId: desktopRefreshToken.activationId,
      expiresAt: desktopRefreshToken.expiresAt,
      revokedAt: desktopRefreshToken.revokedAt,
      userId: desktopActivation.userId,
      activationRevokedAt: desktopActivation.revokedAt,
    })
    .from(desktopRefreshToken)
    .innerJoin(desktopActivation, eq(desktopActivation.id, desktopRefreshToken.activationId))
    .where(eq(desktopRefreshToken.tokenHash, tokenHash))
    .limit(1);
  if (
    !record ||
    record.revokedAt ||
    record.activationRevokedAt ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    return json(
      { error: { code: "INVALID_GRANT", message: "Refresh token is invalid or expired" } },
      { status: 401 },
    );
  }
  const nextToken = randomToken(48);
  const nextHash = await sha256(nextToken);
  const nextId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const now = new Date();
  try {
    await db.batch([
      db
        .update(desktopRefreshToken)
        .set({ revokedAt: now, rotatedTo: nextId })
        .where(and(eq(desktopRefreshToken.id, record.id), isNull(desktopRefreshToken.revokedAt))),
      db.insert(desktopRefreshToken).values({
        id: nextId,
        activationId: record.activationId,
        tokenHash: nextHash,
        expiresAt,
        createdAt: now,
        rotatedFrom: record.id,
      }),
      db
        .update(desktopActivation)
        .set({ lastSeenAt: now })
        .where(eq(desktopActivation.id, record.activationId)),
    ]);
  } catch (error) {
    if (error instanceof Error && /constraint|unique/iu.test(error.message)) {
      return json(
        { error: { code: "INVALID_GRANT", message: "Refresh token was already rotated" } },
        { status: 401 },
      );
    }
    throw error;
  }
  const access = await issueAccessToken(
    { userId: record.userId, activationId: record.activationId },
    env,
  );
  return json({
    accessToken: access.token,
    tokenType: "Bearer",
    expiresIn: access.expiresIn,
    refreshToken: nextToken,
    refreshExpiresAt: expiresAt.toISOString(),
  });
}

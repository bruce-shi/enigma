import type { SignedEntitlementPayload } from "@enigma/contracts";
import { importPKCS8, jwtVerify, SignJWT } from "jose";

export interface DesktopAccessClaims {
  userId: string;
  activationId: string;
}

export interface AuthorizationGrantRecord {
  state: string;
  codeChallenge: string;
  authorizationCodeHash: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  userId: string | null;
  activationId: string | null;
}

export interface AuthorizationGrantInput {
  state: string;
  code: string;
  verifier: string;
}

export interface DesktopActivationRecord {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

export interface EntitlementSubscription {
  status: string;
  billingInterval: string | null;
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

export async function sha256(value: string): Promise<string> {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function isAuthorizationGrantValid(
  record: AuthorizationGrantRecord | null | undefined,
  input: AuthorizationGrantInput,
  now = Date.now(),
): Promise<boolean> {
  if (
    !record?.userId ||
    !record.activationId ||
    !record.authorizationCodeHash ||
    record.consumedAt ||
    record.expiresAt.getTime() <= now ||
    record.state !== input.state
  ) {
    return false;
  }
  const [codeHash, codeChallenge] = await Promise.all([sha256(input.code), sha256(input.verifier)]);
  return record.authorizationCodeHash === codeHash && record.codeChallenge === codeChallenge;
}

export function isActiveDesktopActivation(
  activation: DesktopActivationRecord | null | undefined,
  claims: DesktopAccessClaims,
): boolean {
  return Boolean(
    activation &&
      activation.id === claims.activationId &&
      activation.userId === claims.userId &&
      !activation.revokedAt,
  );
}

export function createEntitlementPayload(
  activationId: string,
  subscription: EntitlementSubscription | null | undefined,
  now = Date.now(),
): SignedEntitlementPayload | null {
  if (subscription?.status !== "active" && subscription?.status !== "trialing") return null;
  return {
    version: 1,
    activationId,
    plan: subscription.billingInterval === "year" ? "yearly" : "monthly",
    status: subscription.status,
    issuedAt: new Date(now).toISOString(),
    refreshAfter: new Date(now + 24 * 60 * 60_000).toISOString(),
    validUntil: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
  };
}

export async function issueAccessToken(
  claims: DesktopAccessClaims,
  env: Env,
): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = 15 * 60;
  const secret = new TextEncoder().encode(env.DESKTOP_TOKEN_SECRET);
  const token = await new SignJWT({ activationId: claims.activationId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env.PUBLIC_ORIGIN)
    .setAudience("enigma-desktop")
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);
  return { token, expiresIn };
}

export async function verifyAccessToken(token: string, env: Env): Promise<DesktopAccessClaims> {
  const secret = new TextEncoder().encode(env.DESKTOP_TOKEN_SECRET);
  const { payload } = await jwtVerify(token, secret, {
    issuer: env.PUBLIC_ORIGIN,
    audience: "enigma-desktop",
  });
  if (typeof payload.sub !== "string" || typeof payload.activationId !== "string") {
    throw new Response("invalid desktop token", { status: 401 });
  }
  return { userId: payload.sub, activationId: payload.activationId };
}

export async function issueEntitlement(
  payload: SignedEntitlementPayload,
  env: Env,
): Promise<string> {
  const pem = env.ENTITLEMENT_PRIVATE_KEY.replaceAll("\\n", "\n");
  const privateKey = await importPKCS8(pem, "EdDSA");
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(env.PUBLIC_ORIGIN)
    .setAudience("enigma-desktop-entitlement")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.parse(payload.validUntil) / 1000))
    .sign(privateKey);
}

function base64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

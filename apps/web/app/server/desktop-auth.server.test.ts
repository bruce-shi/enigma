import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  createEntitlementPayload,
  isActiveDesktopActivation,
  isAuthorizationGrantValid,
  issueAccessToken,
  issueEntitlement,
  randomToken,
  sha256,
  verifyAccessToken,
} from "./desktop-auth.server";

const authEnv = {
  DESKTOP_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  PUBLIC_ORIGIN: "https://enigma.example",
} as Env;

describe("desktop authentication primitives", () => {
  it("issues and verifies a scoped short-lived access token", async () => {
    const claims = { userId: "user-1", activationId: "activation-1" };
    const issued = await issueAccessToken(claims, authEnv);

    expect(issued.expiresIn).toBe(15 * 60);
    await expect(verifyAccessToken(issued.token, authEnv)).resolves.toEqual(claims);
  });

  it("creates URL-safe random tokens and deterministic hashes", async () => {
    const first = randomToken();
    const second = randomToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(first).not.toBe(second);
    await expect(sha256("enigma")).resolves.toBe(await sha256("enigma"));
  });

  it("validates the one-time code, state, expiry, and PKCE verifier together", async () => {
    const code = "authorization-code";
    const verifier = "pkce-verifier-that-is-long-enough-for-the-desktop-flow";
    const record = {
      state: "expected-state",
      codeChallenge: await sha256(verifier),
      authorizationCodeHash: await sha256(code),
      expiresAt: new Date("2026-08-19T06:00:00.000Z"),
      consumedAt: null,
      userId: "user-1",
      activationId: "activation-1",
    };
    const now = new Date("2026-08-19T05:30:00.000Z").getTime();

    await expect(
      isAuthorizationGrantValid(record, { code, verifier, state: "expected-state" }, now),
    ).resolves.toBe(true);
    await expect(
      isAuthorizationGrantValid(
        record,
        { code, verifier: `${verifier}-wrong`, state: record.state },
        now,
      ),
    ).resolves.toBe(false);
    await expect(
      isAuthorizationGrantValid(record, { code, verifier, state: "wrong-state" }, now),
    ).resolves.toBe(false);
    await expect(
      isAuthorizationGrantValid(
        { ...record, consumedAt: new Date(now) },
        { code, verifier, state: record.state },
        now,
      ),
    ).resolves.toBe(false);
    await expect(
      isAuthorizationGrantValid(
        { ...record, expiresAt: new Date(now) },
        { code, verifier, state: record.state },
        now,
      ),
    ).resolves.toBe(false);
  });

  it("rejects revoked, missing, and cross-user activations", () => {
    const claims = { userId: "user-1", activationId: "activation-1" };
    const active = { id: "activation-1", userId: "user-1", revokedAt: null };

    expect(isActiveDesktopActivation(active, claims)).toBe(true);
    expect(isActiveDesktopActivation({ ...active, revokedAt: new Date() }, claims)).toBe(false);
    expect(isActiveDesktopActivation({ ...active, userId: "user-2" }, claims)).toBe(false);
    expect(isActiveDesktopActivation(null, claims)).toBe(false);
  });

  it("creates monthly and yearly trial/payment entitlements with a seven-day offline window", () => {
    const now = new Date("2026-08-19T05:30:00.000Z").getTime();
    const monthly = createEntitlementPayload(
      "activation-1",
      { status: "active", billingInterval: "month" },
      now,
    );
    const yearlyTrial = createEntitlementPayload(
      "activation-1",
      { status: "trialing", billingInterval: "year" },
      now,
    );

    expect(monthly).toMatchObject({ plan: "monthly", status: "active" });
    expect(yearlyTrial).toMatchObject({ plan: "yearly", status: "trialing" });
    expect(Date.parse(monthly?.refreshAfter ?? "") - now).toBe(24 * 60 * 60_000);
    expect(Date.parse(monthly?.validUntil ?? "") - now).toBe(7 * 24 * 60 * 60_000);
  });

  it("signs the offline entitlement with its seven-day expiry", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
    const payload = createEntitlementPayload("activation-1", {
      status: "active",
      billingInterval: "month",
    });
    if (!payload) throw new Error("expected an active entitlement payload");
    const token = await issueEntitlement(payload, {
      ...authEnv,
      ENTITLEMENT_PRIVATE_KEY: await exportPKCS8(privateKey),
    });

    const verified = await jwtVerify(token, publicKey, {
      issuer: authEnv.PUBLIC_ORIGIN,
      audience: "enigma-desktop-entitlement",
    });
    expect(verified.payload.activationId).toBe("activation-1");
    expect(verified.payload.exp).toBe(Math.floor(Date.parse(payload.validUntil) / 1000));
  });

  it.each(["canceled", "past_due", "unpaid", "incomplete", "paused"])(
    "does not issue an entitlement for %s subscriptions",
    (status) => {
      expect(
        createEntitlementPayload("activation-1", { status, billingInterval: "month" }),
      ).toBeNull();
    },
  );
});

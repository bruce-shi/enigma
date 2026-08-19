import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { createDb } from "../server/db/db.server";
import { desktopAuthRequest } from "../server/db/schema";
import { randomToken } from "../server/desktop-auth.server";
import { envFrom, json, readJson } from "../server/http.server";

const bodySchema = z
  .object({
    state: z.string().min(32).max(256),
    codeChallenge: z.string().min(43).max(128),
    installationPublicKey: z.string().min(32).max(4096),
    name: z.string().trim().min(1).max(80),
    platform: z.enum(["macos", "windows"]),
    channel: z.enum(["stable", "beta"]),
  })
  .strict();

export async function action({ request, context }: ActionFunctionArgs) {
  const env = envFrom(context);
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success)
    return json(
      { error: { code: "INVALID_REQUEST", message: "Invalid activation request" } },
      { status: 400 },
    );
  const requestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const { state, codeChallenge, installationPublicKey, name, platform, channel } = parsed.data;
  await createDb(env).insert(desktopAuthRequest).values({
    id: requestId,
    state,
    codeChallenge,
    installationPublicKey,
    computerName: name,
    platform,
    channel,
    expiresAt,
    createdAt: new Date(),
  });
  return json(
    {
      requestId,
      authorizeUrl: `${env.PUBLIC_ORIGIN}/desktop/authorize?request=${encodeURIComponent(requestId)}`,
      expiresAt: expiresAt.toISOString(),
      nonce: randomToken(16),
    },
    { status: 201 },
  );
}

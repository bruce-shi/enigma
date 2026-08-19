import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { verifyAccessToken } from "../server/desktop-auth.server";
import { bearerToken, envFrom, json, readJson } from "../server/http.server";

const frameSchema = z
  .object({
    symbol: z.string().max(300).optional(),
    module: z.string().max(200).optional(),
    line: z.number().int().positive().max(10_000_000).optional(),
  })
  .strict();

const crashSchema = z
  .object({
    schemaVersion: z.literal(1),
    appVersion: z.string().max(40),
    platform: z.enum(["macos", "windows"]),
    osVersion: z.string().max(80),
    iosBuild: z.string().max(80).optional(),
    errorCode: z.string().regex(/^[A-Z0-9_]{1,80}$/u),
    stackFrames: z.array(frameSchema).max(100),
    coarseState: z.enum([
      "disconnected",
      "connecting",
      "needs_driver",
      "needs_trust",
      "needs_developer_mode",
      "preparing",
      "ready",
      "simulating",
      "error",
      "idle",
      "starting",
      "running",
      "paused",
      "stopping",
      "restore_required",
    ]),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export async function action({ request, context }: ActionFunctionArgs) {
  const env = envFrom(context);
  await verifyAccessToken(bearerToken(request), env);
  const parsed = crashSchema.safeParse(await readJson(request));
  if (!parsed.success)
    return json(
      { error: { code: "INVALID_REPORT", message: "Crash report contains unsupported fields" } },
      { status: 400 },
    );
  const reportId = crypto.randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  await env.CRASH_REPORTS.put(
    `${month}/${reportId}.json`,
    JSON.stringify({ ...parsed.data, reportId }),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { schemaVersion: "1", expiresAfterDays: "30" },
    },
  );
  return json({ reportId }, { status: 201 });
}

import { Button } from "@heroui/react";
import { and, count, eq, isNull } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { SiteShell } from "../components/SiteShell";
import { createDb } from "../server/db/db.server";
import { desktopActivation, desktopAuthRequest } from "../server/db/schema";
import { randomToken, sha256 } from "../server/desktop-auth.server";
import { assertSameOrigin, envFrom, getSession, requireSession } from "../server/http.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = envFrom(context);
  const url = new URL(request.url);
  const requestId = url.searchParams.get("request");
  if (!requestId) throw new Response("activation request is missing", { status: 400 });
  const db = createDb(env);
  const [record] = await db
    .select({
      id: desktopAuthRequest.id,
      computerName: desktopAuthRequest.computerName,
      platform: desktopAuthRequest.platform,
      channel: desktopAuthRequest.channel,
      expiresAt: desktopAuthRequest.expiresAt,
      consumedAt: desktopAuthRequest.consumedAt,
    })
    .from(desktopAuthRequest)
    .where(eq(desktopAuthRequest.id, requestId))
    .limit(1);
  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    throw new Response("activation request expired", { status: 410 });
  }
  const session = await getSession(request, env);
  if (!session) {
    throw redirect(`/sign-in?callbackURL=${encodeURIComponent(url.pathname + url.search)}`);
  }
  const [activationCountRow] = await db
    .select({ value: count() })
    .from(desktopActivation)
    .where(and(eq(desktopActivation.userId, session.user.id), isNull(desktopActivation.revokedAt)));
  const activationCount = activationCountRow?.value ?? 0;
  return {
    requestId,
    computerName: record.computerName,
    platform: record.platform,
    channel: record.channel,
    activationCount,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = envFrom(context);
  assertSameOrigin(request, env);
  const session = await requireSession(request, env);
  const data = await request.formData();
  const requestId = String(data.get("requestId") ?? "");
  const db = createDb(env);
  const [record] = await db
    .select({
      expiresAt: desktopAuthRequest.expiresAt,
      installationPublicKey: desktopAuthRequest.installationPublicKey,
      computerName: desktopAuthRequest.computerName,
      platform: desktopAuthRequest.platform,
      channel: desktopAuthRequest.channel,
      state: desktopAuthRequest.state,
    })
    .from(desktopAuthRequest)
    .where(
      and(
        eq(desktopAuthRequest.id, requestId),
        isNull(desktopAuthRequest.consumedAt),
        isNull(desktopAuthRequest.approvedAt),
      ),
    )
    .limit(1);
  if (!record || record.expiresAt.getTime() <= Date.now())
    throw new Response("activation request expired", { status: 410 });
  const activeSlots = await db
    .select({ slot: desktopActivation.slot })
    .from(desktopActivation)
    .where(and(eq(desktopActivation.userId, session.user.id), isNull(desktopActivation.revokedAt)));
  const slot = ([1, 2] as const).find(
    (candidate) => !activeSlots.some((activation) => activation.slot === candidate),
  );
  if (!slot)
    throw new Response("revoke an existing computer before activating another", { status: 409 });

  const activationId = crypto.randomUUID();
  const code = randomToken();
  const codeHash = await sha256(code);
  const now = new Date();
  try {
    await db.batch([
      db.insert(desktopActivation).values({
        id: activationId,
        userId: session.user.id,
        authRequestId: requestId,
        slot,
        installationPublicKey: record.installationPublicKey,
        name: record.computerName,
        platform: record.platform,
        channel: record.channel,
        createdAt: now,
        lastSeenAt: now,
      }),
      db
        .update(desktopAuthRequest)
        .set({
          userId: session.user.id,
          activationId,
          authorizationCodeHash: codeHash,
          approvedAt: now,
        })
        .where(
          and(
            eq(desktopAuthRequest.id, requestId),
            isNull(desktopAuthRequest.consumedAt),
            isNull(desktopAuthRequest.approvedAt),
          ),
        ),
    ]);
  } catch (error) {
    if (error instanceof Error && /constraint|unique|check/iu.test(error.message)) {
      throw new Response("activation request was already used or no activation slot is available", {
        status: 409,
      });
    }
    throw error;
  }
  throw redirect(
    `enigma://auth/callback?request=${encodeURIComponent(requestId)}&code=${encodeURIComponent(code)}&state=${encodeURIComponent(record.state)}`,
  );
}

export default function DesktopAuthorize() {
  const data = useLoaderData<typeof loader>();
  return (
    <SiteShell>
      <main className="grid min-h-[70vh] place-items-center p-6">
        <div className="enigma-surface w-full max-w-lg p-7">
          <p className="text-sm font-semibold text-accent">Desktop authorization</p>
          <h1 className="mt-2 text-2xl font-semibold">Activate {data.computerName}</h1>
          <dl className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-surface-secondary p-4 text-sm">
            <dt className="text-muted-foreground">Platform</dt>
            <dd className="text-right capitalize">{data.platform}</dd>
            <dt className="text-muted-foreground">Update channel</dt>
            <dd className="text-right capitalize">{data.channel}</dd>
            <dt className="text-muted-foreground">Activations used</dt>
            <dd className="text-right">{data.activationCount} of 2</dd>
          </dl>
          <p className="mt-5 text-sm text-muted-foreground">
            Approving returns a one-time code to the installed Enigma application. The browser
            session is not copied into the desktop app.
          </p>
          <Form method="post">
            <input name="requestId" type="hidden" value={data.requestId} />
            <Button className="mt-6 w-full" isDisabled={data.activationCount >= 2} type="submit">
              Approve this computer
            </Button>
          </Form>
        </div>
      </main>
    </SiteShell>
  );
}

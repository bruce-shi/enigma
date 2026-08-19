import { Button } from "@heroui/react";
import { desc, eq } from "drizzle-orm";
import { Download, Laptop, Settings } from "lucide-react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { ButtonLink, SiteShell } from "../components/SiteShell";
import { createDb } from "../server/db/db.server";
import { desktopActivation, subscription as subscriptionTable } from "../server/db/schema";
import { envFrom, getSession } from "../server/http.server";
import { getPublicReleaseConfig, publicReleaseReady } from "../server/public-config.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = envFrom(context);
  const publicConfig = getPublicReleaseConfig(env);
  const session = await getSession(request, env);
  if (!session) throw redirect("/sign-in?callbackURL=/dashboard");
  const db = createDb(env);
  const [activations, subscription] = await Promise.all([
    db
      .select({
        id: desktopActivation.id,
        name: desktopActivation.name,
        platform: desktopActivation.platform,
        channel: desktopActivation.channel,
        lastSeenAt: desktopActivation.lastSeenAt,
        revokedAt: desktopActivation.revokedAt,
      })
      .from(desktopActivation)
      .where(eq(desktopActivation.userId, session.user.id))
      .orderBy(desc(desktopActivation.createdAt)),
    db
      .select({
        plan: subscriptionTable.plan,
        status: subscriptionTable.status,
        periodEnd: subscriptionTable.periodEnd,
        trialEnd: subscriptionTable.trialEnd,
      })
      .from(subscriptionTable)
      .where(eq(subscriptionTable.referenceId, session.user.id))
      .orderBy(desc(subscriptionTable.updatedAt))
      .limit(1)
      .then(([current]) => current ?? null),
  ]);
  return {
    user: session.user,
    activations,
    subscription,
    releaseReady: publicReleaseReady(publicConfig),
    billingEnabled: publicConfig.billingEnabled,
  };
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  return (
    <SiteShell>
      <main className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Signed in as {data.user.email}</p>
            <h1 className="mt-1 text-4xl font-semibold">Your Enigma account</h1>
          </div>
          <Button isDisabled={!data.billingEnabled} variant="secondary">
            <Settings size={16} /> {data.billingEnabled ? "Manage billing" : "Billing unavailable"}
          </Button>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <section className="enigma-surface p-6">
            <h2 className="font-semibold">Subscription</h2>
            <p className="mt-4 text-2xl font-semibold capitalize">
              {data.subscription?.status ?? "No active plan"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly and yearly plans include two computer activations and seven-day offline grace.
            </p>
          </section>
          <section className="enigma-surface p-6">
            <h2 className="font-semibold">Downloads</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {data.releaseReady
                ? "Signed installers are available on the release page."
                : "No signed public installers are available."}
            </p>
            <ButtonLink className="mt-4" to="/downloads" variant="secondary">
              <Download size={16} /> Release status
            </ButtonLink>
          </section>
        </div>
        <section className="enigma-surface mt-5 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Activated computers</h2>
            <span className="text-sm text-muted-foreground">
              {data.activations.filter((item) => !item.revokedAt).length} of 2 active
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            {data.activations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No computers activated yet.</p>
            ) : (
              data.activations.map((activation) => {
                return (
                  <article
                    className="flex items-center gap-3 rounded-xl border border-border p-4"
                    key={activation.id}
                  >
                    <Laptop className="text-accent" size={20} />
                    <div>
                      <p className="font-medium">{activation.name}</p>
                      <p className="text-sm text-muted-foreground capitalize">
                        {activation.platform} · {activation.channel}
                        {activation.revokedAt ? " · revoked" : ""}
                      </p>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

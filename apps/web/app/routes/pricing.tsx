import { Button } from "@heroui/react";
import { Check } from "lucide-react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ButtonLink, SiteShell } from "../components/SiteShell";
import { envFrom } from "../server/http.server";
import { getPublicReleaseConfig, publicReleaseReady } from "../server/public-config.server";

const included = [
  "Qualified desktop and iOS combinations",
  "Same-LAN Wi-Fi beta",
  "Routes, joystick, and GPX",
  "Two computer activations",
  "Seven-day offline grace",
];

export function loader({ context }: LoaderFunctionArgs) {
  const config = getPublicReleaseConfig(envFrom(context));
  return { config, ready: publicReleaseReady(config) };
}

export default function Pricing() {
  const { config, ready } = useLoaderData<typeof loader>();
  return (
    <SiteShell>
      <main className="px-6 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-4xl font-semibold md:text-6xl">
            {ready ? "One plan, two billing options." : "Pricing is not live yet."}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {ready
              ? "Both include a card-required seven-day trial."
              : "Production Stripe plans, checkout, email delivery, and signed downloads remain disabled."}
          </p>
          <div className="mt-12 grid gap-5 text-left md:grid-cols-2">
            {[
              {
                name: "Monthly",
                price: config.monthlyPriceLabel,
                cadence: "per month",
                annual: false,
              },
              {
                name: "Yearly",
                price: config.yearlyPriceLabel,
                cadence: "per year",
                annual: true,
              },
            ].map((plan) => (
              <article className="enigma-surface p-7" key={plan.name}>
                <p className="text-sm font-semibold text-accent">{plan.name}</p>
                <p className="mt-2 text-2xl font-semibold">{plan.price}</p>
                <p className="text-sm text-muted-foreground">{plan.cadence}</p>
                <ul className="my-7 grid gap-3 text-sm">
                  {included.map((item) => (
                    <li className="flex gap-2" key={item}>
                      <Check className="text-success" size={17} />
                      {item}
                    </li>
                  ))}
                </ul>
                {ready ? (
                  <ButtonLink
                    className="w-full"
                    to={`/sign-in?plan=${plan.annual ? "yearly" : "monthly"}`}
                  >
                    Start trial
                  </ButtonLink>
                ) : (
                  <Button className="w-full" isDisabled>
                    Billing unavailable
                  </Button>
                )}
              </article>
            ))}
          </div>
        </div>
      </main>
    </SiteShell>
  );
}

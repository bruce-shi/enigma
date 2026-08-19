import { Check } from "lucide-react";
import { ButtonLink, SiteShell } from "../components/SiteShell";

const included = [
  "macOS and Windows",
  "USB location simulation",
  "Wi-Fi beta",
  "Routes, joystick, and GPX",
  "Two computer activations",
  "Seven-day offline grace",
];

export default function Pricing() {
  return (
    <SiteShell>
      <main className="px-6 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-4xl font-semibold md:text-6xl">One plan, two billing options.</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Both include a card-required seven-day trial.
          </p>
          <div className="mt-12 grid gap-5 text-left md:grid-cols-2">
            {[
              { name: "Monthly", cadence: "per month", annual: false },
              { name: "Yearly", cadence: "per year", annual: true },
            ].map((plan) => (
              <article className="enigma-surface p-7" key={plan.name}>
                <p className="text-sm font-semibold text-accent">{plan.name}</p>
                <p className="mt-2 text-2xl font-semibold">Configured in Stripe</p>
                <p className="text-sm text-muted-foreground">{plan.cadence}</p>
                <ul className="my-7 grid gap-3 text-sm">
                  {included.map((item) => (
                    <li className="flex gap-2" key={item}>
                      <Check className="text-success" size={17} />
                      {item}
                    </li>
                  ))}
                </ul>
                <ButtonLink
                  className="w-full"
                  to={`/sign-in?plan=${plan.annual ? "yearly" : "monthly"}`}
                >
                  Start trial
                </ButtonLink>
              </article>
            ))}
          </div>
        </div>
      </main>
    </SiteShell>
  );
}

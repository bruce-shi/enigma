import { Button } from "@heroui/react";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SiteShell } from "../components/SiteShell";
import { envFrom } from "../server/http.server";
import { getPublicReleaseConfig } from "../server/public-config.server";

export function loader({ context }: LoaderFunctionArgs) {
  return { enabled: getPublicReleaseConfig(envFrom(context)).billingEnabled };
}

export default function SignIn() {
  const { enabled } = useLoaderData<typeof loader>();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enabled) {
      setStatus("Production account email is not enabled in this build.");
      return;
    }
    setStatus("Sending…");
    const response = await fetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/dashboard" }),
    });
    setStatus(
      response.ok
        ? "Check your email for a one-time sign-in link."
        : "The sign-in link could not be sent.",
    );
  };
  return (
    <SiteShell>
      <main className="grid min-h-[70vh] place-items-center p-6">
        <form className="enigma-surface w-full max-w-md p-7" onSubmit={submit}>
          <h1 className="text-2xl font-semibold">Sign in to Enigma</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {enabled
              ? "We will email a one-time link. No password is stored."
              : "Production account email is currently disabled while the desktop is tested without login or subscription enforcement."}
          </p>
          <label className="mt-6 grid gap-2 text-sm font-medium">
            Email
            <input
              className="rounded-lg border border-border bg-surface px-3 py-2"
              onChange={(event) => setEmail(event.target.value)}
              disabled={!enabled}
              required
              type="email"
              value={email}
            />
          </label>
          <Button className="mt-5 w-full" isDisabled={!enabled} type="submit">
            {enabled ? "Email sign-in link" : "Sign-in unavailable"}
          </Button>
          {status && (
            <p aria-live="polite" className="mt-4 text-sm text-muted-foreground">
              {status}
            </p>
          )}
        </form>
      </main>
    </SiteShell>
  );
}

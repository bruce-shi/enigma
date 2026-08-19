import { AppShell } from "@enigma/ui";
import { Link as HeroLink } from "@heroui/react";
import { type ButtonVariants, buttonVariants } from "@heroui/styles";
import type { PropsWithChildren } from "react";
import { Link as RouterLink } from "react-router";

export function ButtonLink({
  to,
  className,
  size,
  variant,
  children,
}: PropsWithChildren<{
  to: string;
  className?: string;
  size?: ButtonVariants["size"];
  variant?: ButtonVariants["variant"];
}>) {
  return (
    <HeroLink className={buttonVariants({ className, size, variant })} href={to}>
      {children}
    </HeroLink>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      context="Location testing"
      navigation={
        <>
          <ButtonLink to="/pricing" variant="ghost">
            Pricing
          </ButtonLink>
          <ButtonLink to="/dashboard" variant="ghost">
            Account
          </ButtonLink>
        </>
      }
    >
      {children}
      <footer className="border-t border-border px-6 py-8 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4">
          <span>© 2026 Enigma</span>
          <nav className="flex gap-4" aria-label="Legal">
            <RouterLink to="/privacy">Privacy</RouterLink>
            <RouterLink to="/terms">Terms</RouterLink>
          </nav>
        </div>
      </footer>
    </AppShell>
  );
}

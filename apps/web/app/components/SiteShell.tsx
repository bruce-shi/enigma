import { AppShell } from "@enigma/ui";
import { Link as HeroLink } from "@heroui/react";
import { type ButtonVariants, buttonVariants } from "@heroui/styles";
import type { PropsWithChildren } from "react";

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
      context="Open-source location testing"
      navigation={
        <>
          <ButtonLink to="#features" variant="ghost">
            Features
          </ButtonLink>
          <ButtonLink to="#compatibility" variant="ghost">
            Compatibility
          </ButtonLink>
          <ButtonLink to="https://github.com/bruce-shi/enigma" variant="ghost">
            GitHub
          </ButtonLink>
        </>
      }
      showThemeToggle={false}
    >
      {children}
      <footer className="border-t border-border px-6 py-8 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4">
          <span>Enigma is open source under GPL-3.0-only.</span>
          <a href="https://github.com/bruce-shi/enigma/blob/main/LICENSE">License</a>
        </div>
      </footer>
    </AppShell>
  );
}

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
      context="iPhone location simulation"
      navigation={
        <>
          <ButtonLink className="hidden sm:inline-flex" to="/#features" variant="ghost">
            Features
          </ButtonLink>
          <ButtonLink className="hidden sm:inline-flex" to="/#setup" variant="ghost">
            How it works
          </ButtonLink>
          <ButtonLink className="hidden md:inline-flex" to="/#compatibility" variant="ghost">
            Compatibility
          </ButtonLink>
          <ButtonLink to="/docs" variant="ghost">
            Docs
          </ButtonLink>
          <ButtonLink to="https://github.com/bruce-shi/enigma/releases" variant="ghost">
            Download
          </ButtonLink>
        </>
      }
      showThemeToggle={false}
    >
      {children}
      <footer className="border-t border-border px-6 py-8 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4">
          <span>Enigma · Precise iPhone location simulation.</span>
          <div className="flex gap-5">
            <a href="/docs">Docs</a>
            <a href="/docs/desktop-setup">Setup guide</a>
            <a href="https://github.com/bruce-shi/enigma">GitHub</a>
          </div>
        </div>
      </footer>
    </AppShell>
  );
}

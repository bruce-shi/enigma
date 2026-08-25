// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppShell,
  ConfirmExitDialog,
  DeviceStatus,
  EnigmaMark,
  SimulationControls,
  ThemeToggle,
} from "./index";

const colorSchemeListeners = new Set<(event: MediaQueryListEvent) => void>();
let systemPrefersDark = false;

function mockMatchMedia(query: string): MediaQueryList {
  const matches = query === "(prefers-color-scheme: dark)" && systemPrefersDark;
  return {
    matches,
    media: query,
    onchange: null,
    addListener: (listener: MediaQueryList["onchange"]) => {
      if (listener) colorSchemeListeners.add(listener);
    },
    removeListener: (listener: MediaQueryList["onchange"]) => {
      if (listener) colorSchemeListeners.delete(listener);
    },
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (typeof listener === "function") {
        colorSchemeListeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (typeof listener === "function") {
        colorSchemeListeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    },
    dispatchEvent: () => true,
  } as MediaQueryList;
}

function setSystemColorScheme(dark: boolean) {
  systemPrefersDark = dark;
  const event = { matches: dark, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent;
  for (const listener of colorSchemeListeners) listener(event);
}

function ExitDialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open exit options
      </button>
      <ConfirmExitDialog
        onCancel={() => setOpen(false)}
        onKeep={() => setOpen(false)}
        onRestore={() => setOpen(false)}
        open={open}
      />
    </>
  );
}

beforeEach(() => {
  systemPrefersDark = false;
  colorSchemeListeners.clear();
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: vi.fn(mockMatchMedia),
  });
  localStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: reset the SSR theme preference between tests
  document.cookie = "enigma_theme=; Path=/; Max-Age=0";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup();
  colorSchemeListeners.clear();
});

describe("shared Enigma UI", () => {
  it("uses the shared abstract Enigma mark", () => {
    const { container } = render(<EnigmaMark />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/enigma-mark-reversed.png");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("announces device state", () => {
    render(<DeviceStatus state="needs_trust" name="Test iPhone" transport="network" />);
    expect(screen.getByRole("status")).toHaveTextContent("Trust required · Wi-Fi beta");
  });

  it("applies and persists the light, dark, and system theme cycle", async () => {
    systemPrefersDark = true;
    // biome-ignore lint/suspicious/noDocumentCookie: initialize the SSR theme preference
    document.cookie = "enigma_theme=system; Path=/";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "enigma-dark"),
    );

    await user.click(screen.getByRole("button", { name: /switch to light/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "enigma-light");
    expect(document.documentElement).not.toHaveClass("dark");

    await user.click(screen.getByRole("button", { name: /switch to dark/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "enigma-dark");
    expect(document.documentElement).toHaveClass("dark");

    await user.click(screen.getByRole("button", { name: /switch to system/i }));
    expect(localStorage.getItem("enigma.theme")).toBe("system");
    expect(document.cookie).toContain("enigma_theme=system");
    expect(document.documentElement).toHaveAttribute("data-theme", "enigma-dark");
  });

  it("tracks operating-system theme changes while system is selected", async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: initialize the SSR theme preference
    document.cookie = "enigma_theme=system; Path=/";
    render(<ThemeToggle />);

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "enigma-light"),
    );
    act(() => setSystemColorScheme(true));
    expect(document.documentElement).toHaveAttribute("data-theme", "enigma-dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("keeps keyboard focus inside the exit dialog and restores it after Escape", async () => {
    const user = userEvent.setup();
    render(<ExitDialogHarness />);

    const opener = screen.getByRole("button", { name: "Open exit options" });
    await user.click(opener);

    expect(
      screen.getByRole("alertdialog", { name: "Location simulation is active" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restore and exit/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: /restore and exit/i })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("has no detectable accessibility violations in shared interactive components", async () => {
    render(
      <AppShell context="Accessibility test">
        <DeviceStatus state="ready" name="Test iPhone" transport="network" />
        <SimulationControls
          onPause={() => {}}
          onRestore={() => {}}
          onResume={() => {}}
          onStart={() => {}}
          onStop={() => {}}
          state="idle"
        />
      </AppShell>,
    );

    const results = await axe.run(document.body, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });

  it("ships visible-focus and reduced-motion safeguards", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toMatch(/:focus-visible\s*\{/u);
    expect(styles).toMatch(/outline:\s*2px solid var\(--focus\)/u);
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
    expect(styles).toMatch(/animation-duration:\s*0\.01ms !important/u);
    expect(styles).toMatch(/transition-duration:\s*0\.01ms !important/u);
    expect(styles).toMatch(/scroll-behavior:\s*auto !important/u);
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import App from "./App";

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: TestResizeObserver,
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("registration portal", () => {
  it("shows the selected eligibility screen for a permitted school email", () => {
    window.history.replaceState(
      {},
      "",
      "/?email=student.one%40students.unilorin.edu.ng",
    );

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Three checks. Then you’re ready." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirm school email")).toBeInTheDocument();
    expect(screen.getByText("Check ID and liveness")).toBeInTheDocument();
    expect(screen.getByText("Create your account")).toBeInTheDocument();

    const verificationLink = screen.getByRole("link", { name: "Continue to ID check" });
    expect(verificationLink).toHaveAttribute("target", "_blank");
    expect(new URL(verificationLink.getAttribute("href") ?? "").origin).toBe(
      "https://identity.dojah.io",
    );
  });

  it("requires an exact permitted school email before continuing", async () => {
    const user = userEvent.setup();
    render(<App />);

    const emailInput = screen.getByRole("textbox", { name: "School email address" });
    await user.type(emailInput, "student@gmail.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use your @students.unilorin.edu.ng address.",
    );

    await user.clear(emailInput);
    await user.type(emailInput, "student@students.unilorin.edu.ng");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Three checks. Then you’re ready." }),
    ).toBeInTheDocument();
  });

  it("explains the verification boundary in an accessible dialog", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/?email=student.one%40students.unilorin.edu.ng",
    );
    render(<App />);

    await user.click(screen.getByRole("button", { name: "How verification works" }));

    expect(await screen.findByRole("dialog", { name: "How verification works" })).toBeVisible();
    expect(screen.getByText(/completion is not the same as approval/i)).toBeInTheDocument();
  });
});

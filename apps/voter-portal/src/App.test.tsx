import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { ElectionApi } from "./services/election-api";
import type { FirebaseAuthService } from "./services/firebase-auth";
import type { RegistrationApi, VerificationAttempt } from "./services/registration-api";

const attempt: VerificationAttempt = {
  attemptId: "attempt-1",
  claimToken: "claim-secret",
  verificationUrl: "https://identity.dojah.io/session/one",
  status: "created",
};

const createServices = (
  status:
    | "created"
    | "in_progress"
    | "pending_review"
    | "approved"
    | "rejected"
    | "abandoned"
    | "expired" = "pending_review",
) => {
  const registration: RegistrationApi = {
    createAttempt: vi.fn().mockResolvedValue(attempt),
    getStatus: vi.fn().mockResolvedValue({ status, nextAction: "wait_for_review" }),
    exchangeFirebaseToken: vi.fn().mockResolvedValue("firebase-custom-token"),
  };
  const firebaseAuth: FirebaseAuthService = {
    signInWithCustomToken: vi.fn().mockResolvedValue({
      getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
    }),
  };
  const election: ElectionApi = {
    getCurrent: vi.fn().mockResolvedValue({
      title: "Department election",
      publicUrl: "https://vote.belenios.org/v3/elections/demo-election/",
      electionUuid: "demo-election",
      opensAt: "2026-09-01T08:00:00.000Z",
      closesAt: "2026-09-01T16:00:00.000Z",
    }),
  };
  return { registration, firebaseAuth, election, openVerification: vi.fn() };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("voter registration portal", () => {
  it("blocks an email outside the exact school domain", async () => {
    const services = createServices();
    const user = userEvent.setup();
    render(<App {...services} />);

    await user.type(screen.getByRole("textbox", { name: "School email address" }), "student@gmail.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use your @students.unilorin.edu.ng address.",
    );
    expect(services.registration.createAttempt).not.toHaveBeenCalled();
  });

  it("keeps the attempt claim out of browser storage and rendered content", async () => {
    const services = createServices();
    const localStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    const { container } = render(<App {...services} />);

    await user.type(
      screen.getByRole("textbox", { name: "School email address" }),
      "Student@Students.Unilorin.Edu.Ng",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("button", { name: "Open ID and liveness check" })).toBeEnabled();
    expect(container).not.toHaveTextContent("claim-secret");
    expect(localStorageWrite).not.toHaveBeenCalled();
    expect(services.registration.createAttempt).toHaveBeenCalledWith(
      "student@students.unilorin.edu.ng",
    );
  });

  it("opens DoJah only from a separate action and remains pending", async () => {
    const services = createServices("pending_review");
    const user = userEvent.setup();
    render(<App {...services} />);

    await user.type(
      screen.getByRole("textbox", { name: "School email address" }),
      "student@students.unilorin.edu.ng",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(services.openVerification).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Open ID and liveness check" }));
    expect(services.openVerification).toHaveBeenCalledWith(attempt.verificationUrl);
    expect(screen.getByText("Pending server confirmation")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check verification status" }));
    expect(screen.getByText("Pending server confirmation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create your voting account" })).not.toBeInTheDocument();
  });

  it("shows a recoverable error when the verification window cannot open", async () => {
    const services = createServices();
    services.openVerification.mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    render(<App {...services} />);

    await user.type(
      screen.getByRole("textbox", { name: "School email address" }),
      "student@students.unilorin.edu.ng",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Open ID and liveness check" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not open verification. Allow pop-ups and try again.",
    );
  });

  it("signs in with a server-issued Firebase custom token after approval", async () => {
    const services = createServices("approved");
    const user = userEvent.setup();
    render(<App {...services} />);

    await user.type(
      screen.getByRole("textbox", { name: "School email address" }),
      "student@students.unilorin.edu.ng",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Check verification status" }));
    await user.click(screen.getByRole("button", { name: "Create your voting account" }));

    expect(services.registration.exchangeFirebaseToken).toHaveBeenCalledWith(
      attempt.attemptId,
      attempt.claimToken,
    );
    expect(services.firebaseAuth.signInWithCustomToken).toHaveBeenCalledWith(
      "firebase-custom-token",
    );
    expect(await screen.findByRole("heading", { name: "Your account is ready." })).toBeVisible();
    expect(screen.getByText("This tab is authenticated for the current session.")).toBeVisible();
    expect(services.election.getCurrent).toHaveBeenCalledWith("firebase-id-token");
    expect(screen.getByRole("link", { name: "Continue to secure ballot" })).toHaveAttribute(
      "href",
      "https://vote.belenios.org/v3/elections/demo-election/",
    );
  });

  it("does not render a ballot link until an administrator publishes the election", async () => {
    const services = createServices("approved");
    services.election.getCurrent = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    render(<App {...services} />);

    await user.type(screen.getByRole("textbox", { name: "School email address" }), "student@students.unilorin.edu.ng");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Check verification status" }));
    await user.click(screen.getByRole("button", { name: "Create your voting account" }));

    expect(await screen.findByRole("heading", { name: "Your account is ready." })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Continue to secure ballot" })).not.toBeInTheDocument();
  });
});

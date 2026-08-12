import { describe, expect, it, vi } from "vitest";

import { createRegistrationApi } from "./registration-api";

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

describe("createRegistrationApi", () => {
  it("creates a pending attempt through the fixed same-origin endpoint", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      jsonResponse({
        attemptId: "attempt-1",
        claimToken: "claim-secret",
        verificationUrl: "https://identity.dojah.io/session/one",
        status: "created",
      }),
    );

    const attempt = await createRegistrationApi(fetchRequest).createAttempt(
      "student@students.unilorin.edu.ng",
    );

    expect(attempt.status).toBe("created");
    expect(fetchRequest).toHaveBeenCalledWith("/v1/verification-attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "student@students.unilorin.edu.ng" }),
    });
  });

  it("rejects a verification URL outside the exact DoJah origin", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      jsonResponse({
        attemptId: "attempt-1",
        claimToken: "claim-secret",
        verificationUrl: "https://identity.dojah.io.attacker.test/session",
        status: "pending",
      }),
    );

    await expect(
      createRegistrationApi(fetchRequest).createAttempt("student@students.unilorin.edu.ng"),
    ).rejects.toThrow("invalid verification response");
  });

  it("checks status with the in-memory claim as a bearer token", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      jsonResponse({ status: "pending_review", nextAction: "wait_for_review" }),
    );

    const status = await createRegistrationApi(fetchRequest).getStatus(
      "attempt-1",
      "claim-secret",
    );

    expect(status).toEqual({ status: "pending_review", nextAction: "wait_for_review" });
    expect(fetchRequest).toHaveBeenCalledWith("/v1/verification-attempts/attempt-1", {
      headers: { Authorization: "Bearer claim-secret" },
    });
  });

  it("maps a gone attempt to the expired restart state", async () => {
    const fetchRequest = vi.fn().mockResolvedValue({ ok: false, status: 410 } as Response);

    await expect(
      createRegistrationApi(fetchRequest).getStatus("attempt-1", "claim-secret"),
    ).resolves.toEqual({ status: "expired", nextAction: "restart" });
  });

  it("exchanges an approved attempt for a Firebase custom token", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      jsonResponse({ firebaseCustomToken: "firebase-custom-token" }),
    );

    const token = await createRegistrationApi(fetchRequest).exchangeFirebaseToken(
      "attempt-1",
      "claim-secret",
    );

    expect(token).toBe("firebase-custom-token");
    expect(fetchRequest).toHaveBeenCalledWith(
      "/v1/verification-attempts/attempt-1/exchange",
      { method: "POST", headers: { Authorization: "Bearer claim-secret" } },
    );
  });
});

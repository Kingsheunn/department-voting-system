import { describe, expect, it, vi } from "vitest";

import { createStaffAuthService } from "./staff-auth";

describe("createStaffAuthService", () => {
  it("uses in-memory persistence and returns the current ID token and staff claims", async () => {
    const auth = {} as never;
    const user = {
      getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { verificationReviewer: true } }),
    };
    const dependencies = {
      resolveAuth: vi.fn().mockReturnValue(auth),
      connectEmulator: vi.fn(),
      signIn: vi.fn().mockResolvedValue({ user }),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const service = createStaffAuthService(
      { apiKey: "public", authDomain: "example.test", projectId: "vote", appId: "web" },
      undefined,
      dependencies,
    );

    const session = await service.signIn("reviewer@example.test", "password");

    expect(dependencies.resolveAuth).toHaveBeenCalledWith(
      { apiKey: "public", authDomain: "example.test", projectId: "vote", appId: "web" },
      "in-memory",
    );
    await expect(session.getIdToken()).resolves.toBe("firebase-id-token");
    expect(session.roles).toEqual({ reviewer: true, admin: false });
  });

  it.each([
    "https://127.0.0.1:9099",
    "http://firebase.example:9099",
    "http://127.0.0.1:9099/path",
    "not-a-url",
  ])("rejects an unsafe Auth emulator URL: %s", async (emulatorUrl) => {
    const resolveAuth = vi.fn();
    const service = createStaffAuthService(
      { apiKey: "public", authDomain: "localhost", projectId: "demo-vote", appId: "web" },
      emulatorUrl,
      {
        resolveAuth,
        connectEmulator: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
      },
    );

    await expect(service.signIn("reviewer@example.test", "password")).rejects.toThrow(/emulator/i);
    expect(resolveAuth).not.toHaveBeenCalled();
  });
});

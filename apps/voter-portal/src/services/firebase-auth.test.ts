import { describe, expect, it, vi } from "vitest";

import { createFirebaseAuthService } from "./firebase-auth";
import { createLazyFirebaseAuthService } from "./lazy-firebase-auth";

describe("createLazyFirebaseAuthService", () => {
  it("loads Firebase Auth only when custom-token sign-in is requested", async () => {
    const signInWithCustomToken = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue({ signInWithCustomToken });
    const service = createLazyFirebaseAuthService(load);

    expect(load).not.toHaveBeenCalled();

    await service.signInWithCustomToken("firebase-custom-token");

    expect(load).toHaveBeenCalledTimes(1);
    expect(signInWithCustomToken).toHaveBeenCalledWith("firebase-custom-token");
  });

  it("reuses the loaded Firebase Auth service", async () => {
    const signInWithCustomToken = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue({ signInWithCustomToken });
    const service = createLazyFirebaseAuthService(load);

    await service.signInWithCustomToken("first");
    await service.signInWithCustomToken("second");

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("createFirebaseAuthService", () => {
  it("initializes Auth with in-memory persistence before custom-token sign-in", async () => {
    const auth = {} as never;
    const resolveAuth = vi.fn().mockReturnValue(auth);
    const connectEmulator = vi.fn();
    const signIn = vi.fn().mockResolvedValue(undefined);
    const service = createFirebaseAuthService(
      { apiKey: "public", authDomain: "example.test", projectId: "vote", appId: "web" },
      undefined,
      { resolveAuth, connectEmulator, signIn },
    );

    await service.signInWithCustomToken("firebase-custom-token");

    expect(resolveAuth).toHaveBeenCalledWith(
      { apiKey: "public", authDomain: "example.test", projectId: "vote", appId: "web" },
      "in-memory",
    );
    expect(signIn).toHaveBeenCalledWith(auth, "firebase-custom-token");
    expect(resolveAuth.mock.invocationCallOrder[0]).toBeLessThan(
      signIn.mock.invocationCallOrder[0],
    );
  });

  it("connects the loopback Auth emulator before sign-in", async () => {
    const auth = {} as never;
    const resolveAuth = vi.fn().mockReturnValue(auth);
    const connectEmulator = vi.fn();
    const signIn = vi.fn().mockResolvedValue(undefined);
    const service = createFirebaseAuthService(
      { apiKey: "public", authDomain: "localhost", projectId: "demo-vote", appId: "web" },
      "http://127.0.0.1:9099",
      { resolveAuth, connectEmulator, signIn },
    );

    await service.signInWithCustomToken("firebase-custom-token");

    expect(connectEmulator).toHaveBeenCalledWith(auth, "http://127.0.0.1:9099/");
    expect(connectEmulator.mock.invocationCallOrder[0]).toBeLessThan(
      signIn.mock.invocationCallOrder[0],
    );
  });

  it.each([
    "https://127.0.0.1:9099",
    "http://firebase.example:9099",
    "http://127.0.0.1:9099/path",
    "not-a-url",
  ])("rejects an unsafe Auth emulator URL: %s", async (emulatorUrl) => {
    const resolveAuth = vi.fn();
    const service = createFirebaseAuthService(
      { apiKey: "public", authDomain: "localhost", projectId: "demo-vote", appId: "web" },
      emulatorUrl,
      {
        resolveAuth,
        connectEmulator: vi.fn(),
        signIn: vi.fn(),
      },
    );

    await expect(service.signInWithCustomToken("token")).rejects.toThrow(/emulator/i);
    expect(resolveAuth).not.toHaveBeenCalled();
  });

  it("retries emulator connection after a connector failure without signing in", async () => {
    const auth = {} as never;
    const connectEmulator = vi.fn().mockImplementation(() => {
      throw new Error("emulator unavailable");
    });
    const signIn = vi.fn();
    const service = createFirebaseAuthService(
      { apiKey: "public", authDomain: "localhost", projectId: "demo-vote", appId: "web" },
      "http://127.0.0.1:9099",
      {
        resolveAuth: vi.fn().mockReturnValue(auth),
        connectEmulator,
        signIn,
      },
    );

    await expect(service.signInWithCustomToken("first")).rejects.toThrow(
      "emulator unavailable",
    );
    await expect(service.signInWithCustomToken("second")).rejects.toThrow(
      "emulator unavailable",
    );

    expect(connectEmulator).toHaveBeenCalledTimes(2);
    expect(signIn).not.toHaveBeenCalled();
  });
});

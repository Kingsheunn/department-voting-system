import { describe, expect, it, vi } from "vitest";

import { createFirebaseAuthService } from "./firebase-auth";

describe("createFirebaseAuthService", () => {
  it("uses in-memory persistence before custom-token sign-in", async () => {
    const auth = {} as never;
    const resolveAuth = vi.fn().mockReturnValue(auth);
    const useInMemoryPersistence = vi.fn().mockResolvedValue(undefined);
    const signIn = vi.fn().mockResolvedValue(undefined);
    const service = createFirebaseAuthService(
      { apiKey: "public", authDomain: "example.test", projectId: "vote", appId: "web" },
      { resolveAuth, useInMemoryPersistence, signIn },
    );

    await service.signInWithCustomToken("firebase-custom-token");

    expect(useInMemoryPersistence).toHaveBeenCalledWith(auth);
    expect(signIn).toHaveBeenCalledWith(auth, "firebase-custom-token");
    expect(useInMemoryPersistence.mock.invocationCallOrder[0]).toBeLessThan(
      signIn.mock.invocationCallOrder[0],
    );
  });
});

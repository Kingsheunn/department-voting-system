import { describe, expect, it, vi } from "vitest";

import { createLazyStaffAuthService } from "./lazy-staff-auth";

describe("createLazyStaffAuthService", () => {
  it("loads Firebase Auth only when staff sign-in is requested", async () => {
    const session = { roles: { reviewer: true, admin: false }, getIdToken: vi.fn() };
    const service = { signIn: vi.fn().mockResolvedValue(session), signOut: vi.fn() };
    const load = vi.fn().mockResolvedValue(service);
    const auth = createLazyStaffAuthService(load);

    expect(load).not.toHaveBeenCalled();
    await expect(auth.signIn("reviewer@example.test", "password")).resolves.toBe(session);

    expect(load).toHaveBeenCalledTimes(1);
    expect(service.signIn).toHaveBeenCalledWith("reviewer@example.test", "password");
  });
});

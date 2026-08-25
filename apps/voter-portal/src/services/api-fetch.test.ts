import { describe, expect, it, vi } from "vitest";

import { createApiFetch } from "./api-fetch";

describe("createApiFetch", () => {
  it("keeps relative API paths for the local same-origin proxy", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response());

    await createApiFetch(undefined, fetchRequest)("/v1/election/current");

    expect(fetchRequest).toHaveBeenCalledWith("/v1/election/current", undefined);
  });

  it("resolves API paths against an exact HTTPS deployment origin", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response());

    await createApiFetch("https://department-voting-api.onrender.com", fetchRequest)(
      "/v1/election/current",
      { headers: { Authorization: "Bearer token" } },
    );

    expect(fetchRequest).toHaveBeenCalledWith(
      "https://department-voting-api.onrender.com/v1/election/current",
      { headers: { Authorization: "Bearer token" } },
    );
  });

  it("rejects insecure or path-bearing deployment origins before fetching", () => {
    const fetchRequest = vi.fn<typeof fetch>();

    for (const origin of [
      "http://department-voting-api.onrender.com",
      "https://department-voting-api.onrender.com/v1",
      "https://user@department-voting-api.onrender.com",
    ]) {
      expect(() => createApiFetch(origin, fetchRequest)).toThrow("invalid API origin");
    }
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

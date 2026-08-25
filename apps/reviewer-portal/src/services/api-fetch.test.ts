import { describe, expect, it, vi } from "vitest";

import { createApiFetch } from "./api-fetch";

describe("createApiFetch", () => {
  it("resolves reviewer API paths against an exact HTTPS deployment origin", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response());

    await createApiFetch("https://department-voting-api.onrender.com", fetchRequest)(
      "/v1/admin/verification-reviews",
    );

    expect(fetchRequest).toHaveBeenCalledWith(
      "https://department-voting-api.onrender.com/v1/admin/verification-reviews",
      undefined,
    );
  });

  it("rejects non-HTTPS deployment origins before fetching", () => {
    const fetchRequest = vi.fn<typeof fetch>();

    expect(() => createApiFetch("http://department-voting-api.onrender.com", fetchRequest))
      .toThrow("invalid API origin");
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

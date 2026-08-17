import { describe, expect, it, vi } from "vitest";

import { createElectionApi } from "./election-api";

const configuration = {
  title: "Department election",
  publicUrl: "https://vote.belenios.org/v3/elections/demo-election/",
  electionUuid: "demo-election",
  opensAt: "2026-09-01T08:00:00.000Z",
  closesAt: "2026-09-01T16:00:00.000Z",
  voterCount: 120,
  rosterReviewed: true,
  credentialAuthorityConfirmed: true,
  trusteesConfirmed: true,
  published: true,
  revision: 1,
  updatedAt: "2026-08-16T10:00:00.000Z",
};

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
});

describe("createElectionApi", () => {
  it("loads and saves configuration with a Firebase administrator token", async () => {
    const fetchRequest = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ configuration }))
      .mockResolvedValueOnce(jsonResponse({ configuration: { ...configuration, revision: 2 } }));
    const api = createElectionApi(() => Promise.resolve("admin-token"), fetchRequest);

    expect(await api.getConfiguration()).toEqual(configuration);
    await api.saveConfiguration({
      expectedRevision: 1,
      title: configuration.title,
      publicUrl: configuration.publicUrl,
      opensAt: configuration.opensAt,
      closesAt: configuration.closesAt,
      voterCount: configuration.voterCount,
      rosterReviewed: true,
      credentialAuthorityConfirmed: true,
      trusteesConfirmed: true,
      published: true,
    });

    expect(fetchRequest).toHaveBeenNthCalledWith(1, "/v1/admin/election-configuration", {
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(fetchRequest).toHaveBeenNthCalledWith(
      2,
      "/v1/admin/election-configuration",
      expect.objectContaining({
        method: "PUT",
        headers: {
          Authorization: "Bearer admin-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("rejects an election URL outside the Belenios v3 service", async () => {
    const api = createElectionApi(
      () => Promise.resolve("admin-token"),
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        configuration: { ...configuration, publicUrl: "https://evil.example/election" },
      })),
    );

    await expect(api.getConfiguration()).rejects.toThrow("invalid election response");
  });

  it("rejects an invalid timestamp without throwing an implementation error", async () => {
    const api = createElectionApi(
      () => Promise.resolve("admin-token"),
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        configuration: { ...configuration, opensAt: "2026-99-01T08:00:00.000Z" },
      })),
    );

    await expect(api.getConfiguration()).rejects.toThrow("invalid election response");
  });
});

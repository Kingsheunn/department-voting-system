import { describe, expect, it, vi } from "vitest";

import { createElectionApi } from "./election-api";

const election = {
  title: "Department election",
  publicUrl: "https://vote.belenios.org/v3/election#demo-election",
  electionUuid: "demo-election",
  opensAt: "2026-09-01T08:00:00.000Z",
  closesAt: "2026-09-01T16:00:00.000Z",
  state: "Open",
  canVote: true,
};

describe("createElectionApi", () => {
  it("loads the published election with the verified Firebase token", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify(election),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    await expect(createElectionApi(fetchRequest).getCurrent("id-token")).resolves.toEqual(election);
    expect(fetchRequest).toHaveBeenCalledWith("/v1/election/current", {
      headers: { Authorization: "Bearer id-token" },
    });
  });

  it("returns no election when the administrator has not published one", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(createElectionApi(fetchRequest).getCurrent("id-token")).resolves.toBeNull();
  });

  it("rejects an untrusted election destination", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ...election,
      publicUrl: "https://evil.example/ballot",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(createElectionApi(fetchRequest).getCurrent("id-token")).rejects.toThrow(
      "invalid election response",
    );
  });

  it("rejects an invalid timestamp without throwing an implementation error", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ...election,
      opensAt: "2026-99-01T08:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(createElectionApi(fetchRequest).getCurrent("id-token")).rejects.toThrow(
      "invalid election response",
    );
  });
});

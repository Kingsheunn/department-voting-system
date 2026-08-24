import assert from "node:assert/strict";
import test from "node:test";

import { createBeleniosClient } from "../src/belenios.js";

const configuration = {
  api_version: 6,
  belenios_version: "3.1",
};

const response = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
  ...init,
});

test("reads and sanitizes the live Belenios v3 election state", async () => {
  const requests = [];
  const client = createBeleniosClient({
    fetchRequest: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/configuration")) return response(configuration);
      if (String(url).endsWith("/automatic-dates")) {
        return response({ open: 1771196400, close: 1771671600 });
      }
      return response({
        state: "Open",
        authentication: ["Configured", "email"],
        auto_delete_date: 1803815819,
        sealed: false,
      });
    },
  });

  assert.deepEqual(await client.getElectionReadiness("yQV1vV442AfUM7"), {
    state: "Open",
    canVote: true,
    opensAt: "2026-02-15T23:00:00.000Z",
    closesAt: "2026-02-21T11:00:00.000Z",
  });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ options }) => options.redirect === "error"));
  assert.ok(requests.every(({ options }) => options.headers.accept === "application/json"));
});

test("fails closed on unsupported versions and unknown election states", async () => {
  for (const [config, state] of [
    [{ ...configuration, api_version: 7 }, "Open"],
    [configuration, "OpeningSoon"],
  ]) {
    const client = createBeleniosClient({
      fetchRequest: async (url) => {
        if (String(url).endsWith("/configuration")) return response(config);
        if (String(url).endsWith("/automatic-dates")) return response({});
        return response({ state, auto_delete_date: 1803815819, sealed: false });
      },
    });
    await assert.rejects(
      client.getElectionReadiness("yQV1vV442AfUM7"),
      /Belenios election service is unavailable/,
    );
  }
});

test("rejects malformed, oversized, redirected, and invalid election responses", async () => {
  const invalidResponses = [
    new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify(configuration), {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "65537" },
    }),
    Object.defineProperty(response(configuration), "redirected", { value: true }),
  ];

  for (const invalidResponse of invalidResponses) {
    const client = createBeleniosClient({ fetchRequest: async () => invalidResponse });
    await assert.rejects(
      client.getElectionReadiness("yQV1vV442AfUM7"),
      /Belenios election service is unavailable/,
    );
  }
  await assert.rejects(
    createBeleniosClient({ fetchRequest: async () => response(configuration) })
      .getElectionReadiness("not valid"),
    /Belenios election identifier is invalid/,
  );
});

test("aborts a stalled Belenios readiness request", async () => {
  const client = createBeleniosClient({
    timeoutMs: 10,
    fetchRequest: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });

  await assert.rejects(
    client.getElectionReadiness("yQV1vV442AfUM7"),
    /Belenios election service is unavailable/,
  );
});

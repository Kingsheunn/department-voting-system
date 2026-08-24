import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApiHandler } from "../src/app.js";
import { createMemoryStore } from "../src/memory-store.js";

const validConfiguration = {
  expectedRevision: 0,
  title: "Computer Science Department Election",
  publicUrl: "https://vote.belenios.org/v3/election#demo-election",
  opensAt: "2026-09-01T08:00:00.000Z",
  closesAt: "2026-09-01T16:00:00.000Z",
  voterCount: 120,
  rosterReviewed: true,
  credentialAuthorityConfirmed: true,
  trusteesConfirmed: true,
  published: true,
};

async function startApi({ state = "Open", readinessError } = {}) {
  const store = createMemoryStore({
    now: () => new Date("2026-08-16T10:00:00.000Z"),
  });
  const staffTokens = {
    admin: { uid: "admin-one", verificationAdmin: true },
    reviewer: { uid: "reviewer-one", verificationReviewer: true },
  };
  const identityTokens = {
    verified: { uid: "voter-one", identityVerified: true },
    unverified: { uid: "voter-two", identityVerified: false },
  };
  const handler = createApiHandler({
    store,
    dojahResolver: async () => { throw new Error("unused"); },
    firebaseAuth: {
      async verifyStaffToken(token) {
        if (!staffTokens[token]) throw new Error("invalid token");
        return staffTokens[token];
      },
      async verifyIdentityToken(token) {
        if (!identityTokens[token]) throw new Error("invalid token");
        return identityTokens[token];
      },
    },
    publicDojahConfig: { widgetId: "public-widget" },
    webhookSecret: "election-test-secret",
    providerEnvironment: "sandbox",
    electionConfigurationEnabled: true,
    beleniosClient: {
      async getElectionReadiness() {
        if (readinessError) throw readinessError;
        return {
          state,
          canVote: state === "Open",
          opensAt: validConfiguration.opensAt,
          closesAt: validConfiguration.closesAt,
        };
      },
    },
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    store,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}

function save(api, token, body) {
  return fetch(`${api.origin}/v1/admin/election-configuration`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("only an administrator can save and read election configuration", async (t) => {
  const api = await startApi();
  t.after(api.close);

  assert.equal((await save(api, "reviewer", validConfiguration)).status, 403);
  const saved = await save(api, "admin", validConfiguration);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), {
    configuration: {
      title: validConfiguration.title,
      publicUrl: validConfiguration.publicUrl,
      electionUuid: "demo-election",
      opensAt: validConfiguration.opensAt,
      closesAt: validConfiguration.closesAt,
      voterCount: validConfiguration.voterCount,
      rosterReviewed: true,
      credentialAuthorityConfirmed: true,
      trusteesConfirmed: true,
      published: true,
      revision: 1,
      updatedAt: "2026-08-16T10:00:00.000Z",
    },
  });

  const read = await fetch(`${api.origin}/v1/admin/election-configuration`, {
    headers: { authorization: "Bearer admin" },
  });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).configuration.revision, 1);
});

test("rejects unsafe, incomplete, and secret-bearing configuration", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const invalidInputs = [
    { ...validConfiguration, publicUrl: "https://vote.belenios.org/v3/elections/old/" },
    { ...validConfiguration, publicUrl: "https://evil.example/v3/elections/demo/" },
    { ...validConfiguration, publicUrl: "https://vote.belenios.org:444/v3/elections/demo/" },
    { ...validConfiguration, closesAt: validConfiguration.opensAt },
    { ...validConfiguration, voterCount: 2501 },
    { ...validConfiguration, trusteesConfirmed: false },
    { ...validConfiguration, beleniosAdminToken: "must-not-be-accepted" },
  ];

  for (const input of invalidInputs) {
    assert.equal((await save(api, "admin", input)).status, 400);
  }
  assert.equal(await api.store.getElectionConfiguration(), null);
});

test("uses revision compare-and-set for administrator updates", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await save(api, "admin", validConfiguration);

  const updated = await save(api, "admin", {
    ...validConfiguration,
    expectedRevision: 1,
    title: "Updated department election",
  });
  const stale = await save(api, "admin", {
    ...validConfiguration,
    expectedRevision: 1,
    title: "Stale overwrite",
  });

  assert.equal(updated.status, 200);
  assert.equal(stale.status, 409);
  assert.equal((await api.store.getElectionConfiguration()).title, "Updated department election");
});

test("returns only published public metadata to an identity-verified voter", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await save(api, "admin", validConfiguration);

  const response = await fetch(`${api.origin}/v1/election/current`, {
    headers: { authorization: "Bearer verified" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    title: validConfiguration.title,
    publicUrl: validConfiguration.publicUrl,
    electionUuid: "demo-election",
    opensAt: validConfiguration.opensAt,
    closesAt: validConfiguration.closesAt,
    state: "Open",
    canVote: true,
  });
  assert.equal((await fetch(`${api.origin}/v1/election/current`, {
    headers: { authorization: "Bearer unverified" },
  })).status, 403);
});

test("returns live readiness only to an administrator", async (t) => {
  const api = await startApi({ state: "Tallied" });
  t.after(api.close);
  await save(api, "admin", validConfiguration);

  assert.equal((await fetch(`${api.origin}/v1/admin/election-readiness`, {
    headers: { authorization: "Bearer reviewer" },
  })).status, 403);
  const response = await fetch(`${api.origin}/v1/admin/election-readiness`, {
    headers: { authorization: "Bearer admin" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    readiness: {
      state: "Tallied",
      canVote: false,
      opensAt: validConfiguration.opensAt,
      closesAt: validConfiguration.closesAt,
    },
  });
});

test("fails closed when live Belenios readiness is unavailable", async (t) => {
  const api = await startApi({ readinessError: new Error("provider failed") });
  t.after(api.close);
  await save(api, "admin", validConfiguration);

  const voter = await fetch(`${api.origin}/v1/election/current`, {
    headers: { authorization: "Bearer verified" },
  });
  const admin = await fetch(`${api.origin}/v1/admin/election-readiness`, {
    headers: { authorization: "Bearer admin" },
  });
  assert.equal(voter.status, 503);
  assert.equal(admin.status, 503);
  assert.deepEqual(await voter.json(), { error: "Election readiness is unavailable" });
});

test("does not expose an unpublished election to voters", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await save(api, "admin", {
    ...validConfiguration,
    rosterReviewed: false,
    credentialAuthorityConfirmed: false,
    trusteesConfirmed: false,
    published: false,
  });

  const response = await fetch(`${api.origin}/v1/election/current`, {
    headers: { authorization: "Bearer verified" },
  });
  assert.equal(response.status, 404);
});

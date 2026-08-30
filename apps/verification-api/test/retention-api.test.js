import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApiHandler } from "../src/app.js";

const EDGE_SECRET = "e".repeat(32);
const RETENTION_SECRET = "r".repeat(32);
const NOW = new Date("2026-08-30T02:00:00.000Z");

async function startApi({ cleanupResult, cleanupError } = {}) {
  const calls = [];
  const store = {
    async cleanupExpired(input) {
      calls.push(input);
      if (cleanupError) throw cleanupError;
      return cleanupResult ?? {
        status: "complete",
        deletedTotal: 3,
        deletedByCollection: {
          verificationAttempts: 1,
          verificationReferences: 1,
          verificationReviewAudits: 1,
          electionConfigurationAudits: 0,
        },
        hasMore: false,
        failedCollections: [],
      };
    },
  };
  const handler = createApiHandler({
    store,
    dojahResolver: async () => ({}),
    publicDojahConfig: { widgetId: "public-widget" },
    webhookSecret: "test-only-secret",
    providerEnvironment: "sandbox",
    allowedOrigins: ["https://voting-app-6e1fb.web.app"],
    edgeSharedSecret: EDGE_SECRET,
    retentionCleanupEnabled: true,
    retentionCleanupSecret: RETENTION_SECRET,
    now: () => new Date(NOW),
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    calls,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function cleanupRequest(api, headers = {}, body) {
  return fetch(`${api.origin}/internal/retention-cleanup?limit=9999`, {
    method: "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("retention cleanup requires both independent secrets and rejects browser origins", async () => {
  const api = await startApi();
  try {
    const missingEdge = await cleanupRequest(api, {
      "X-Department-Retention-Auth": RETENTION_SECRET,
    });
    assert.equal(missingEdge.status, 403);

    const missingRetention = await cleanupRequest(api, {
      "X-Department-Edge-Auth": EDGE_SECRET,
    });
    assert.equal(missingRetention.status, 403);

    const wrongRetention = await cleanupRequest(api, {
      "X-Department-Edge-Auth": EDGE_SECRET,
      "X-Department-Retention-Auth": "wrong",
    });
    assert.equal(wrongRetention.status, 403);

    const browser = await cleanupRequest(api, {
      "X-Department-Edge-Auth": EDGE_SECRET,
      "X-Department-Retention-Auth": RETENTION_SECRET,
      Origin: "https://voting-app-6e1fb.web.app",
    });
    assert.equal(browser.status, 403);
    assert.equal(api.calls.length, 0);
  } finally {
    await api.close();
  }
});

test("retention cleanup uses server policy and returns only the sanitized receipt", async () => {
  const api = await startApi();
  try {
    const response = await cleanupRequest(api, {
      "Content-Type": "application/json",
      "X-Department-Edge-Auth": EDGE_SECRET,
      "X-Department-Retention-Auth": RETENTION_SECRET,
    }, {
      collection: "verificationEmailUids",
      cutoff: "2099-01-01T00:00:00.000Z",
      limit: 9999,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "complete",
      deletedTotal: 3,
      deletedByCollection: {
        verificationAttempts: 1,
        verificationReferences: 1,
        verificationReviewAudits: 1,
        electionConfigurationAudits: 0,
      },
      hasMore: false,
      failedCollections: [],
    });
    assert.deepEqual(api.calls, [{ cutoff: NOW, limit: 100 }]);
  } finally {
    await api.close();
  }
});

test("retention cleanup reports partial and unexpected failures without details", async () => {
  const partial = await startApi({
    cleanupResult: {
      status: "partial",
      deletedTotal: 0,
      deletedByCollection: {
        verificationAttempts: 0,
        verificationReferences: 0,
        verificationReviewAudits: 0,
        electionConfigurationAudits: 0,
      },
      hasMore: false,
      failedCollections: ["verificationAttempts"],
    },
  });
  try {
    const response = await cleanupRequest(partial, {
      "X-Department-Edge-Auth": EDGE_SECRET,
      "X-Department-Retention-Auth": RETENTION_SECRET,
    });
    assert.equal(response.status, 503);
    assert.deepEqual((await response.json()).failedCollections, ["verificationAttempts"]);
  } finally {
    await partial.close();
  }

  const failed = await startApi({
    cleanupError: new Error("student@example.edu secret-value provider-reference"),
  });
  try {
    const response = await cleanupRequest(failed, {
      "X-Department-Edge-Auth": EDGE_SECRET,
      "X-Department-Retention-Auth": RETENTION_SECRET,
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error" });
  } finally {
    await failed.close();
  }
});

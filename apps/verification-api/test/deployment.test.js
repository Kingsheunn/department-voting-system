import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApiHandler } from "../src/app.js";
import { createMemoryStore } from "../src/memory-store.js";

async function startApi(allowedOrigins = [], { edgeSharedSecret } = {}) {
  const handler = createApiHandler({
    store: createMemoryStore(),
    dojahResolver: async () => ({}),
    publicDojahConfig: { widgetId: "public-widget" },
    webhookSecret: "test-only-secret",
    providerEnvironment: "sandbox",
    allowedOrigins,
    edgeSharedSecret,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("keeps liveness public but rejects protected direct-origin requests", async () => {
  const edgeSharedSecret = "e".repeat(32);
  const api = await startApi([], { edgeSharedSecret });
  try {
    assert.equal((await fetch(`${api.origin}/healthz`)).status, 200);

    const missing = await fetch(`${api.origin}/v1/election/current`);
    assert.equal(missing.status, 403);
    assert.deepEqual(await missing.json(), { error: "Edge authorization is required" });

    const wrong = await fetch(`${api.origin}/v1/election/current`, {
      headers: { "X-Department-Edge-Auth": "wrong-secret" },
    });
    assert.equal(wrong.status, 403);

    const authorized = await fetch(`${api.origin}/v1/election/current`, {
      headers: { "X-Department-Edge-Auth": edgeSharedSecret },
    });
    assert.equal(authorized.status, 503);
    assert.deepEqual(await authorized.json(), { error: "Election configuration is disabled" });
  } finally {
    await api.close();
  }
});

test("uses only the authenticated edge fingerprint for defense-in-depth limiting", async () => {
  const edgeSharedSecret = "e".repeat(32);
  const api = await startApi([], { edgeSharedSecret });
  const createAttempt = (edgeClient) => fetch(`${api.origin}/v1/verification-attempts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Department-Edge-Auth": edgeSharedSecret,
      "X-Department-Edge-Client": edgeClient,
    },
    body: JSON.stringify({ email: "student@students.unilorin.edu.ng" }),
  });

  try {
    for (let count = 0; count < 5; count += 1) {
      assert.equal((await createAttempt("client-a")).status, 201);
    }
    assert.equal((await createAttempt("client-a")).status, 429);
    assert.equal((await createAttempt("client-b")).status, 201);
  } finally {
    await api.close();
  }
});

test("reports API liveness without exposing configuration", async () => {
  const api = await startApi();
  try {
    const response = await fetch(`${api.origin}/healthz`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    await api.close();
  }
});

test("allows an exact portal origin and answers its preflight", async () => {
  const portalOrigin = "https://department-voting.web.app";
  const api = await startApi([portalOrigin]);
  try {
    const response = await fetch(`${api.origin}/healthz`, {
      method: "OPTIONS",
      headers: {
        Origin: portalOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), portalOrigin);
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, PUT, OPTIONS");
    assert.equal(
      response.headers.get("access-control-allow-headers"),
      "authorization, content-type, idempotency-key",
    );
    assert.match(response.headers.get("vary") ?? "", /origin/i);
  } finally {
    await api.close();
  }
});

test("rejects browser requests from an unconfigured origin", async () => {
  const api = await startApi(["https://department-voting.web.app"]);
  try {
    const response = await fetch(`${api.origin}/healthz`, {
      headers: { Origin: "https://attacker.example" },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await response.json(), { error: "Origin is not allowed" });
  } finally {
    await api.close();
  }
});

test("rejects unsupported preflight methods and headers", async () => {
  const portalOrigin = "https://department-voting.web.app";
  const api = await startApi([portalOrigin]);
  try {
    const response = await fetch(`${api.origin}/healthz`, {
      method: "OPTIONS",
      headers: {
        Origin: portalOrigin,
        "Access-Control-Request-Method": "DELETE",
        "Access-Control-Request-Headers": "x-untrusted-header",
      },
    });

    assert.equal(response.status, 403);
  } finally {
    await api.close();
  }
});

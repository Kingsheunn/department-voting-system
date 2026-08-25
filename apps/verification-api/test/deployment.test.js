import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApiHandler } from "../src/app.js";
import { createMemoryStore } from "../src/memory-store.js";

async function startApi(allowedOrigins = []) {
  const handler = createApiHandler({
    store: createMemoryStore(),
    dojahResolver: async () => ({}),
    publicDojahConfig: { widgetId: "public-widget" },
    webhookSecret: "test-only-secret",
    providerEnvironment: "sandbox",
    allowedOrigins,
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

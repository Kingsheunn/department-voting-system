import assert from "node:assert/strict";
import test from "node:test";

import { createGateway } from "../src/worker.js";

const SECRET = "s".repeat(32);
const VOTER_ORIGIN = "https://voting-app-6e1fb.web.app";

function environment(overrides = {}) {
  return {
    UPSTREAM_ORIGIN: "https://department-voting-api.onrender.com",
    ORIGIN_SHARED_SECRET: SECRET,
    ALLOWED_PORTAL_ORIGINS: `${VOTER_ORIGIN},https://voting-app-6e1fb-reviewer.web.app`,
    ATTEMPT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

test("rate limits attempt creation by the Cloudflare client address", async () => {
  let upstreamCalls = 0;
  const handler = createGateway({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response("unexpected");
    },
  });
  const keys = [];
  const response = await handler.fetch(
    new Request("https://gateway.example/v1/verification-attempts", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.9", Origin: VOTER_ORIGIN },
      body: "{}",
    }),
    environment({
      ATTEMPT_RATE_LIMITER: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: false };
        },
      },
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), VOTER_ORIGIN);
  assert.equal(response.headers.get("vary"), "Origin");
  assert.deepEqual(keys, ["203.0.113.9"]);
  assert.equal(upstreamCalls, 0);
});

test("fails closed when Cloudflare does not provide a client address", async () => {
  let upstreamCalls = 0;
  const response = await createGateway({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response("unexpected");
    },
  }).fetch(
    new Request("https://gateway.example/v1/verification-attempts", {
      method: "POST",
      headers: { Origin: VOTER_ORIGIN },
      body: "{}",
    }),
    environment(),
  );

  assert.equal(response.status, 503);
  assert.equal(upstreamCalls, 0);
});

test("streams allowed requests to the exact upstream with trusted edge headers", async () => {
  let forwarded;
  const handler = createGateway({
    fetchImpl: async (request, options) => {
      forwarded = { request, options };
      return new Response('{"status":"ok"}', {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await handler.fetch(
    new Request("https://gateway.example/v1/verification-attempts?source=portal", {
      method: "POST",
      headers: {
        Authorization: "Bearer voter-token",
        "CF-Connecting-IP": "203.0.113.10",
        "Content-Type": "application/json",
        Origin: VOTER_ORIGIN,
        "X-Department-Edge-Auth": "attacker-value",
        "X-Department-Edge-Client": "attacker-value",
      },
      body: '{"email":"student@example.edu"}',
    }),
    environment(),
  );

  assert.equal(response.status, 201);
  assert.equal(await response.text(), '{"status":"ok"}');
  assert.equal(
    forwarded.request.url,
    "https://department-voting-api.onrender.com/v1/verification-attempts?source=portal",
  );
  assert.equal(forwarded.request.headers.get("authorization"), "Bearer voter-token");
  assert.equal(forwarded.request.headers.get("x-department-edge-auth"), SECRET);
  assert.match(forwarded.request.headers.get("x-department-edge-client"), /^[a-f0-9]{64}$/);
  assert.notEqual(forwarded.request.headers.get("x-department-edge-client"), "attacker-value");
  assert.equal(await forwarded.request.text(), '{"email":"student@example.edu"}');
  assert.deepEqual(forwarded.options, { redirect: "manual" });
});

test("rejects untrusted or missing attempt origins before spending the limiter", async () => {
  let limiterCalls = 0;
  let upstreamCalls = 0;
  const handler = createGateway({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response("unexpected");
    },
  });
  const configuredEnvironment = environment({
    ATTEMPT_RATE_LIMITER: {
      limit: async () => {
        limiterCalls += 1;
        return { success: true };
      },
    },
  });

  for (const origin of [undefined, "https://attacker.example"]) {
    const headers = { "CF-Connecting-IP": "203.0.113.12" };
    if (origin) headers.Origin = origin;
    const response = await handler.fetch(
      new Request("https://gateway.example/v1/verification-attempts", {
        method: "POST",
        headers,
        body: "{}",
      }),
      configuredEnvironment,
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }

  assert.equal(limiterCalls, 0);
  assert.equal(upstreamCalls, 0);
});

test("keeps no-Origin server callbacks available outside attempt creation", async () => {
  let limiterCalls = 0;
  const response = await createGateway({
    fetchImpl: async () => new Response(null, { status: 204 }),
  }).fetch(
    new Request("https://gateway.example/v1/dojah/webhook", {
      method: "POST",
      body: "signed-provider-payload",
    }),
    environment({
      ATTEMPT_RATE_LIMITER: {
        limit: async () => {
          limiterCalls += 1;
          return { success: true };
        },
      },
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(limiterCalls, 0);
});

test("does not spend the attempt limiter on other API routes", async () => {
  let limiterCalls = 0;
  const response = await createGateway({
    fetchImpl: async () => new Response('{"status":"ok"}'),
  }).fetch(
    new Request("https://gateway.example/healthz"),
    environment({
      ATTEMPT_RATE_LIMITER: {
        limit: async () => {
          limiterCalls += 1;
          return { success: true };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(limiterCalls, 0);
});

test("rejects unsafe configuration, unsupported routes, methods, and redirects", async () => {
  let upstreamCalls = 0;
  const fetchImpl = async () => {
    upstreamCalls += 1;
    return Response.redirect("https://attacker.example", 302);
  };
  const handler = createGateway({ fetchImpl });

  for (const upstreamOrigin of [
    "http://department-voting-api.onrender.com",
    "https://user@department-voting-api.onrender.com",
    "https://department-voting-api.onrender.com:4443",
    "https://department-voting-api.onrender.com/path",
    "https://department-voting-api.onrender.com?target=other",
    "https://department-voting-api.onrender.com#fragment",
  ]) {
    assert.equal(
      (await handler.fetch(new Request("https://gateway.example/healthz"), environment({
        UPSTREAM_ORIGIN: upstreamOrigin,
      }))).status,
      503,
    );
  }
  for (const portalOrigins of [
    "",
    "http://voting-app-6e1fb.web.app",
    "https://voting-app-6e1fb.web.app/path",
  ]) {
    assert.equal(
      (await handler.fetch(new Request("https://gateway.example/healthz"), environment({
        ALLOWED_PORTAL_ORIGINS: portalOrigins,
      }))).status,
      503,
    );
  }
  assert.equal(
    (await handler.fetch(new Request("https://gateway.example/private"), environment())).status,
    404,
  );
  assert.equal(
    (await handler.fetch(new Request("https://gateway.example/v1/election/current", {
      method: "DELETE",
    }), environment())).status,
    405,
  );
  const redirect = await handler.fetch(
    new Request("https://gateway.example/healthz"),
    environment(),
  );
  assert.equal(redirect.status, 502);
  assert.equal(redirect.headers.get("location"), null);
  assert.equal(upstreamCalls, 1);
});

test("fails closed when the limiter or upstream fetch fails", async () => {
  let upstreamCalls = 0;
  const limiterFailure = await createGateway({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response("unexpected");
    },
  }).fetch(
    new Request("https://gateway.example/v1/verification-attempts", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.11", Origin: VOTER_ORIGIN },
      body: "{}",
    }),
    environment({
      ATTEMPT_RATE_LIMITER: { limit: async () => { throw new Error("unavailable"); } },
    }),
  );
  assert.equal(limiterFailure.status, 503);
  assert.equal(upstreamCalls, 0);

  const upstreamFailure = await createGateway({
    fetchImpl: async () => { throw new Error("unavailable"); },
  }).fetch(new Request("https://gateway.example/healthz", {
    headers: { Origin: VOTER_ORIGIN },
  }), environment());
  assert.equal(upstreamFailure.status, 502);
  assert.equal(upstreamFailure.headers.get("access-control-allow-origin"), VOTER_ORIGIN);
  assert.deepEqual(await upstreamFailure.json(), { error: "Upstream service is unavailable" });
});

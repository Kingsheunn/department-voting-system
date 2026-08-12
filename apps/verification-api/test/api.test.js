import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createApiHandler } from "../src/app.js";
import { createMemoryStore } from "../src/memory-store.js";

const schoolEmail = "student.one@students.unilorin.edu.ng";
const webhookSecret = "test-only-webhook-secret";

async function startApi(overrides = {}) {
  const store = overrides.store ?? createMemoryStore();
  const firebaseCalls = [];
  const handler = createApiHandler({
    store,
    dojahResolver:
      overrides.dojahResolver ??
      (async () => {
        throw new Error("resolver not configured for this test");
      }),
    firebaseAuth: Object.hasOwn(overrides, "firebaseAuth")
      ? overrides.firebaseAuth
      : {
        async provisionAndMint(input) {
          firebaseCalls.push(input);
          return `firebase-token-${input.uid}`;
        },
      },
    publicDojahConfig: { widgetId: "public-widget" },
    webhookSecret,
    now: overrides.now,
    verificationPolicy:
      overrides.verificationPolicy ??
      { contractConfirmed: true, allowedDocumentTypes: ["Student ID"] },
    accountProvisioningEnabled: overrides.accountProvisioningEnabled ?? true,
    attemptRateLimit: overrides.attemptRateLimit,
    providerEnvironment: overrides.providerEnvironment ?? "sandbox",
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    store,
    firebaseCalls,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function createAttempt(api, email = schoolEmail) {
  const response = await fetch(`${api.origin}/v1/verification-attempts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return { response, body: await response.json() };
}

function completedResult(referenceId, overrides = {}) {
  return {
    reference_id: referenceId,
    verification_status: "Completed",
    verification_mode: "LIVENESS",
    status: true,
    data: {
      email: { status: true, data: { email: schoolEmail } },
      id: {
        status: true,
        data: {
          id_data: {
            document_number: "STUDENT-1",
            document_type: "Student ID",
          },
        },
      },
      selfie: { status: true, data: { selfie_url: "https://provider.invalid/selfie" } },
    },
    ...overrides,
  };
}

async function sendWebhook(api, payload, secret = webhookSecret) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return fetch(`${api.origin}/v1/webhooks/dojah`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dojah-signature": signature,
    },
    body: raw,
  });
}

test("stops retaining an oversized request body after rejecting it", async () => {
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    url: "/v1/verification-attempts",
    socket: { remoteAddress: "127.0.0.1" },
  });
  const headers = new Map();
  const response = {
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name, value);
    },
    end() {},
  };
  const handler = createApiHandler({
    store: createMemoryStore(),
    dojahResolver: async () => ({}),
    firebaseAuth: { provisionAndMint: async () => "unused" },
    publicDojahConfig: { widgetId: "public-widget" },
    webhookSecret,
    providerEnvironment: "sandbox",
  });

  const handled = handler(request, response);
  request.write(Buffer.alloc(16 * 1024 + 1));
  await handled;

  assert.equal(response.statusCode, 413);
  assert.equal(request.listenerCount("data"), 0);
  assert.equal(request.listenerCount("end"), 0);
  assert.equal(request.listenerCount("error"), 0);
  request.destroy();
});

test("creates an attempt without retaining the raw claim token", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const { response, body } = await createAttempt(api);
  const stored = await api.store.getAttempt(body.attemptId);

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'",
  );
  assert.match(body.claimToken, /^ct_/);
  assert.equal(new URL(body.verificationUrl).hostname, "identity.dojah.io");
  assert.equal(stored.claimToken, undefined);
  assert.equal(typeof stored.claimTokenHash, "string");
  assert.notEqual(stored.claimTokenHash, body.claimToken);
  assert.equal(stored.expiresAt, body.expiresAt);
  assert.equal(
    Date.parse(body.expiresAt) - Date.parse(stored.createdAt),
    30 * 60 * 1000,
  );
  assert.equal(stored.deleteAfter instanceof Date, true);
  assert.equal(
    stored.deleteAfter.getTime() - Date.parse(stored.createdAt),
    24 * 60 * 60 * 1000,
  );
  assert.deepEqual(stored.verificationPolicy, {
    contractConfirmed: true,
    allowedDocumentTypes: ["Student ID"],
    providerEnvironment: "sandbox",
  });
});

test("expires claim credentials after thirty minutes", async (t) => {
  let currentTime = Date.parse("2026-08-10T12:00:00.000Z");
  const api = await startApi({ now: () => new Date(currentTime) });
  t.after(api.close);
  const { body } = await createAttempt(api);
  currentTime = Date.parse(body.expiresAt);

  const headers = { authorization: `Bearer ${body.claimToken}` };
  const status = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}`,
    { headers },
  );
  const exchange = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`,
    { method: "POST", headers },
  );

  assert.equal(status.status, 410);
  assert.equal(exchange.status, 410);
  assert.equal(api.firebaseCalls.length, 0);
});

test("rejects an email outside the exact school domain", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const { response } = await createAttempt(api, "student@example.com");

  assert.equal(response.status, 400);
});

test("rejects JSON null as a bad request", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const response = await fetch(`${api.origin}/v1/verification-attempts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });

  assert.equal(response.status, 400);
});

test("rate limits repeated attempt creation within a fixed window", async (t) => {
  let currentTime = Date.parse("2026-08-10T12:00:00.000Z");
  const api = await startApi({
    now: () => new Date(currentTime),
    attemptRateLimit: { maxAttempts: 1, windowMs: 60_000 },
  });
  t.after(api.close);

  assert.equal((await createAttempt(api)).response.status, 201);
  assert.equal((await createAttempt(api)).response.status, 429);
  currentTime += 60_000;
  assert.equal((await createAttempt(api)).response.status, 201);
});

test("requires the bearer claim token and never exposes the stored email", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const { body } = await createAttempt(api);

  const unauthorized = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}`,
  );
  const authorized = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}`,
    { headers: { authorization: `Bearer ${body.claimToken}` } },
  );
  const status = await authorized.json();

  assert.equal(unauthorized.status, 401);
  assert.equal(authorized.status, 200);
  assert.deepEqual(status, { status: "created", nextAction: "complete_verification" });
  assert.equal(JSON.stringify(status).includes(schoolEmail), false);
});

test("rejects forged webhook signatures before calling DoJah", async (t) => {
  let resolverCalls = 0;
  const api = await startApi({
    dojahResolver: async () => {
      resolverCalls += 1;
      return {};
    },
  });
  t.after(api.close);

  const response = await fetch(`${api.origin}/v1/webhooks/dojah`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dojah-signature": "0".repeat(64),
    },
    body: JSON.stringify({ reference_id: "VR_unknown" }),
  });

  assert.equal(response.status, 401);
  assert.equal(resolverCalls, 0);
});

test("rejects a signed JSON-null webhook as a bad request", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const response = await sendWebhook(api, null);

  assert.equal(response.status, 400);
});

test("uses authoritative DoJah details before approval and exchanges once approved", async (t) => {
  let expectedReference;
  const api = await startApi({
    dojahResolver: async (referenceId) => {
      assert.equal(referenceId, expectedReference);
      return completedResult(referenceId);
    },
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  expectedReference = new URL(body.verificationUrl).searchParams.get("reference_id");

  const before = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    },
  );
  const webhook = await sendWebhook(api, { reference_id: expectedReference });
  const exchange = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    },
  );
  const exchangeBody = await exchange.json();

  assert.equal(before.status, 409);
  assert.equal(webhook.status, 204);
  assert.equal(exchange.status, 200);
  assert.equal(exchange.headers.get("cache-control"), "no-store");
  assert.match(exchangeBody.firebaseCustomToken, /^firebase-token-fv_/);
  assert.equal(api.firebaseCalls.length, 1);
  assert.equal(api.firebaseCalls[0].email, schoolEmail);
});

test("keeps completed verification pending until the DoJah contract is confirmed", async (t) => {
  let referenceId;
  const api = await startApi({
    verificationPolicy: {
      contractConfirmed: false,
      allowedDocumentTypes: ["Student ID"],
    },
    dojahResolver: async () => completedResult(referenceId),
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");

  await sendWebhook(api, { reference_id: referenceId });
  const status = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}`,
    { headers: { authorization: `Bearer ${body.claimToken}` } },
  );

  assert.deepEqual(await status.json(), {
    status: "pending_review",
    nextAction: "wait_for_review",
  });
  assert.equal(api.firebaseCalls.length, 0);
});

test("keeps each attempt on its original verification contract after a config flip", async (t) => {
  const store = createMemoryStore();
  const originalApi = await startApi({
    store,
    verificationPolicy: {
      contractConfirmed: false,
      allowedDocumentTypes: ["Student ID"],
    },
  });
  t.after(originalApi.close);
  const { body } = await createAttempt(originalApi);
  const referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  const changedApi = await startApi({
    store,
    verificationPolicy: {
      contractConfirmed: true,
      allowedDocumentTypes: ["Student ID"],
    },
    dojahResolver: async () => completedResult(referenceId),
  });
  t.after(changedApi.close);

  await sendWebhook(changedApi, { reference_id: referenceId });

  assert.equal((await store.getAttempt(body.attemptId)).status, "pending_review");
});

test("rejects exchange after the configured DoJah environment changes", async (t) => {
  let referenceId;
  const store = createMemoryStore();
  const sandboxApi = await startApi({
    store,
    providerEnvironment: "sandbox",
    dojahResolver: async () => completedResult(referenceId),
  });
  t.after(sandboxApi.close);
  const { body } = await createAttempt(sandboxApi);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  await sendWebhook(sandboxApi, { reference_id: referenceId });
  const productionApi = await startApi({
    store,
    providerEnvironment: "production",
  });
  t.after(productionApi.close);

  const exchange = await fetch(
    `${productionApi.origin}/v1/verification-attempts/${body.attemptId}/exchange`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    },
  );

  assert.equal(exchange.status, 409);
  assert.equal(productionApi.firebaseCalls.length, 0);
});

test("does not provision an account when provisioning is disabled", async (t) => {
  let referenceId;
  const api = await startApi({
    accountProvisioningEnabled: false,
    firebaseAuth: null,
    dojahResolver: async () => completedResult(referenceId),
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  await sendWebhook(api, { reference_id: referenceId });

  const exchange = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    },
  );

  assert.equal(exchange.status, 503);
  assert.equal(api.firebaseCalls.length, 0);
});

test("missing provider checks fail closed and cannot be exchanged", async (t) => {
  let referenceId;
  const api = await startApi({
    dojahResolver: async () =>
      completedResult(referenceId, {
        data: { email: { status: true, data: { email: schoolEmail } } },
      }),
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");

  await sendWebhook(api, { reference_id: referenceId });
  const exchange = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    },
  );

  assert.equal(exchange.status, 409);
  assert.equal(api.firebaseCalls.length, 0);
});

test("terminal webhooks short-circuit and account exchange is single use", async (t) => {
  let referenceId;
  let resolverCalls = 0;
  const api = await startApi({
    dojahResolver: async () => {
      resolverCalls += 1;
      return completedResult(referenceId);
    },
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  const webhookPayload = { reference_id: referenceId };

  await sendWebhook(api, webhookPayload);
  await sendWebhook(api, webhookPayload);
  const exchangeRequest = () =>
    fetch(`${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    });
  const firstExchange = await exchangeRequest();
  const secondExchange = await exchangeRequest();
  const stored = await api.store.getAttempt(body.attemptId);

  assert.equal(firstExchange.status, 200);
  assert.equal(secondExchange.status, 401);
  assert.equal(resolverCalls, 1);
  assert.equal(api.firebaseCalls.length, 1);
  assert.equal(stored.claimTokenHash, null);
});

test("concurrent exchange requests mint only one Firebase token", async (t) => {
  let referenceId;
  let firebaseCalls = 0;
  let releaseFirst;
  let signalFirst;
  const firstStarted = new Promise((resolve) => {
    signalFirst = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const api = await startApi({
    dojahResolver: async () => completedResult(referenceId),
    firebaseAuth: {
      async provisionAndMint({ uid }) {
        firebaseCalls += 1;
        if (firebaseCalls === 1) {
          signalFirst();
          await firstGate;
        }
        return `firebase-token-${uid}`;
      },
    },
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  await sendWebhook(api, { reference_id: referenceId });
  const exchange = () =>
    fetch(`${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    });

  const firstExchange = exchange();
  await firstStarted;
  const secondExchange = await exchange();
  releaseFirst();
  const firstResponse = await firstExchange;

  assert.equal(firstResponse.status, 200);
  assert.equal(secondExchange.status, 409);
  assert.equal(firebaseCalls, 1);
});

test("releases a failed provisioning reservation so exchange can retry", async (t) => {
  let referenceId;
  let firebaseCalls = 0;
  const api = await startApi({
    dojahResolver: async () => completedResult(referenceId),
    firebaseAuth: {
      async provisionAndMint({ uid }) {
        firebaseCalls += 1;
        if (firebaseCalls === 1) throw new Error("temporary Firebase failure");
        return `firebase-token-${uid}`;
      },
    },
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  await sendWebhook(api, { reference_id: referenceId });
  const exchange = () =>
    fetch(`${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    });

  const failed = await exchange();
  const afterFailure = await api.store.getAttempt(body.attemptId);
  const retried = await exchange();

  assert.equal(failed.status, 500);
  assert.equal(afterFailure.accountStatus, "not_created");
  assert.equal(typeof afterFailure.claimTokenHash, "string");
  assert.equal(retried.status, 200);
  assert.equal(firebaseCalls, 2);
});

test("releases the reservation when the account-ready update fails", async (t) => {
  let referenceId;
  let markCalls = 0;
  const backingStore = createMemoryStore();
  const store = {
    ...backingStore,
    async markAccountReady(id) {
      markCalls += 1;
      if (markCalls === 1) throw new Error("temporary store failure");
      return backingStore.markAccountReady(id);
    },
  };
  const api = await startApi({
    store,
    dojahResolver: async () => completedResult(referenceId),
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  await sendWebhook(api, { reference_id: referenceId });
  const exchange = () =>
    fetch(`${api.origin}/v1/verification-attempts/${body.attemptId}/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    });

  const failed = await exchange();
  const afterFailure = await store.getAttempt(body.attemptId);
  const retried = await exchange();

  assert.equal(failed.status, 500);
  assert.equal(afterFailure.accountStatus, "not_created");
  assert.equal(typeof afterFailure.claimTokenHash, "string");
  assert.equal(retried.status, 200);
  assert.equal(api.firebaseCalls.length, 2);
});

test("identical pending webhooks re-query DoJah and converge to approval", async (t) => {
  let referenceId;
  let resolverCalls = 0;
  const api = await startApi({
    dojahResolver: async () => {
      resolverCalls += 1;
      if (resolverCalls === 1) {
        return { reference_id: referenceId, verification_status: "Pending" };
      }
      return completedResult(referenceId);
    },
  });
  t.after(api.close);
  const { body } = await createAttempt(api);
  referenceId = new URL(body.verificationUrl).searchParams.get("reference_id");
  const payload = { reference_id: referenceId };

  await sendWebhook(api, payload);
  await sendWebhook(api, payload);
  const status = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}`,
    { headers: { authorization: `Bearer ${body.claimToken}` } },
  );

  assert.equal((await status.json()).status, "approved");
  assert.equal(resolverCalls, 2);
});

test("separate attempts for the same normalized email reuse one Firebase UID", async (t) => {
  const api = await startApi({
    dojahResolver: async (referenceId) => completedResult(referenceId),
  });
  t.after(api.close);
  const first = (await createAttempt(api)).body;
  const second = (
    await createAttempt(api, " Student.One@STUDENTS.UNILORIN.EDU.NG ")
  ).body;
  const firstReference = new URL(first.verificationUrl).searchParams.get("reference_id");
  const secondReference = new URL(second.verificationUrl).searchParams.get("reference_id");

  await sendWebhook(api, { reference_id: firstReference });
  await sendWebhook(api, { reference_id: secondReference });
  const exchange = (attempt) =>
    fetch(`${api.origin}/v1/verification-attempts/${attempt.attemptId}/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${attempt.claimToken}` },
    });
  const [firstExchange, secondExchange] = await Promise.all([
    exchange(first),
    exchange(second),
  ]);

  assert.equal(firstExchange.status, 200);
  assert.equal(secondExchange.status, 200);
  assert.equal(api.firebaseCalls.length, 2);
  assert.equal(api.firebaseCalls[0].uid, api.firebaseCalls[1].uid);
});

test("does not expose a client approval route", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const { body } = await createAttempt(api);

  const response = await fetch(
    `${api.origin}/v1/verification-attempts/${body.attemptId}/approve`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${body.claimToken}` },
    },
  );

  assert.equal(response.status, 404);
});

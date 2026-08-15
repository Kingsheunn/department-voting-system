import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApiHandler } from "../src/app.js";
import { createMemoryStore } from "../src/memory-store.js";

function pendingAttempt(id = "va_reviewable") {
  return {
    id,
    email: "student.one@students.unilorin.edu.ng",
    referenceId: `VR_${id}`,
    claimTokenHash: "unused",
    status: "pending_review",
    statusReason: "student_id_manual_review_required",
    accountStatus: "not_created",
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    expiresAt: "2099-08-13T10:00:00.000Z",
    deleteAfter: new Date("2099-08-13T10:00:00.000Z"),
    verificationPolicy: { providerEnvironment: "sandbox" },
  };
}

async function startApi(overrides = {}) {
  const store = createMemoryStore();
  const tokens = {
    reviewer1: { uid: "reviewer-one", verificationReviewer: true, verificationAdmin: false },
    reviewer2: { uid: "reviewer-two", verificationReviewer: true, verificationAdmin: false },
    admin: { uid: "admin-one", verificationReviewer: false, verificationAdmin: true },
    reviewer1AsAdmin: { uid: "reviewer-one", verificationReviewer: false, verificationAdmin: true },
    both: { uid: "unsafe-both", verificationReviewer: true, verificationAdmin: true },
    voter: { uid: "voter-one", verificationReviewer: false, verificationAdmin: false },
  };
  const handler = createApiHandler({
    store,
    dojahResolver: async () => { throw new Error("unused"); },
    firebaseAuth: {
      async verifyStaffToken(token) {
        const staff = tokens[token];
        if (!staff) throw new Error("invalid token");
        return staff;
      },
      async provisionAndMint() { throw new Error("unused"); },
    },
    publicDojahConfig: { widgetId: "public-widget" },
    webhookSecret: "review-test-secret",
    verificationPolicy: { contractConfirmed: true, allowedDocumentTypes: ["Student ID"] },
    accountProvisioningEnabled: false,
    manualReviewEnabled: true,
    providerEnvironment: "sandbox",
    evidenceService: overrides.evidenceService,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    store,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("authorized staff can choose sanitized dashboard metadata or proxied ID evidence", async (t) => {
  let evidenceCalls = 0;
  const api = await startApi({
    evidenceService: {
      async getReviewMetadata(reference) {
        evidenceCalls += 1;
        assert.equal(reference, "VR_va_reviewable");
        return {
          dashboardUrl: "https://app.dojah.io/easy-onboard/verifications/example",
          studentCardAvailable: true,
        };
      },
      async fetchStudentCard(reference) {
        evidenceCalls += 1;
        assert.equal(reference, "VR_va_reviewable");
        return { contentType: "image/jpeg", body: Buffer.from([1, 2, 3]) };
      },
    },
  });
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const headers = { authorization: "Bearer reviewer1" };

  const detail = await fetch(
    `${api.origin}/v1/admin/verification-reviews/va_reviewable`,
    { headers },
  );
  const detailBody = await detail.json();
  const image = await fetch(
    `${api.origin}/v1/admin/verification-reviews/va_reviewable/evidence/student-card`,
    { headers },
  );

  assert.equal(detail.status, 200);
  assert.deepEqual(detailBody, {
    attemptId: "va_reviewable",
    maskedEmail: "s***@students.unilorin.edu.ng",
    status: "pending_review",
    reviewStage: "awaiting_first_review",
    dashboardUrl: "https://app.dojah.io/easy-onboard/verifications/example",
    studentCardAvailable: true,
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("cache-control"), "no-store, private");
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from([1, 2, 3]));
  assert.equal(evidenceCalls, 2);
});

test("authorized staff can list only reviewable attempts without full emails", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt("va_reviewable"));
  await api.store.createAttempt({
    ...pendingAttempt("va_not_reviewable"),
    statusReason: "provider_pending",
  });

  const response = await fetch(`${api.origin}/v1/admin/verification-reviews`, {
    headers: { authorization: "Bearer reviewer1" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reviews: [
      {
        attemptId: "va_reviewable",
        maskedEmail: "s***@students.unilorin.edu.ng",
        status: "pending_review",
        reviewStage: "awaiting_first_review",
        createdAt: "2026-08-12T10:00:00.000Z",
      },
    ],
  });
});

test("expired attempts cannot be listed, viewed, or reviewed", async (t) => {
  let evidenceCalls = 0;
  const api = await startApi({
    evidenceService: {
      async getReviewMetadata() {
        evidenceCalls += 1;
        throw new Error("expired evidence must not be resolved");
      },
      async fetchStudentCard() {
        evidenceCalls += 1;
        throw new Error("expired evidence must not be resolved");
      },
    },
  });
  t.after(api.close);
  await api.store.createAttempt({
    ...pendingAttempt(),
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  const headers = { authorization: "Bearer reviewer1" };
  const path = "/v1/admin/verification-reviews/va_reviewable";

  const queue = await fetch(`${api.origin}/v1/admin/verification-reviews`, { headers });
  const detail = await fetch(`${api.origin}${path}`, { headers });
  const evidence = await fetch(`${api.origin}${path}/evidence/student-card`, { headers });
  const decision = await post(
    api,
    `${path}/decisions`,
    "reviewer1",
    "expired-review",
    "approve",
  );

  assert.deepEqual(await queue.json(), { reviews: [] });
  assert.equal(detail.status, 409);
  assert.equal(evidence.status, 409);
  assert.equal(decision.status, 409);
  assert.equal(evidenceCalls, 0);
  assert.equal((await api.store.getAttempt("va_reviewable")).reviewDecisions, undefined);
});

test("voters cannot access review metadata or ID evidence", async (t) => {
  const api = await startApi({
    evidenceService: {
      async getReviewMetadata() { throw new Error("must not call"); },
      async fetchStudentCard() { throw new Error("must not call"); },
    },
  });
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const headers = { authorization: "Bearer voter" };

  assert.equal((await fetch(`${api.origin}/v1/admin/verification-reviews/va_reviewable`, { headers })).status, 403);
  assert.equal((await fetch(`${api.origin}/v1/admin/verification-reviews/va_reviewable/evidence/student-card`, { headers })).status, 403);
});

function post(api, path, token, idempotencyKey, decision) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return fetch(`${api.origin}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision }),
  });
}

test("requires a reviewer-only role and an idempotency key", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const path = "/v1/admin/verification-reviews/va_reviewable/decisions";

  assert.equal((await post(api, path, "voter", "key-1", "approve")).status, 403);
  assert.equal((await post(api, path, "admin", "key-2", "approve")).status, 403);
  assert.equal((await post(api, path, "both", "key-3", "approve")).status, 403);
  assert.equal((await post(api, path, "reviewer1", null, "approve")).status, 400);
});

test("cannot review a generic provider-pending attempt", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt({
    ...pendingAttempt(),
    statusReason: "provider_pending",
  });

  const response = await post(
    api,
    "/v1/admin/verification-reviews/va_reviewable/decisions",
    "reviewer1",
    "not-reviewable",
    "approve",
  );

  assert.equal(response.status, 409);
  assert.equal((await api.store.getAttempt("va_reviewable")).statusReason, "provider_pending");
});

test("two distinct matching reviewer decisions approve the attempt", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const path = "/v1/admin/verification-reviews/va_reviewable/decisions";

  const first = await post(api, path, "reviewer1", "first-approval", "approve");
  const firstBody = await first.json();
  const second = await post(api, path, "reviewer2", "second-approval", "approve");
  const secondBody = await second.json();

  assert.equal(first.status, 200);
  assert.deepEqual(firstBody, { status: "pending_review", reviewStage: "awaiting_second_review" });
  assert.equal(second.status, 200);
  assert.deepEqual(secondBody, { status: "approved", reviewStage: "resolved" });
});

test("two distinct matching reviewer decisions reject the attempt", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const path = "/v1/admin/verification-reviews/va_reviewable/decisions";

  await post(api, path, "reviewer1", "first-rejection", "reject");
  const second = await post(api, path, "reviewer2", "second-rejection", "reject");

  assert.deepEqual(await second.json(), { status: "rejected", reviewStage: "resolved" });
});

test("the same reviewer cannot cast the second decision", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const path = "/v1/admin/verification-reviews/va_reviewable/decisions";
  await post(api, path, "reviewer1", "first", "reject");

  const repeated = await post(api, path, "reviewer1", "second", "reject");

  assert.equal(repeated.status, 409);
  assert.equal((await api.store.getAttempt("va_reviewable")).status, "pending_review");
});

test("opposing decisions escalate and only an admin can resolve", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const decisions = "/v1/admin/verification-reviews/va_reviewable/decisions";
  const resolution = "/v1/admin/verification-reviews/va_reviewable/resolution";
  await post(api, decisions, "reviewer1", "first", "approve");
  const second = await post(api, decisions, "reviewer2", "second", "reject");

  assert.deepEqual(await second.json(), { status: "pending_review", reviewStage: "escalated_review" });
  const queue = await fetch(`${api.origin}/v1/admin/verification-reviews`, {
    headers: { authorization: "Bearer admin" },
  });
  assert.equal((await queue.json()).reviews[0].reviewStage, "escalated_review");
  assert.equal((await post(api, resolution, "reviewer1", "reviewer-resolution", "approve")).status, 403);
  const resolved = await post(api, resolution, "admin", "admin-resolution", "reject");
  assert.deepEqual(await resolved.json(), { status: "rejected", reviewStage: "resolved" });
});

test("admin resolution is rejected before reviewer disagreement", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());

  const response = await post(
    api,
    "/v1/admin/verification-reviews/va_reviewable/resolution",
    "admin",
    "early-resolution",
    "approve",
  );

  assert.equal(response.status, 409);
});

test("the escalation administrator must be distinct from both reviewers", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const decisions = "/v1/admin/verification-reviews/va_reviewable/decisions";
  const resolution = "/v1/admin/verification-reviews/va_reviewable/resolution";
  await post(api, decisions, "reviewer1", "first", "approve");
  await post(api, decisions, "reviewer2", "second", "reject");

  const response = await post(
    api,
    resolution,
    "reviewer1AsAdmin",
    "same-person-resolution",
    "approve",
  );

  assert.equal(response.status, 409);
  assert.equal((await api.store.getAttempt("va_reviewable")).status, "pending_review");
});

test("idempotency replays the same request and rejects changed payload", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  const path = "/v1/admin/verification-reviews/va_reviewable/decisions";

  const first = await post(api, path, "reviewer1", "stable-key", "approve");
  const replay = await post(api, path, "reviewer1", "stable-key", "approve");
  const conflict = await post(api, path, "reviewer1", "stable-key", "reject");

  assert.deepEqual(await replay.json(), await first.json());
  assert.equal(conflict.status, 409);
  assert.equal((await api.store.getAttempt("va_reviewable")).reviewDecisions.length, 1);
});

test("late provider results cannot overwrite human-review-owned state", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await api.store.createAttempt(pendingAttempt());
  await post(
    api,
    "/v1/admin/verification-reviews/va_reviewable/decisions",
    "reviewer1",
    "first",
    "approve",
  );

  await api.store.applyProviderResult("va_reviewable", "rejected", "provider_failed_late");

  const stored = await api.store.getAttempt("va_reviewable");
  assert.equal(stored.status, "pending_review");
  assert.equal(stored.reviewStage, "awaiting_second_review");
  assert.equal(stored.statusReason, "student_id_manual_review_required");
});

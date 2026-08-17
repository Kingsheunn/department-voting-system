import assert from "node:assert/strict";
import test from "node:test";

import { createFirestoreStore } from "../src/firestore-store.js";

function createFakeFirestore() {
  const records = new Map();
  const queries = [];
  const snapshot = (path) => ({
    exists: records.has(path),
    data: () => structuredClone(records.get(path)),
  });
  const document = (path) => ({
    path,
    async set(value) {
      records.set(path, structuredClone(value));
    },
    async get() {
      return snapshot(path);
    },
  });

  const query = (name, filters = [], ordering = null, maximum = Infinity) => ({
    where(field, operator, value) {
      return query(name, [...filters, { field, operator, value }], ordering, maximum);
    },
    orderBy(field, direction) {
      return query(name, filters, { field, direction }, maximum);
    },
    limit(value) {
      return query(name, filters, ordering, value);
    },
    async get() {
      queries.push({ name, filters, ordering, maximum });
      let values = [...records.entries()]
        .filter(([path]) => path.startsWith(`${name}/`))
        .map(([path, value]) => ({ path, value }));
      for (const filter of filters) {
        values = values.filter(({ value }) => {
          if (filter.operator === "==") return value[filter.field] === filter.value;
          if (filter.operator === ">") return value[filter.field] > filter.value;
          throw new Error(`unsupported operator ${filter.operator}`);
        });
      }
      if (ordering) {
        values.sort((left, right) => {
          const result = left.value[ordering.field].localeCompare(right.value[ordering.field]);
          return ordering.direction === "desc" ? -result : result;
        });
      }
      return {
        docs: values.slice(0, maximum).map(({ path, value }) => ({
          id: path.slice(path.indexOf("/") + 1),
          data: () => structuredClone(value),
        })),
      };
    },
  });

  return {
    records,
    queries,
    collection(name) {
      return {
        doc: (id) => document(`${name}/${id}`),
        ...query(name),
      };
    },
    async runTransaction(operation) {
      return operation({
        get: async (ref) => snapshot(ref.path),
        create(ref, value) {
          if (records.has(ref.path)) throw new Error("already exists");
          records.set(ref.path, structuredClone(value));
        },
        update(ref, patch) {
          records.set(ref.path, { ...records.get(ref.path), ...structuredClone(patch) });
        },
      });
    },
  };
}

test("Firestore adapter preserves terminal status and stable Firebase UID", async () => {
  const firestore = createFakeFirestore();
  const store = createFirestoreStore(firestore);
  const deleteAfter = new Date("2026-08-11T12:00:00.000Z");
  await store.createAttempt({
    id: "va_attempt",
    email: "student.one@students.unilorin.edu.ng",
    referenceId: "VR_reference-value",
    claimTokenHash: "hashed-only",
    status: "created",
    statusReason: "attempt_created",
    accountStatus: "not_created",
    deleteAfter,
  });

  await store.applyProviderResult("va_attempt", "approved", "checks_passed");
  await store.applyProviderResult("va_attempt", "in_progress", "ongoing");
  const firstUid = await store.reserveFirebaseUid("va_attempt", "fv_first");
  const secondUid = await store.reserveFirebaseUid("va_attempt", "fv_second");
  await store.releaseAccountProvisioning("va_attempt");
  const retryUid = await store.reserveFirebaseUid("va_attempt", "fv_retry");
  await store.createAttempt({
    id: "va_second_attempt",
    email: "student.one@students.unilorin.edu.ng",
    referenceId: "VR_second-reference",
    claimTokenHash: "another-hash",
    status: "approved",
    accountStatus: "not_created",
    deleteAfter,
  });
  const duplicateEmailUid = await store.reserveFirebaseUid(
    "va_second_attempt",
    "fv_different",
  );
  await store.markAccountReady("va_attempt");
  const stored = await store.getAttempt("va_attempt");
  const reference = firestore.records.get(
    "verificationReferences/VR_reference-value",
  );

  assert.equal(stored.status, "approved");
  assert.equal(stored.statusReason, "checks_passed");
  assert.equal(firstUid, "fv_first");
  assert.equal(secondUid, null);
  assert.equal(retryUid, "fv_first");
  assert.equal(duplicateEmailUid, "fv_first");
  assert.equal(stored.claimToken, undefined);
  assert.equal(stored.claimTokenHash, null);
  assert.equal(reference.deleteAfter instanceof Date, true);
  assert.equal(reference.deleteAfter.getTime(), deleteAfter.getTime());
});

test("Firestore adapter atomically records two-person review state and non-PII audits", async () => {
  const firestore = createFakeFirestore();
  const store = createFirestoreStore(firestore);
  await store.createAttempt({
    id: "va_reviewable",
    email: "student.one@students.unilorin.edu.ng",
    referenceId: "VR_reviewable-reference",
    claimTokenHash: "hashed-only",
    status: "pending_review",
    statusReason: "student_id_manual_review_required",
    accountStatus: "not_created",
    createdAt: "2026-08-12T10:00:00.000Z",
    expiresAt: "2099-08-13T10:00:00.000Z",
    deleteAfter: new Date("2026-08-13T12:00:00.000Z"),
  });

  const first = await store.recordReviewerDecision({
    id: "va_reviewable",
    actorUid: "reviewer-one",
    decision: "approve",
    idempotencyKey: "first-key",
  });
  const second = await store.recordReviewerDecision({
    id: "va_reviewable",
    actorUid: "reviewer-two",
    decision: "approve",
    idempotencyKey: "second-key",
  });

  assert.deepEqual(first, {
    status: "pending_review",
    reviewStage: "awaiting_second_review",
  });
  assert.deepEqual(second, { status: "approved", reviewStage: "resolved" });
  const auditJson = JSON.stringify(
    [...firestore.records.entries()].filter(([path]) =>
      path.startsWith("verificationReviewAudits/"),
    ),
  );
  assert.equal(auditJson.includes("student.one@"), false);
  assert.equal(auditJson.includes("reviewer-one"), false);
  assert.equal(auditJson.includes("first-key"), false);
  assert.equal(auditJson.includes("http"), false);
  const audits = [...firestore.records.entries()]
    .filter(([path]) => path.startsWith("verificationReviewAudits/"))
    .map(([, value]) => value);
  assert.equal(audits.length, 2);
  for (const audit of audits) {
    assert.equal(audit.deleteAfter instanceof Date, true);
    assert.equal(
      audit.deleteAfter.getTime() - Date.parse(audit.createdAt),
      365 * 24 * 60 * 60 * 1000,
    );
  }
});

test("Firestore adapter preserves review-owned state from a late provider update", async () => {
  const firestore = createFakeFirestore();
  const store = createFirestoreStore(firestore);
  await store.createAttempt({
    id: "va_reviewable",
    email: "student.one@students.unilorin.edu.ng",
    referenceId: "VR_reviewable-reference",
    claimTokenHash: "hashed-only",
    status: "pending_review",
    statusReason: "student_id_manual_review_required",
    accountStatus: "not_created",
    createdAt: "2026-08-12T10:00:00.000Z",
    expiresAt: "2099-08-13T10:00:00.000Z",
    deleteAfter: new Date("2026-08-13T12:00:00.000Z"),
  });
  await store.recordReviewerDecision({
    id: "va_reviewable",
    actorUid: "reviewer-one",
    decision: "reject",
    idempotencyKey: "first-key",
  });

  await store.applyProviderResult("va_reviewable", "approved", "late_provider_approval");

  const stored = await store.getAttempt("va_reviewable");
  assert.equal(stored.status, "pending_review");
  assert.equal(stored.reviewStage, "awaiting_second_review");
  assert.equal(stored.statusReason, "student_id_manual_review_required");
});

test("Firestore filters reviewable unexpired attempts before applying the queue limit", async () => {
  const firestore = createFakeFirestore();
  const store = createFirestoreStore(firestore, {
    now: () => new Date("2026-08-15T12:00:00.000Z"),
  });
  for (let index = 0; index < 101; index += 1) {
    await store.createAttempt({
      id: `va_generic_${index}`,
      email: `student.${index}@students.unilorin.edu.ng`,
      referenceId: `VR_generic_${index}`,
      status: "pending_review",
      statusReason: "provider_pending",
      accountStatus: "not_created",
      createdAt: `2026-08-12T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
      expiresAt: "2099-08-13T10:00:00.000Z",
      deleteAfter: new Date("2099-08-13T12:00:00.000Z"),
    });
  }
  await store.createAttempt({
    id: "va_reviewable_after_generic",
    email: "reviewable@students.unilorin.edu.ng",
    referenceId: "VR_reviewable_after_generic",
    status: "pending_review",
    statusReason: "student_id_manual_review_required",
    accountStatus: "not_created",
    createdAt: "2026-08-12T12:00:00.000Z",
    expiresAt: "2099-08-13T10:00:00.000Z",
    deleteAfter: new Date("2099-08-13T12:00:00.000Z"),
  });
  await store.createAttempt({
    id: "va_expired_reviewable",
    email: "expired@students.unilorin.edu.ng",
    referenceId: "VR_expired_reviewable",
    status: "pending_review",
    statusReason: "student_id_manual_review_required",
    accountStatus: "not_created",
    createdAt: "2026-08-12T09:00:00.000Z",
    expiresAt: "2026-08-14T10:00:00.000Z",
    deleteAfter: new Date("2026-08-16T12:00:00.000Z"),
  });

  const reviews = await store.listReviewableAttempts(20);

  assert.deepEqual(reviews.map((attempt) => attempt.id), ["va_reviewable_after_generic"]);
  assert.deepEqual(firestore.queries.at(-1), {
    name: "verificationAttempts",
    filters: [
      { field: "reviewQueue", operator: "==", value: true },
      { field: "expiresAt", operator: ">", value: "2026-08-15T12:00:00.000Z" },
    ],
    ordering: { field: "expiresAt", direction: "asc" },
    maximum: 20,
  });
});

test("Firestore atomically revisions election configuration with a sanitized audit", async () => {
  const firestore = createFakeFirestore();
  const store = createFirestoreStore(firestore, {
    now: () => new Date("2026-08-16T10:00:00.000Z"),
  });
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
  };

  const saved = await store.saveElectionConfiguration({
    configuration,
    expectedRevision: 0,
    actorUid: "admin-sensitive-uid",
  });

  assert.equal(saved.revision, 1);
  assert.deepEqual(await store.getElectionConfiguration(), saved);
  const stored = firestore.records.get("electionMetadata/current");
  assert.equal(stored.updatedByFingerprint.length, 64);
  assert.equal(JSON.stringify(stored).includes("admin-sensitive-uid"), false);
  const audit = firestore.records.get("electionConfigurationAudits/revision-1");
  assert.equal(audit.actorFingerprint.length, 64);
  assert.equal(audit.revision, 1);
  assert.equal(audit.deleteAfter instanceof Date, true);
  assert.equal(
    audit.deleteAfter.getTime() - Date.parse(audit.createdAt),
    365 * 24 * 60 * 60 * 1000,
  );
  assert.equal(JSON.stringify(audit).includes("admin-sensitive-uid"), false);

  await assert.rejects(
    store.saveElectionConfiguration({
      configuration: { ...configuration, title: "Stale" },
      expectedRevision: 0,
      actorUid: "another-admin",
    }),
    (error) => error.code === "REVISION_CONFLICT",
  );
});

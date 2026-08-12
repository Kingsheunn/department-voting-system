import assert from "node:assert/strict";
import test from "node:test";

import { createFirestoreStore } from "../src/firestore-store.js";

function createFakeFirestore() {
  const records = new Map();
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

  return {
    records,
    collection(name) {
      return { doc: (id) => document(`${name}/${id}`) };
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

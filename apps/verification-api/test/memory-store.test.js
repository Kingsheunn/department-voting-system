import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryStore } from "../src/memory-store.js";

const email = "student.one@students.unilorin.edu.ng";

function attempt(id, referenceId) {
  return {
    id,
    email,
    referenceId,
    claimTokenHash: "hashed-only",
    status: "created",
    statusReason: "attempt_created",
    accountStatus: "not_created",
  };
}

test("memory adapter preserves a terminal status reason", async () => {
  const store = createMemoryStore();
  await store.createAttempt(attempt("va_first", "VR_first-reference"));

  await store.applyProviderResult("va_first", "approved", "checks_passed");
  await store.applyProviderResult("va_first", "in_progress", "provider_ongoing");

  const stored = await store.getAttempt("va_first");
  assert.equal(stored.status, "approved");
  assert.equal(stored.statusReason, "checks_passed");
});

test("memory adapter reserves one Firebase UID per normalized email", async () => {
  const store = createMemoryStore();
  await store.createAttempt(attempt("va_first", "VR_first-reference"));
  await store.createAttempt(attempt("va_second", "VR_second-reference"));

  const firstUid = await store.reserveFirebaseUid("va_first", "fv_first");
  const secondUid = await store.reserveFirebaseUid("va_second", "fv_second");

  assert.equal(firstUid, "fv_first");
  assert.equal(secondUid, "fv_first");
});

test("memory adapter clears the claim hash when the account is ready", async () => {
  const store = createMemoryStore();
  await store.createAttempt(attempt("va_first", "VR_first-reference"));

  await store.reserveFirebaseUid("va_first", "fv_first");
  await store.markAccountReady("va_first");

  assert.equal((await store.getAttempt("va_first")).claimTokenHash, null);
});

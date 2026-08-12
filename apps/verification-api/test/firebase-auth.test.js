import assert from "node:assert/strict";
import test from "node:test";

import { createFirebaseAuthAdapter } from "../src/firebase-auth.js";

test("creates a verified Firebase user before minting a custom token", async () => {
  const calls = [];
  const auth = {
    async getUser() {
      const error = new Error("not found");
      error.code = "auth/user-not-found";
      throw error;
    },
    async createUser(input) {
      calls.push(["createUser", input]);
      return input;
    },
    async createCustomToken(uid, claims) {
      calls.push(["createCustomToken", uid, claims]);
      return `custom-token-for-${uid}`;
    },
  };

  const adapter = createFirebaseAuthAdapter(auth);
  const token = await adapter.provisionAndMint({
    uid: "fv_stable-user",
    email: "student.one@students.unilorin.edu.ng",
  });

  assert.equal(token, "custom-token-for-fv_stable-user");
  assert.deepEqual(calls[0], [
    "createUser",
    {
      uid: "fv_stable-user",
      email: "student.one@students.unilorin.edu.ng",
      emailVerified: true,
      disabled: false,
    },
  ]);
  assert.deepEqual(calls[1], [
    "createCustomToken",
    "fv_stable-user",
    { identityVerified: true },
  ]);
});

test("rejects an existing Firebase UID bound to another email", async () => {
  const adapter = createFirebaseAuthAdapter({
    async getUser() {
      return { email: "other@students.unilorin.edu.ng", emailVerified: true };
    },
    async createCustomToken() {
      throw new Error("must not mint");
    },
  });

  await assert.rejects(
    adapter.provisionAndMint({
      uid: "fv_stable-user",
      email: "student.one@students.unilorin.edu.ng",
    }),
    /identity conflict/i,
  );
});

test("recovers from concurrent Firebase creation with the same stable UID", async () => {
  let lookups = 0;
  const auth = {
    async getUser() {
      lookups += 1;
      if (lookups === 1) {
        const error = new Error("not found");
        error.code = "auth/user-not-found";
        throw error;
      }
      return {
        email: "student.one@students.unilorin.edu.ng",
        emailVerified: true,
      };
    },
    async createUser() {
      const error = new Error("already created concurrently");
      error.code = "auth/uid-already-exists";
      throw error;
    },
    async createCustomToken(uid) {
      return `custom-token-for-${uid}`;
    },
  };
  const adapter = createFirebaseAuthAdapter(auth);

  const token = await adapter.provisionAndMint({
    uid: "fv_stable-user",
    email: "student.one@students.unilorin.edu.ng",
  });

  assert.equal(token, "custom-token-for-fv_stable-user");
  assert.equal(lookups, 2);
});

test("recovers an email collision only when it belongs to the reserved UID", async () => {
  const auth = {
    async getUser() {
      const error = new Error("not found");
      error.code = "auth/user-not-found";
      throw error;
    },
    async createUser() {
      const error = new Error("email already exists");
      error.code = "auth/email-already-exists";
      throw error;
    },
    async getUserByEmail() {
      return {
        uid: "fv_stable-user",
        email: "student.one@students.unilorin.edu.ng",
        emailVerified: true,
      };
    },
    async createCustomToken(uid) {
      return `custom-token-for-${uid}`;
    },
  };
  const adapter = createFirebaseAuthAdapter(auth);

  assert.equal(
    await adapter.provisionAndMint({
      uid: "fv_stable-user",
      email: "student.one@students.unilorin.edu.ng",
    }),
    "custom-token-for-fv_stable-user",
  );
});

test("rejects an email collision owned by another Firebase UID", async () => {
  const auth = {
    async getUser() {
      const error = new Error("not found");
      error.code = "auth/user-not-found";
      throw error;
    },
    async createUser() {
      const error = new Error("email already exists");
      error.code = "auth/email-already-exists";
      throw error;
    },
    async getUserByEmail() {
      return {
        uid: "fv_other-user",
        email: "student.one@students.unilorin.edu.ng",
        emailVerified: true,
      };
    },
    async createCustomToken() {
      throw new Error("must not mint");
    },
  };

  await assert.rejects(
    createFirebaseAuthAdapter(auth).provisionAndMint({
      uid: "fv_stable-user",
      email: "student.one@students.unilorin.edu.ng",
    }),
    /identity conflict/i,
  );
});

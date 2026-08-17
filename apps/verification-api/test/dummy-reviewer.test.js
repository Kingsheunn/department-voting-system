import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  readDummyReviewerConfig,
  seedDummyAdmin,
  seedDummyReviewer,
} from "../scripts/dummy-reviewer.js";

const validPassword = randomBytes(18).toString("base64url");
const validEnvironment = {
  NODE_ENV: "development",
  FIREBASE_PROJECT_ID: "demo-department-voting",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  DUMMY_REVIEWER_PASSWORD: validPassword,
};

test("requires the exact development environment", () => {
  for (const nodeEnvironment of [undefined, "test", "Development", "production"]) {
    assert.throws(
      () =>
        readDummyReviewerConfig({
          ...validEnvironment,
          NODE_ENV: nodeEnvironment,
        }),
      /development/i,
    );
  }
});

test("rejects non-demo projects and non-loopback Auth hosts", () => {
  assert.throws(
    () =>
      readDummyReviewerConfig({
        ...validEnvironment,
        FIREBASE_PROJECT_ID: "voting-app-6e1fb",
      }),
    /demo-department-voting/i,
  );
  assert.throws(
    () =>
      readDummyReviewerConfig({
        ...validEnvironment,
        FIREBASE_AUTH_EMULATOR_HOST: "firebase.example:9099",
      }),
    /loopback/i,
  );
});

test("requires a runtime-only dummy reviewer password", () => {
  assert.throws(
    () => readDummyReviewerConfig({ ...validEnvironment, DUMMY_REVIEWER_PASSWORD: "" }),
    /password/i,
  );
  assert.throws(
    () =>
      readDummyReviewerConfig({
        ...validEnvironment,
        DUMMY_REVIEWER_PASSWORD: "too-short",
      }),
    /12 characters/i,
  );
});

test("creates one fixed reviewer-only emulator identity", async () => {
  const calls = [];
  const auth = {
    async getUser() {
      const error = new Error("not found");
      error.code = "auth/user-not-found";
      throw error;
    },
    async createUser(input) {
      calls.push(["createUser", input]);
    },
    async updateUser() {
      throw new Error("must not update a missing user");
    },
    async setCustomUserClaims(uid, claims) {
      calls.push(["setCustomUserClaims", uid, claims]);
    },
  };

  const result = await seedDummyReviewer(auth, readDummyReviewerConfig(validEnvironment));

  assert.deepEqual(calls, [
    [
      "createUser",
      {
        uid: "local-dummy-reviewer",
        email: "dummy.reviewer@local.test",
        password: validPassword,
        emailVerified: true,
        disabled: false,
      },
    ],
    [
      "setCustomUserClaims",
      "local-dummy-reviewer",
      {
        verificationReviewer: true,
        verificationAdmin: false,
        developmentFixture: true,
      },
    ],
  ]);
  assert.deepEqual(result, {
    uid: "local-dummy-reviewer",
    email: "dummy.reviewer@local.test",
  });
  assert.equal(JSON.stringify(result).includes(validPassword), false);
});

test("re-seeding updates the fixed emulator identity", async () => {
  const calls = [];
  const auth = {
    async getUser(uid) {
      calls.push(["getUser", uid]);
      return { uid };
    },
    async createUser() {
      throw new Error("must not create an existing user");
    },
    async updateUser(uid, input) {
      calls.push(["updateUser", uid, input]);
    },
    async setCustomUserClaims(uid, claims) {
      calls.push(["setCustomUserClaims", uid, claims]);
    },
  };

  await seedDummyReviewer(auth, readDummyReviewerConfig(validEnvironment));

  assert.deepEqual(calls[1], [
    "updateUser",
    "local-dummy-reviewer",
    {
      email: "dummy.reviewer@local.test",
      password: validPassword,
      emailVerified: true,
      disabled: false,
    },
  ]);
  assert.deepEqual(calls[2], [
    "setCustomUserClaims",
    "local-dummy-reviewer",
    {
      verificationReviewer: true,
      verificationAdmin: false,
      developmentFixture: true,
    },
  ]);
});

test("creates a separate administrator-only emulator identity", async () => {
  const calls = [];
  const auth = {
    async getUser() {
      const error = new Error("not found");
      error.code = "auth/user-not-found";
      throw error;
    },
    async createUser(input) {
      calls.push(["createUser", input]);
    },
    async updateUser() {
      throw new Error("must not update a missing user");
    },
    async setCustomUserClaims(uid, claims) {
      calls.push(["setCustomUserClaims", uid, claims]);
    },
  };

  const result = await seedDummyAdmin(auth, readDummyReviewerConfig(validEnvironment));

  assert.deepEqual(calls, [
    [
      "createUser",
      {
        uid: "local-dummy-admin",
        email: "dummy.admin@local.test",
        password: validPassword,
        emailVerified: true,
        disabled: false,
      },
    ],
    [
      "setCustomUserClaims",
      "local-dummy-admin",
      {
        verificationReviewer: false,
        verificationAdmin: true,
        developmentFixture: true,
      },
    ],
  ]);
  assert.deepEqual(result, {
    uid: "local-dummy-admin",
    email: "dummy.admin@local.test",
  });
  assert.equal(JSON.stringify(result).includes(validPassword), false);
});

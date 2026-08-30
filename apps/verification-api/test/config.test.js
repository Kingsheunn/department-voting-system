import assert from "node:assert/strict";
import test from "node:test";

import { readRuntimeConfig } from "../src/config.js";

const validEnvironment = {
  DOJAH_APP_ID: "public-app-id",
  DOJAH_BASE_URL: "https://sandbox.dojah.io",
  DOJAH_PRIVATE_KEY: "test-only-private-key",
  NEXT_PUBLIC_DOJAH_WIDGET_ID: "public-widget-id",
  STORE_DRIVER: "memory",
  PORT: "8080",
};

test("reads explicit runtime configuration without exposing secret values", () => {
  const config = readRuntimeConfig(validEnvironment);

  assert.equal(config.port, 8080);
  assert.equal(config.storeDriver, "memory");
  assert.equal(config.dojah.widgetId, "public-widget-id");
  assert.equal(config.dojah.environment, "sandbox");
  assert.equal(config.dojah.privateKey, "test-only-private-key");
  assert.equal(config.dojah.contractConfirmed, false);
  assert.deepEqual(config.dojah.allowedDocumentTypes, []);
  assert.equal(config.accountProvisioningEnabled, false);
  assert.equal(config.firebase.required, false);
  assert.deepEqual(config.allowedOrigins, []);
  assert.equal(config.retentionCleanupEnabled, false);
});

test("enables retention cleanup only with independent secrets and a matching service account", () => {
  const production = {
    ...validEnvironment,
    NODE_ENV: "production",
    STORE_DRIVER: "firestore",
    FIREBASE_PROJECT_ID: "voting-app-6e1fb",
    HOSTED_SANDBOX_FIREBASE_PROJECT_ID: "voting-app-6e1fb",
    PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
    EDGE_SHARED_SECRET: "e".repeat(32),
    WEB_ALLOWED_ORIGINS: "https://voting-app-6e1fb.web.app",
    RETENTION_CLEANUP_ENABLED: "true",
    RETENTION_CLEANUP_SECRET: "r".repeat(32),
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: "service_account",
      project_id: "voting-app-6e1fb",
      client_email: "retention@voting-app-6e1fb.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----\n",
    }),
  };

  const config = readRuntimeConfig(production);
  assert.equal(config.retentionCleanupEnabled, true);
  assert.equal(config.retentionCleanupSecret, "r".repeat(32));
  assert.equal(config.firebase.serviceAccount.project_id, "voting-app-6e1fb");

  for (const overrides of [
    { RETENTION_CLEANUP_SECRET: "" },
    { RETENTION_CLEANUP_SECRET: "short" },
    { RETENTION_CLEANUP_SECRET: "e".repeat(32) },
    { FIREBASE_SERVICE_ACCOUNT_JSON: "" },
    {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account",
        project_id: "wrong-project",
        client_email: "retention@wrong-project.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----\n",
      }),
    },
    {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account",
        project_id: "voting-app-6e1fb",
        client_email: "retention@another-project.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----\n",
      }),
    },
  ]) {
    assert.throws(() => readRuntimeConfig({ ...production, ...overrides }), /retention|service account/i);
  }
});

test("accepts exact HTTPS portal origins", () => {
  const config = readRuntimeConfig({
    ...validEnvironment,
    WEB_ALLOWED_ORIGINS:
      "https://department-voting.web.app,https://department-voting-review.web.app",
  });

  assert.deepEqual(config.allowedOrigins, [
    "https://department-voting.web.app",
    "https://department-voting-review.web.app",
  ]);
});

test("rejects malformed or insecure portal origins", () => {
  for (const value of [
    "http://department-voting.web.app",
    "https://department-voting.web.app/path",
    "https://user@department-voting.web.app",
    "null",
  ]) {
    assert.throws(
      () => readRuntimeConfig({ ...validEnvironment, WEB_ALLOWED_ORIGINS: value }),
      /allowed origins/i,
    );
  }
});

test("reads an explicitly confirmed DoJah verification contract", () => {
  const config = readRuntimeConfig({
    ...validEnvironment,
    DOJAH_VERIFICATION_CONTRACT_CONFIRMED: "true",
    DOJAH_ALLOWED_DOCUMENT_TYPES: "Student ID,National ID",
  });

  assert.equal(config.dojah.contractConfirmed, true);
  assert.deepEqual(config.dojah.allowedDocumentTypes, ["Student ID", "National ID"]);
});

test("allows sandbox provisioning only through the Firebase Auth Emulator", () => {
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        ACCOUNT_PROVISIONING_ENABLED: "true",
        FIREBASE_PROJECT_ID: "demo-voting",
      }),
    /firebase_auth_emulator_host|auth emulator/i,
  );

  const config = readRuntimeConfig({
    ...validEnvironment,
    ACCOUNT_PROVISIONING_ENABLED: "true",
    FIREBASE_PROJECT_ID: "demo-voting",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  });
  assert.equal(config.accountProvisioningEnabled, true);
  assert.equal(config.firebase.required, true);
  assert.equal(config.firebase.projectId, "demo-voting");
});

test("enables manual review independently but only with Firebase Auth and Firestore", () => {
  assert.throws(
    () => readRuntimeConfig({ ...validEnvironment, MANUAL_REVIEW_ENABLED: "true" }),
    /firestore/i,
  );
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        STORE_DRIVER: "firestore",
        MANUAL_REVIEW_ENABLED: "true",
        FIREBASE_PROJECT_ID: "demo-voting",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    /auth emulator/i,
  );
  const config = readRuntimeConfig({
    ...validEnvironment,
    STORE_DRIVER: "firestore",
    MANUAL_REVIEW_ENABLED: "true",
    FIREBASE_PROJECT_ID: "demo-voting",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  });
  assert.equal(config.manualReviewEnabled, true);
  assert.equal(config.firebase.required, true);
});

test("enables election configuration only with Firebase Auth and Firestore", () => {
  assert.throws(
    () => readRuntimeConfig({ ...validEnvironment, ELECTION_CONFIGURATION_ENABLED: "true" }),
    /firestore/i,
  );
  const config = readRuntimeConfig({
    ...validEnvironment,
    STORE_DRIVER: "firestore",
    ELECTION_CONFIGURATION_ENABLED: "true",
    FIREBASE_PROJECT_ID: "demo-voting",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  });
  assert.equal(config.electionConfigurationEnabled, true);
  assert.equal(config.firebase.required, true);
});

test("allows sandbox Firestore only through matching local emulators", () => {
  const sandboxFirestore = {
    ...validEnvironment,
    STORE_DRIVER: "firestore",
    ACCOUNT_PROVISIONING_ENABLED: "true",
    FIREBASE_PROJECT_ID: "demo-department-voting",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  };

  assert.throws(() => readRuntimeConfig(sandboxFirestore), /firestore emulator/i);

  const config = readRuntimeConfig({
    ...sandboxFirestore,
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  });
  assert.equal(config.firebase.projectId, "demo-department-voting");
  assert.equal(config.firebase.firestoreEmulatorHost, "127.0.0.1:8080");
  assert.throws(
    () =>
      readRuntimeConfig({
        ...sandboxFirestore,
        FIREBASE_PROJECT_ID: "real-project-name",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    /demo project/i,
  );
});

test("rejects unsafe emulator hosts and emulator configuration in production", () => {
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        ACCOUNT_PROVISIONING_ENABLED: "true",
        FIREBASE_PROJECT_ID: "demo-voting",
        FIREBASE_AUTH_EMULATOR_HOST: "attacker.test:9099",
      }),
    /firebase_auth_emulator_host|auth emulator/i,
  );
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        STORE_DRIVER: "firestore",
        DOJAH_BASE_URL: "https://api.dojah.io",
        FIREBASE_PROJECT_ID: "department-voting",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
        EDGE_SHARED_SECRET: "e".repeat(32),
        WEB_ALLOWED_ORIGINS: "https://department-voting.web.app",
      }),
    /emulator.*production|production.*emulator/i,
  );
});

test("requires production DoJah, Firestore, and ingress limiting for production provisioning", () => {
  const production = {
    ...validEnvironment,
    NODE_ENV: "production",
    STORE_DRIVER: "firestore",
    DOJAH_BASE_URL: "https://api.dojah.io",
    ACCOUNT_PROVISIONING_ENABLED: "true",
    FIREBASE_PROJECT_ID: "department-voting",
    PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
    EDGE_SHARED_SECRET: "e".repeat(32),
    WEB_ALLOWED_ORIGINS: "https://department-voting.web.app",
  };

  assert.equal(readRuntimeConfig(production).accountProvisioningEnabled, true);
  assert.throws(
    () => readRuntimeConfig({ ...production, WEB_ALLOWED_ORIGINS: "" }),
    /allowed origins/i,
  );
  assert.throws(
    () => readRuntimeConfig({ ...production, DOJAH_BASE_URL: "https://sandbox.dojah.io" }),
    /production dojah|hosted sandbox firebase project/i,
  );
  assert.throws(
    () => readRuntimeConfig({ ...production, STORE_DRIVER: "memory" }),
    /memory store|firestore/i,
  );
  assert.throws(
    () =>
      readRuntimeConfig({
        ...production,
        PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "false",
      }),
    /ingress rate limit/i,
  );
  assert.throws(
    () => readRuntimeConfig({ ...production, EDGE_SHARED_SECRET: "" }),
    /edge shared secret/i,
  );
  assert.throws(
    () => readRuntimeConfig({ ...production, EDGE_SHARED_SECRET: "too-short" }),
    /edge shared secret/i,
  );
});

test("allows hosted sandbox provisioning only when the Firebase project binding is exact", () => {
  const hostedSandbox = {
    ...validEnvironment,
    NODE_ENV: "production",
    STORE_DRIVER: "firestore",
    ACCOUNT_PROVISIONING_ENABLED: "true",
    FIREBASE_PROJECT_ID: "voting-app-6e1fb",
    HOSTED_SANDBOX_FIREBASE_PROJECT_ID: "voting-app-6e1fb",
    PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
    EDGE_SHARED_SECRET: "e".repeat(32),
    WEB_ALLOWED_ORIGINS:
      "https://voting-app-6e1fb.web.app,https://voting-app-6e1fb-reviewer.web.app",
  };

  const config = readRuntimeConfig(hostedSandbox);

  assert.equal(config.accountProvisioningEnabled, true);
  assert.equal(config.storeDriver, "firestore");
  assert.equal(config.dojah.environment, "sandbox");
  assert.equal(config.firebase.projectId, "voting-app-6e1fb");
  assert.equal(config.firebase.authEmulatorHost, undefined);
  assert.equal(config.firebase.firestoreEmulatorHost, undefined);
});

test("rejects hosted sandbox provisioning without an exact Firebase project binding", () => {
  const hostedSandbox = {
    ...validEnvironment,
    NODE_ENV: "production",
    STORE_DRIVER: "firestore",
    ACCOUNT_PROVISIONING_ENABLED: "true",
    FIREBASE_PROJECT_ID: "voting-app-6e1fb",
    PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
    EDGE_SHARED_SECRET: "e".repeat(32),
    WEB_ALLOWED_ORIGINS: "https://voting-app-6e1fb.web.app",
  };

  assert.throws(
    () => readRuntimeConfig(hostedSandbox),
    /hosted sandbox firebase project/i,
  );
  assert.throws(
    () =>
      readRuntimeConfig({
        ...hostedSandbox,
        HOSTED_SANDBOX_FIREBASE_PROJECT_ID: "another-firebase-project",
      }),
    /hosted sandbox firebase project/i,
  );
});

test("rejects hosted sandbox provisioning outside a production runtime", () => {
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        NODE_ENV: "development",
        STORE_DRIVER: "firestore",
        ACCOUNT_PROVISIONING_ENABLED: "true",
        FIREBASE_PROJECT_ID: "voting-app-6e1fb",
        HOSTED_SANDBOX_FIREBASE_PROJECT_ID: "voting-app-6e1fb",
        PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
        EDGE_SHARED_SECRET: "e".repeat(32),
        WEB_ALLOWED_ORIGINS: "https://voting-app-6e1fb.web.app",
      }),
    /hosted sandbox.*production/i,
  );
});

test("rejects a stale hosted sandbox binding after the identity provider switches live", () => {
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        STORE_DRIVER: "firestore",
        DOJAH_BASE_URL: "https://api.dojah.io",
        ACCOUNT_PROVISIONING_ENABLED: "true",
        FIREBASE_PROJECT_ID: "voting-app-6e1fb",
        HOSTED_SANDBOX_FIREBASE_PROJECT_ID: "voting-app-6e1fb",
        PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
        EDGE_SHARED_SECRET: "e".repeat(32),
        WEB_ALLOWED_ORIGINS: "https://voting-app-6e1fb.web.app",
      }),
    /hosted sandbox firebase project/i,
  );
});

test("refuses incomplete or unsafe runtime configuration", () => {
  assert.throws(() => readRuntimeConfig({}), /configuration is missing/i);
  assert.throws(
    () => readRuntimeConfig({ ...validEnvironment, PORT: "not-a-port" }),
    /port/i,
  );
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED: "true",
        EDGE_SHARED_SECRET: "e".repeat(32),
        WEB_ALLOWED_ORIGINS: "https://department-voting.web.app",
      }),
    /memory store/i,
  );
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        DOJAH_VERIFICATION_CONTRACT_CONFIRMED: "true",
      }),
    /document types/i,
  );
  assert.throws(
    () => readRuntimeConfig({ ...validEnvironment, ACCOUNT_PROVISIONING_ENABLED: "yes" }),
    /true or false/i,
  );
  assert.throws(
    () => readRuntimeConfig({ ...validEnvironment, NODE_ENV: "prod" }),
    /node_env/i,
  );
  assert.throws(
    () => readRuntimeConfig({ ...validEnvironment, STORE_DRIVER: "firestore" }),
    /firebase_project_id/i,
  );
  assert.throws(
    () =>
      readRuntimeConfig({
        ...validEnvironment,
        DOJAH_BASE_URL: "https://sandbox.dojah.io:4443",
      }),
    /dojah base url/i,
  );
});

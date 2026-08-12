import { createServer } from "node:http";

import { createApiHandler } from "./app.js";
import { readRuntimeConfig } from "./config.js";
import { createDojahResolver } from "./dojah.js";
import { createFirebaseAuthAdapter } from "./firebase-auth.js";
import { createFirestoreStore } from "./firestore-store.js";
import { createMemoryStore } from "./memory-store.js";

const config = readRuntimeConfig(process.env);
let firebaseApp;
if (config.firebase.required) {
  const { applicationDefault, initializeApp } = await import("firebase-admin/app");
  const emulatorOnly = Boolean(
    config.firebase.authEmulatorHost || config.firebase.firestoreEmulatorHost,
  );
  firebaseApp = initializeApp({
    projectId: config.firebase.projectId,
    ...(emulatorOnly ? {} : { credential: applicationDefault() }),
  });
}

let store = createMemoryStore();
if (config.storeDriver === "firestore") {
  const { getFirestore } = await import("firebase-admin/firestore");
  store = createFirestoreStore(getFirestore(firebaseApp));
}

let firebaseAuth;
if (config.accountProvisioningEnabled) {
  const { getAuth } = await import("firebase-admin/auth");
  firebaseAuth = createFirebaseAuthAdapter(getAuth(firebaseApp));
}

const handler = createApiHandler({
  store,
  dojahResolver: createDojahResolver({
    baseUrl: config.dojah.baseUrl,
    appId: config.dojah.appId,
    privateKey: config.dojah.privateKey,
  }),
  firebaseAuth,
  publicDojahConfig: { widgetId: config.dojah.widgetId },
  webhookSecret: config.dojah.webhookSecret,
  verificationPolicy: {
    contractConfirmed: config.dojah.contractConfirmed,
    allowedDocumentTypes: config.dojah.allowedDocumentTypes,
  },
  accountProvisioningEnabled: config.accountProvisioningEnabled,
  providerEnvironment: config.dojah.environment,
});

createServer(handler).listen(config.port, "0.0.0.0");

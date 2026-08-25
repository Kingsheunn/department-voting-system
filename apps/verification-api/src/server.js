import { createServer } from "node:http";

import { createApiHandler } from "./app.js";
import { createBeleniosClient } from "./belenios.js";
import { readRuntimeConfig } from "./config.js";
import { createDojahDetailsResolver, createDojahResolver } from "./dojah.js";
import { createDojahEvidenceService } from "./evidence.js";
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
if (config.firebase.required) {
  const { getAuth } = await import("firebase-admin/auth");
  firebaseAuth = createFirebaseAuthAdapter(getAuth(firebaseApp));
}

const dojahResolver = createDojahResolver({
  baseUrl: config.dojah.baseUrl,
  appId: config.dojah.appId,
  privateKey: config.dojah.privateKey,
  imageHosts: config.dojah.imageHosts,
});
const dojahDetailsResolver = createDojahDetailsResolver({
  baseUrl: config.dojah.baseUrl,
  appId: config.dojah.appId,
  privateKey: config.dojah.privateKey,
});

const handler = createApiHandler({
  store,
  dojahResolver,
  evidenceService: createDojahEvidenceService({
    resolveVerification: dojahDetailsResolver,
    evidenceHosts: config.dojah.imageHosts,
  }),
  firebaseAuth,
  publicDojahConfig: { widgetId: config.dojah.widgetId },
  webhookSecret: config.dojah.webhookSecret,
  verificationPolicy: {
    contractConfirmed: config.dojah.contractConfirmed,
    allowedDocumentTypes: config.dojah.allowedDocumentTypes,
  },
  accountProvisioningEnabled: config.accountProvisioningEnabled,
  manualReviewEnabled: config.manualReviewEnabled,
  electionConfigurationEnabled: config.electionConfigurationEnabled,
  providerEnvironment: config.dojah.environment,
  beleniosClient: createBeleniosClient(),
  allowedOrigins: config.allowedOrigins,
  edgeSharedSecret: config.edgeSharedSecret,
});

createServer(handler).listen(config.port, "0.0.0.0");

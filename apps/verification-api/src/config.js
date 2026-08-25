const DOJAH_HOSTS = new Set(["sandbox.dojah.io", "api.dojah.io"]);
const NODE_ENVIRONMENTS = new Set(["development", "test", "production"]);

function required(environment, name, fallbackName) {
  const value = environment[name] || (fallbackName ? environment[fallbackName] : undefined);
  if (!value) throw new Error(`Runtime configuration is missing ${name}`);
  return value;
}

function booleanFlag(environment, name) {
  const value = environment[name] ?? "false";
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

function dojahHostname(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Runtime DoJah base URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    !DOJAH_HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Runtime DoJah base URL is invalid");
  }
  return url.hostname;
}

function emulatorHost(environment, name) {
  const value = environment[name];
  if (!value) return undefined;
  let url;
  try {
    url = new URL(`http://${value}`);
  } catch {
    throw new Error(`${name} must be a loopback host and port`);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !loopback ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be a loopback host and port`);
  }
  return value;
}

function allowedOrigins(environment, nodeEnvironment) {
  const values = (environment.WEB_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (nodeEnvironment === "production" && values.length === 0) {
    throw new Error("Web allowed origins must contain production portal origins");
  }

  const unique = new Set();
  for (const value of values) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Web allowed origins must contain exact HTTPS origins");
    }
    if (
      url.protocol !== "https:" ||
      value !== url.origin ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Web allowed origins must contain exact HTTPS origins");
    }
    unique.add(value);
  }
  return [...unique];
}

export function readRuntimeConfig(environment) {
  const port = Number(environment.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Runtime port is invalid");
  }

  const nodeEnvironment = environment.NODE_ENV ?? "development";
  if (!NODE_ENVIRONMENTS.has(nodeEnvironment)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  const webAllowedOrigins = allowedOrigins(environment, nodeEnvironment);
  const storeDriver = environment.STORE_DRIVER ?? "firestore";
  if (!new Set(["firestore", "memory"]).has(storeDriver)) {
    throw new Error("Runtime store driver is invalid");
  }
  const ingressRateLimitConfirmed = booleanFlag(
    environment,
    "PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED",
  );
  if (nodeEnvironment === "production" && !ingressRateLimitConfirmed) {
    throw new Error("Production ingress rate limit must be confirmed");
  }
  if (nodeEnvironment === "production" && storeDriver === "memory") {
    throw new Error("The memory store is not permitted in production");
  }

  const baseUrl = required(environment, "DOJAH_BASE_URL");
  const dojahHost = dojahHostname(baseUrl);
  const contractConfirmed = booleanFlag(
    environment,
    "DOJAH_VERIFICATION_CONTRACT_CONFIRMED",
  );
  const allowedDocumentTypes = (environment.DOJAH_ALLOWED_DOCUMENT_TYPES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (contractConfirmed && allowedDocumentTypes.length === 0) {
    throw new Error("Confirmed DoJah verification requires allowed document types");
  }

  const accountProvisioningEnabled = booleanFlag(
    environment,
    "ACCOUNT_PROVISIONING_ENABLED",
  );
  const manualReviewEnabled = booleanFlag(environment, "MANUAL_REVIEW_ENABLED");
  const electionConfigurationEnabled = booleanFlag(
    environment,
    "ELECTION_CONFIGURATION_ENABLED",
  );
  if (manualReviewEnabled && storeDriver !== "firestore") {
    throw new Error("Manual review requires Firestore");
  }
  if (electionConfigurationEnabled && storeDriver !== "firestore") {
    throw new Error("Election configuration requires Firestore");
  }
  const authEmulatorHost = emulatorHost(environment, "FIREBASE_AUTH_EMULATOR_HOST");
  const firestoreEmulatorHost = emulatorHost(environment, "FIRESTORE_EMULATOR_HOST");
  if (nodeEnvironment === "production" && (authEmulatorHost || firestoreEmulatorHost)) {
    throw new Error("Firebase emulators are not permitted in production");
  }
  if (
    nodeEnvironment === "production" &&
    accountProvisioningEnabled &&
    dojahHost !== "api.dojah.io"
  ) {
    throw new Error("Production provisioning requires the production DoJah host");
  }
  if (
    (accountProvisioningEnabled || manualReviewEnabled || electionConfigurationEnabled) &&
    dojahHost === "sandbox.dojah.io" &&
    !authEmulatorHost
  ) {
    throw new Error("Sandbox identity operations require the Firebase Auth Emulator");
  }
  if (accountProvisioningEnabled && dojahHost === "api.dojah.io" && storeDriver !== "firestore") {
    throw new Error("Production provisioning requires Firestore");
  }
  const firebaseRequired =
    storeDriver === "firestore" ||
    accountProvisioningEnabled ||
    manualReviewEnabled ||
    electionConfigurationEnabled;
  const firebaseProjectId = firebaseRequired
    ? required(environment, "FIREBASE_PROJECT_ID")
    : environment.FIREBASE_PROJECT_ID;
  if (
    storeDriver === "firestore" &&
    dojahHost === "sandbox.dojah.io" &&
    !firestoreEmulatorHost
  ) {
    throw new Error("Sandbox Firestore requires the Firestore Emulator");
  }
  if (
    dojahHost === "sandbox.dojah.io" &&
    firebaseRequired &&
    !firebaseProjectId.startsWith("demo-")
  ) {
    throw new Error("Sandbox Firebase requires a demo project ID");
  }
  const privateKey = required(environment, "DOJAH_PRIVATE_KEY");
  const imageHosts = (environment.DOJAH_IMAGE_HOSTS ?? "images.dojah.io")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    imageHosts.length === 0 ||
    imageHosts.some((host) => !/^[a-z0-9.-]+$/.test(host))
  ) {
    throw new Error("DOJAH_IMAGE_HOSTS must contain exact hostnames");
  }

  return {
    port,
    allowedOrigins: webAllowedOrigins,
    storeDriver,
    accountProvisioningEnabled,
    manualReviewEnabled,
    electionConfigurationEnabled,
    firebase: {
      required: firebaseRequired,
      projectId: firebaseProjectId,
      authEmulatorHost,
      firestoreEmulatorHost,
    },
    dojah: {
      appId: required(environment, "DOJAH_APP_ID"),
      baseUrl,
      environment: dojahHost === "api.dojah.io" ? "production" : "sandbox",
      privateKey,
      imageHosts,
      webhookSecret: environment.DOJAH_WEBHOOK_SECRET || privateKey,
      widgetId: required(
        environment,
        "DOJAH_WIDGET_ID",
        "NEXT_PUBLIC_DOJAH_WIDGET_ID",
      ),
      contractConfirmed,
      allowedDocumentTypes,
    },
  };
}

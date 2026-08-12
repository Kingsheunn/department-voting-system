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
  if (url.protocol !== "https:" || !DOJAH_HOSTS.has(url.hostname)) {
    throw new Error("Runtime DoJah base URL is invalid");
  }
  return url.hostname;
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
  const authEmulatorHost = environment.FIREBASE_AUTH_EMULATOR_HOST;
  if (authEmulatorHost?.includes("://")) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST must not include a protocol");
  }
  if (nodeEnvironment === "production" && authEmulatorHost) {
    throw new Error("Firebase Auth Emulator is not permitted in production");
  }
  if (
    nodeEnvironment === "production" &&
    accountProvisioningEnabled &&
    dojahHost !== "api.dojah.io"
  ) {
    throw new Error("Production provisioning requires the production DoJah host");
  }
  if (accountProvisioningEnabled && dojahHost === "sandbox.dojah.io" && !authEmulatorHost) {
    throw new Error("Sandbox provisioning requires the Firebase Auth Emulator");
  }
  if (accountProvisioningEnabled && dojahHost === "api.dojah.io" && storeDriver !== "firestore") {
    throw new Error("Production provisioning requires Firestore");
  }
  const firebaseRequired = storeDriver === "firestore" || accountProvisioningEnabled;
  const firebaseProjectId = firebaseRequired
    ? required(environment, "FIREBASE_PROJECT_ID")
    : environment.FIREBASE_PROJECT_ID;
  const privateKey = required(environment, "DOJAH_PRIVATE_KEY");

  return {
    port,
    storeDriver,
    accountProvisioningEnabled,
    firebase: {
      required: firebaseRequired,
      projectId: firebaseProjectId,
      authEmulatorHost,
    },
    dojah: {
      appId: required(environment, "DOJAH_APP_ID"),
      baseUrl,
      environment: dojahHost === "api.dojah.io" ? "production" : "sandbox",
      privateKey,
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

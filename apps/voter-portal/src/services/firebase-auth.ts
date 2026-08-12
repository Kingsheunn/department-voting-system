import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithCustomToken as firebaseSignInWithCustomToken,
  type Auth,
} from "firebase/auth";

export type FirebaseAuthService = {
  signInWithCustomToken(customToken: string): Promise<void>;
};

const requiredConfig = ["apiKey", "authDomain", "projectId", "appId"] as const;

type FirebaseAuthDependencies = {
  resolveAuth(config: FirebaseOptions): Auth;
  connectEmulator(auth: Auth, url: string): void;
  useInMemoryPersistence(auth: Auth): Promise<void>;
  signIn(auth: Auth, customToken: string): Promise<unknown>;
};

const browserDependencies: FirebaseAuthDependencies = {
  resolveAuth: (config) => {
    const app = getApps().length > 0 ? getApp() : initializeApp(config);
    return getAuth(app);
  },
  connectEmulator: (auth, url) => connectAuthEmulator(auth, url),
  useInMemoryPersistence: (auth) => setPersistence(auth, inMemoryPersistence),
  signIn: (auth, customToken) => firebaseSignInWithCustomToken(auth, customToken),
};

const validateEmulatorUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Firebase Auth emulator URL is invalid.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.protocol !== "http:" ||
    !loopback ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Firebase Auth emulator URL must be a loopback HTTP origin.");
  }
  return url.toString();
};

export const createFirebaseAuthService = (
  config: FirebaseOptions,
  emulatorUrl?: string,
  dependencies: FirebaseAuthDependencies = browserDependencies,
): FirebaseAuthService => {
  let auth: Auth | undefined;

  return {
    signInWithCustomToken: async (customToken) => {
      const configured = requiredConfig.every((key) => Boolean(config[key]?.trim()));
      if (!configured) throw new Error("Firebase web configuration is incomplete.");

      if (!auth) {
        const approvedEmulatorUrl = emulatorUrl
          ? validateEmulatorUrl(emulatorUrl)
          : undefined;
        const resolvedAuth = dependencies.resolveAuth(config);
        if (approvedEmulatorUrl) {
          dependencies.connectEmulator(resolvedAuth, approvedEmulatorUrl);
        }
        auth = resolvedAuth;
      }
      await dependencies.useInMemoryPersistence(auth);
      await dependencies.signIn(auth, customToken);
    },
  };
};

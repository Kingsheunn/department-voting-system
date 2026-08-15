import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  connectAuthEmulator,
  initializeAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type UserCredential,
} from "firebase/auth";

export type StaffRoles = { reviewer: boolean; admin: boolean };
export type StaffSession = {
  roles: StaffRoles;
  getIdToken(): Promise<string>;
};
export type StaffAuthService = {
  signIn(email: string, password: string): Promise<StaffSession>;
  signOut(): Promise<void>;
};

type StaffAuthDependencies = {
  resolveAuth(config: FirebaseOptions, persistence: "in-memory"): Auth;
  connectEmulator(auth: Auth, url: string): void;
  signIn(auth: Auth, email: string, password: string): Promise<UserCredential>;
  signOut(auth: Auth): Promise<void>;
};

const requiredConfig = ["apiKey", "authDomain", "projectId", "appId"] as const;
const appName = "department-vote-reviewer";

const browserDependencies: StaffAuthDependencies = {
  resolveAuth: (config) => {
    const app = getApps().some((candidate) => candidate.name === appName)
      ? getApp(appName)
      : initializeApp(config, appName);
    return initializeAuth(app, {
      persistence: inMemoryPersistence,
      popupRedirectResolver: undefined,
    });
  },
  connectEmulator: (auth, url) => connectAuthEmulator(auth, url),
  signIn: (auth, email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: (auth) => firebaseSignOut(auth),
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
  ) throw new Error("Firebase Auth emulator URL must be a loopback HTTP origin.");
  return url.toString();
};

export const createStaffAuthService = (
  config: FirebaseOptions,
  emulatorUrl?: string,
  dependencies: StaffAuthDependencies = browserDependencies,
): StaffAuthService => {
  let auth: Auth | undefined;

  const resolveAuth = () => {
    if (!requiredConfig.every((key) => Boolean(config[key]?.trim()))) {
      throw new Error("Firebase web configuration is incomplete.");
    }
    if (auth) return auth;
    const approvedEmulatorUrl = emulatorUrl ? validateEmulatorUrl(emulatorUrl) : undefined;
    const resolved = dependencies.resolveAuth(config, "in-memory");
    if (approvedEmulatorUrl) dependencies.connectEmulator(resolved, approvedEmulatorUrl);
    auth = resolved;
    return resolved;
  };

  return {
    signIn: async (email, password) => {
      const credential = await dependencies.signIn(resolveAuth(), email, password);
      const tokenResult = await credential.user.getIdTokenResult(true);
      return {
        roles: {
          reviewer: tokenResult.claims.verificationReviewer === true,
          admin: tokenResult.claims.verificationAdmin === true,
        },
        getIdToken: () => credential.user.getIdToken(true),
      };
    },
    signOut: async () => {
      if (auth) await dependencies.signOut(auth);
    },
  };
};

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
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
  useInMemoryPersistence(auth: Auth): Promise<void>;
  signIn(auth: Auth, customToken: string): Promise<unknown>;
};

const browserDependencies: FirebaseAuthDependencies = {
  resolveAuth: (config) => {
    const app = getApps().length > 0 ? getApp() : initializeApp(config);
    return getAuth(app);
  },
  useInMemoryPersistence: (auth) => setPersistence(auth, inMemoryPersistence),
  signIn: (auth, customToken) => firebaseSignInWithCustomToken(auth, customToken),
};

export const createFirebaseAuthService = (
  config: FirebaseOptions,
  dependencies: FirebaseAuthDependencies = browserDependencies,
): FirebaseAuthService => ({
  signInWithCustomToken: async (customToken) => {
    const configured = requiredConfig.every((key) => Boolean(config[key]?.trim()));
    if (!configured) throw new Error("Firebase web configuration is incomplete.");

    const auth = dependencies.resolveAuth(config);
    await dependencies.useInMemoryPersistence(auth);
    await dependencies.signIn(auth, customToken);
  },
});

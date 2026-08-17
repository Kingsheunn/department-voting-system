import type { FirebaseAuthService } from "./firebase-auth";

type LoadFirebaseAuth = () => Promise<FirebaseAuthService>;

export const createLazyFirebaseAuthService = (
  load: LoadFirebaseAuth,
): FirebaseAuthService => {
  let service: Promise<FirebaseAuthService> | undefined;

  return {
    signInWithCustomToken: async (customToken) => {
      service ??= load();
      const firebaseAuth = await service;
      return firebaseAuth.signInWithCustomToken(customToken);
    },
  };
};

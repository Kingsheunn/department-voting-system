export function createFirebaseAuthAdapter(auth) {
  return {
    async provisionAndMint({ uid, email }) {
      let user;
      try {
        user = await auth.getUser(uid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
        try {
          user = await auth.createUser({
            uid,
            email,
            emailVerified: true,
            disabled: false,
          });
        } catch (createError) {
          if (createError?.code === "auth/uid-already-exists") {
            user = await auth.getUser(uid);
          } else if (createError?.code === "auth/email-already-exists") {
            user = await auth.getUserByEmail(email);
            if (user.uid !== uid) throw new Error("Firebase identity conflict");
          } else {
            throw createError;
          }
        }
      }

      if (user.email !== email || user.emailVerified !== true) {
        throw new Error("Firebase identity conflict");
      }
      return auth.createCustomToken(uid, { identityVerified: true });
    },
  };
}

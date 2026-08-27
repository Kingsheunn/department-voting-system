export function createFirebaseAuthAdapter(auth) {
  return {
    async verifyStaffToken(token) {
      const decoded = await auth.verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        verificationReviewer: decoded.verificationReviewer === true,
        verificationAdmin: decoded.verificationAdmin === true,
      };
    },

    async verifyIdentityToken(token) {
      const decoded = await auth.verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        identityVerified: decoded.identityVerified === true,
        verificationEnvironment: decoded.verificationEnvironment,
      };
    },

    async provisionAndMint({ uid, email, providerEnvironment }) {
      if (!new Set(["sandbox", "production"]).has(providerEnvironment)) {
        throw new Error("Firebase verification environment is invalid");
      }
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
      const claims = {
        ...(user.customClaims ?? {}),
        identityVerified: true,
        verificationEnvironment: providerEnvironment,
      };
      await auth.setCustomUserClaims(uid, claims);
      return auth.createCustomToken(uid, claims);
    },
  };
}

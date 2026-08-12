import { fingerprintEmail, transitionStatus } from "./domain.js";

function dataOrNull(snapshot) {
  return snapshot.exists ? snapshot.data() : null;
}

export function createFirestoreStore(firestore) {
  const attempts = firestore.collection("verificationAttempts");
  const references = firestore.collection("verificationReferences");
  const firebaseUidsByEmail = firestore.collection("verificationEmailUids");

  return {
    async createAttempt(attempt) {
      const attemptRef = attempts.doc(attempt.id);
      const referenceRef = references.doc(attempt.referenceId);
      await firestore.runTransaction(async (transaction) => {
        const [existingAttempt, existingReference] = await Promise.all([
          transaction.get(attemptRef),
          transaction.get(referenceRef),
        ]);
        if (existingAttempt.exists || existingReference.exists) {
          throw new Error("Attempt identifier collision");
        }
        transaction.create(attemptRef, attempt);
        transaction.create(referenceRef, {
          attemptId: attempt.id,
          deleteAfter: attempt.deleteAfter,
        });
      });
    },

    async getAttempt(id) {
      return dataOrNull(await attempts.doc(id).get());
    },

    async getAttemptByReferenceId(referenceId) {
      const reference = dataOrNull(await references.doc(referenceId).get());
      return reference ? dataOrNull(await attempts.doc(reference.attemptId).get()) : null;
    },

    async applyProviderResult(id, nextStatus, reason) {
      const attemptRef = attempts.doc(id);
      return firestore.runTransaction(async (transaction) => {
        const attemptSnapshot = await transaction.get(attemptRef);
        const attempt = dataOrNull(attemptSnapshot);
        if (!attempt) throw new Error("Attempt not found");

        const status = transitionStatus(attempt.status, nextStatus);
        const updated = {
          status,
          statusReason:
            status !== attempt.status || nextStatus === attempt.status
              ? reason
              : attempt.statusReason,
          updatedAt: new Date().toISOString(),
        };
        transaction.update(attemptRef, updated);
        return { ...attempt, ...updated };
      });
    },

    async reserveFirebaseUid(id, candidateUid) {
      const attemptRef = attempts.doc(id);
      return firestore.runTransaction(async (transaction) => {
        const attempt = dataOrNull(await transaction.get(attemptRef));
        if (!attempt) throw new Error("Attempt not found");
        if (attempt.accountStatus !== "not_created") return null;
        const emailUidRef = firebaseUidsByEmail.doc(fingerprintEmail(attempt.email));
        const emailUidSnapshot = await transaction.get(emailUidRef);
        const emailUid = dataOrNull(emailUidSnapshot)?.firebaseUid;
        const uid = emailUid ?? attempt.firebaseUid ?? candidateUid;
        if (!emailUidSnapshot.exists) {
          transaction.create(emailUidRef, { firebaseUid: uid });
        }
        transaction.update(attemptRef, {
          firebaseUid: uid,
          accountStatus: "provisioning",
        });
        return uid;
      });
    },

    async markAccountReady(id) {
      const attemptRef = attempts.doc(id);
      await firestore.runTransaction(async (transaction) => {
        const attempt = dataOrNull(await transaction.get(attemptRef));
        if (!attempt) throw new Error("Attempt not found");
        if (attempt.accountStatus !== "provisioning") {
          throw new Error("Account provisioning is not active");
        }
        transaction.update(attemptRef, {
          accountStatus: "ready",
          claimTokenHash: null,
          updatedAt: new Date().toISOString(),
        });
      });
    },

    async releaseAccountProvisioning(id) {
      const attemptRef = attempts.doc(id);
      await firestore.runTransaction(async (transaction) => {
        const attempt = dataOrNull(await transaction.get(attemptRef));
        if (!attempt) throw new Error("Attempt not found");
        if (attempt.accountStatus !== "provisioning") return;
        transaction.update(attemptRef, {
          accountStatus: "not_created",
          updatedAt: new Date().toISOString(),
        });
      });
    },
  };
}

import { fingerprintEmail, transitionStatus } from "./domain.js";

function copy(value) {
  return value ? structuredClone(value) : null;
}

export function createMemoryStore() {
  const attempts = new Map();
  const references = new Map();
  const firebaseUidsByEmail = new Map();

  return {
    async createAttempt(attempt) {
      if (attempts.has(attempt.id) || references.has(attempt.referenceId)) {
        throw new Error("Attempt identifier collision");
      }
      attempts.set(attempt.id, copy(attempt));
      references.set(attempt.referenceId, attempt.id);
    },

    async getAttempt(id) {
      return copy(attempts.get(id));
    },

    async getAttemptByReferenceId(referenceId) {
      const id = references.get(referenceId);
      return id ? copy(attempts.get(id)) : null;
    },

    async applyProviderResult(id, nextStatus, reason) {
      const attempt = attempts.get(id);
      if (!attempt) throw new Error("Attempt not found");

      const status = transitionStatus(attempt.status, nextStatus);
      if (status !== attempt.status || nextStatus === attempt.status) {
        attempt.statusReason = reason;
      }
      attempt.status = status;
      attempt.updatedAt = new Date().toISOString();
      return copy(attempt);
    },

    async reserveFirebaseUid(id, candidateUid) {
      const attempt = attempts.get(id);
      if (!attempt) throw new Error("Attempt not found");
      if (attempt.accountStatus !== "not_created") return null;
      const emailKey = fingerprintEmail(attempt.email);
      const uid = firebaseUidsByEmail.get(emailKey) ?? attempt.firebaseUid ?? candidateUid;
      firebaseUidsByEmail.set(emailKey, uid);
      attempt.firebaseUid = uid;
      attempt.accountStatus = "provisioning";
      return uid;
    },

    async markAccountReady(id) {
      const attempt = attempts.get(id);
      if (!attempt) throw new Error("Attempt not found");
      if (attempt.accountStatus !== "provisioning") {
        throw new Error("Account provisioning is not active");
      }
      attempt.accountStatus = "ready";
      attempt.claimTokenHash = null;
      attempt.updatedAt = new Date().toISOString();
    },

    async releaseAccountProvisioning(id) {
      const attempt = attempts.get(id);
      if (!attempt) throw new Error("Attempt not found");
      if (attempt.accountStatus !== "provisioning") return;
      attempt.accountStatus = "not_created";
      attempt.updatedAt = new Date().toISOString();
    },
  };
}

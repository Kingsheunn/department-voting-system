import { createHash } from "node:crypto";

import { fingerprintEmail, transitionStatus } from "./domain.js";

function dataOrNull(snapshot) {
  return snapshot.exists ? snapshot.data() : null;
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function reviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isReviewable(attempt, currentTime) {
  const expiresAt = Date.parse(attempt.expiresAt);
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > currentTime.getTime() &&
    attempt.status === "pending_review" &&
    (attempt.statusReason === "student_id_manual_review_required" ||
      attempt.reviewStage === "escalated_review")
  );
}

export function createFirestoreStore(firestore, { now = () => new Date() } = {}) {
  const attempts = firestore.collection("verificationAttempts");
  const references = firestore.collection("verificationReferences");
  const firebaseUidsByEmail = firestore.collection("verificationEmailUids");
  const reviewAudits = firestore.collection("verificationReviewAudits");
  const electionMetadata = firestore.collection("electionMetadata");
  const electionAudits = firestore.collection("electionConfigurationAudits");

  async function recordReview({ id, actorUid, decision, idempotencyKey, action }) {
    const attemptRef = attempts.doc(id);
    const actorFingerprint = digest(actorUid);
    const requestHash = digest(JSON.stringify({ id, actorFingerprint, decision, action }));
    const auditRef = reviewAudits.doc(digest(idempotencyKey));
    return firestore.runTransaction(async (transaction) => {
      const [attemptSnapshot, auditSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(auditRef),
      ]);
      const existingAudit = dataOrNull(auditSnapshot);
      if (existingAudit) {
        if (existingAudit.requestHash !== requestHash) {
          throw reviewError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used");
        }
        return existingAudit.response;
      }

      const attempt = dataOrNull(attemptSnapshot);
      if (!attempt) throw reviewError("NOT_FOUND", "Verification attempt not found");
      if (!isReviewable(attempt, now())) {
        throw reviewError("REVIEW_CONFLICT", "Verification attempt is not reviewable");
      }
      let status;
      let reviewStage;
      let statusReason;
      let reviewDecisions = attempt.reviewDecisions ?? [];

      if (action === "review") {
        if (
          attempt.status !== "pending_review" ||
          attempt.statusReason !== "student_id_manual_review_required" ||
          attempt.reviewStage === "escalated_review"
        ) {
          throw reviewError("REVIEW_CONFLICT", "Verification attempt is not reviewable");
        }
        if (reviewDecisions.some((entry) => entry.actorFingerprint === actorFingerprint)) {
          throw reviewError("REVIEW_CONFLICT", "A second distinct reviewer is required");
        }
        if (reviewDecisions.length >= 2) {
          throw reviewError("REVIEW_CONFLICT", "Verification review is already complete");
        }
        reviewDecisions = [...reviewDecisions, { actorFingerprint, decision }];
        status = "pending_review";
        reviewStage = "awaiting_second_review";
        statusReason = attempt.statusReason;
        if (reviewDecisions.length === 2) {
          if (reviewDecisions[0].decision === decision) {
            status = decision === "approve" ? "approved" : "rejected";
            reviewStage = "resolved";
            statusReason = `manual_review_${status}`;
          } else {
            reviewStage = "escalated_review";
            statusReason = "manual_review_disagreement";
          }
        }
      } else {
        if (attempt.status !== "pending_review" || attempt.reviewStage !== "escalated_review") {
          throw reviewError("REVIEW_CONFLICT", "Verification review is not escalated");
        }
        if (reviewDecisions.some((entry) => entry.actorFingerprint === actorFingerprint)) {
          throw reviewError("REVIEW_CONFLICT", "A separate administrator is required");
        }
        status = decision === "approve" ? "approved" : "rejected";
        reviewStage = "resolved";
        statusReason = `admin_review_${status}`;
      }

      const updatedAt = now().toISOString();
      const deleteAfter = new Date(Date.parse(updatedAt) + 365 * 24 * 60 * 60 * 1000);
      const response = { status, reviewStage };
      transaction.update(attemptRef, {
        status,
        reviewStage,
        statusReason,
        reviewDecisions,
        humanReviewOwned: true,
        reviewQueue: status === "pending_review",
        updatedAt,
      });
      transaction.create(auditRef, {
        attemptId: id,
        actorFingerprint,
        action,
        decision,
        requestHash,
        response,
        createdAt: updatedAt,
        deleteAfter,
      });
      return response;
    });
  }

  return {
    async getElectionConfiguration() {
      const configuration = dataOrNull(await electionMetadata.doc("current").get());
      if (!configuration) return null;
      const { updatedByFingerprint, ...publicConfiguration } = configuration;
      return publicConfiguration;
    },

    async saveElectionConfiguration({ configuration, expectedRevision, actorUid }) {
      const configurationRef = electionMetadata.doc("current");
      return firestore.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(configurationRef);
        const current = dataOrNull(currentSnapshot);
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== expectedRevision) {
          throw reviewError("REVISION_CONFLICT", "Election configuration changed");
        }
        const revision = currentRevision + 1;
        const updatedAt = now().toISOString();
        const deleteAfter = new Date(Date.parse(updatedAt) + 365 * 24 * 60 * 60 * 1000);
        const actorFingerprint = digest(actorUid);
        const stored = {
          ...configuration,
          revision,
          updatedAt,
          updatedByFingerprint: actorFingerprint,
        };
        if (currentSnapshot.exists) transaction.update(configurationRef, stored);
        else transaction.create(configurationRef, stored);
        transaction.create(electionAudits.doc(`revision-${revision}`), {
          revision,
          actorFingerprint,
          configuration,
          createdAt: updatedAt,
          deleteAfter,
        });
        return { ...configuration, revision, updatedAt };
      });
    },

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
        transaction.create(attemptRef, {
          ...attempt,
          reviewQueue: isReviewable(attempt, now()),
        });
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

    async listReviewableAttempts(limit = 20) {
      const currentTime = now();
      const snapshot = await attempts
        .where("reviewQueue", "==", true)
        .where("expiresAt", ">", currentTime.toISOString())
        .orderBy("expiresAt", "asc")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((document) => document.data())
        .filter((attempt) => isReviewable(attempt, currentTime))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit);
    },

    async applyProviderResult(id, nextStatus, reason) {
      const attemptRef = attempts.doc(id);
      return firestore.runTransaction(async (transaction) => {
        const attemptSnapshot = await transaction.get(attemptRef);
        const attempt = dataOrNull(attemptSnapshot);
        if (!attempt) throw new Error("Attempt not found");

        if (attempt.humanReviewOwned === true) return attempt;

        const status = transitionStatus(attempt.status, nextStatus);
        const updated = {
          status,
          statusReason:
            status !== attempt.status || nextStatus === attempt.status
              ? reason
              : attempt.statusReason,
          reviewQueue: isReviewable(
            { ...attempt, status, statusReason: reason },
            now(),
          ),
          updatedAt: new Date().toISOString(),
        };
        transaction.update(attemptRef, updated);
        return { ...attempt, ...updated };
      });
    },

    async recordReviewerDecision(input) {
      return recordReview({ ...input, action: "review" });
    },

    async resolveEscalatedReview(input) {
      return recordReview({ ...input, action: "admin_resolution" });
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

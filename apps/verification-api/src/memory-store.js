import { createHash } from "node:crypto";

import { fingerprintEmail, transitionStatus } from "./domain.js";

function copy(value) {
  return value ? structuredClone(value) : null;
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

export function createMemoryStore({ now = () => new Date() } = {}) {
  const attempts = new Map();
  const references = new Map();
  const firebaseUidsByEmail = new Map();
  const reviewAudits = new Map();
  const electionAudits = new Map();
  let electionConfiguration;

  function digest(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  function reviewError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function recordReview({ id, actorUid, decision, idempotencyKey, action }) {
    const actorFingerprint = digest(actorUid);
    const requestHash = digest(JSON.stringify({ id, actorFingerprint, decision, action }));
    const auditId = digest(idempotencyKey);
    const existingAudit = reviewAudits.get(auditId);
    if (existingAudit) {
      if (existingAudit.requestHash !== requestHash) {
        throw reviewError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used");
      }
      return copy(existingAudit.response);
    }

    const attempt = attempts.get(id);
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
    Object.assign(attempt, {
      status,
      reviewStage,
      statusReason,
      reviewDecisions,
      humanReviewOwned: true,
      reviewQueue: status === "pending_review",
      updatedAt,
    });
    const response = { status, reviewStage };
    reviewAudits.set(auditId, {
      attemptId: id,
      actorFingerprint,
      action,
      decision,
      requestHash,
      response,
      createdAt: updatedAt,
      deleteAfter,
    });
    return copy(response);
  }

  return {
    async getElectionConfiguration() {
      if (!electionConfiguration) return null;
      const { updatedByFingerprint, ...configuration } = electionConfiguration;
      return copy(configuration);
    },

    async saveElectionConfiguration({ configuration, expectedRevision, actorUid }) {
      const currentRevision = electionConfiguration?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        throw reviewError("REVISION_CONFLICT", "Election configuration changed");
      }
      const revision = currentRevision + 1;
      const updatedAt = now().toISOString();
      const deleteAfter = new Date(Date.parse(updatedAt) + 365 * 24 * 60 * 60 * 1000);
      const actorFingerprint = digest(actorUid);
      electionConfiguration = copy({
        ...configuration,
        revision,
        updatedAt,
        updatedByFingerprint: actorFingerprint,
      });
      electionAudits.set(revision, copy({
        revision,
        actorFingerprint,
        configuration,
        createdAt: updatedAt,
        deleteAfter,
      }));
      return {
        ...copy(configuration),
        revision,
        updatedAt,
      };
    },

    async createAttempt(attempt) {
      if (attempts.has(attempt.id) || references.has(attempt.referenceId)) {
        throw new Error("Attempt identifier collision");
      }
      attempts.set(attempt.id, copy({
        ...attempt,
        reviewQueue: isReviewable(attempt, now()),
      }));
      references.set(attempt.referenceId, attempt.id);
    },

    async getAttempt(id) {
      return copy(attempts.get(id));
    },

    async getAttemptByReferenceId(referenceId) {
      const id = references.get(referenceId);
      return id ? copy(attempts.get(id)) : null;
    },

    async listReviewableAttempts(limit = 20) {
      return [...attempts.values()]
        .filter((attempt) => isReviewable(attempt, now()))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map(copy);
    },

    async applyProviderResult(id, nextStatus, reason) {
      const attempt = attempts.get(id);
      if (!attempt) throw new Error("Attempt not found");

      if (attempt.humanReviewOwned === true) return copy(attempt);

      const status = transitionStatus(attempt.status, nextStatus);
      if (status !== attempt.status || nextStatus === attempt.status) {
        attempt.statusReason = reason;
      }
      attempt.status = status;
      attempt.reviewQueue = isReviewable(
        { ...attempt, status, statusReason: reason },
        now(),
      );
      attempt.updatedAt = new Date().toISOString();
      return copy(attempt);
    },

    async recordReviewerDecision(input) {
      return recordReview({ ...input, action: "review" });
    },

    async resolveEscalatedReview(input) {
      return recordReview({ ...input, action: "admin_resolution" });
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

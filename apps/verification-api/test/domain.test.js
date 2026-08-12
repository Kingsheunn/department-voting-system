import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildDojahLaunchUrl,
  createAttemptMaterial,
  evaluateDojahVerification,
  hashClaimToken,
  normalizeSchoolEmail,
  transitionStatus,
  verifyDojahSignature,
} from "../src/domain.js";

const email = "student.one@students.unilorin.edu.ng";
const verificationPolicy = {
  contractConfirmed: true,
  allowedDocumentTypes: ["Student ID"],
};

function completedVerification(overrides = {}) {
  return {
    reference_id: "VR_expected-reference",
    verification_status: "Completed",
    verification_mode: "LIVENESS",
    status: true,
    data: {
      email: { status: true, data: { email } },
      id: {
        status: true,
        data: {
          id_data: {
            document_number: "STUDENT-1",
            document_type: "Student ID",
          },
        },
      },
      selfie: { status: true, data: { selfie_url: "https://provider.invalid/selfie" } },
    },
    ...overrides,
  };
}

function completedStudentCardUpload(overrides = {}) {
  return {
    reference_id: "VR_expected-reference",
    verification_status: "Completed",
    verification_mode: "",
    status: true,
    data: {
      email: { status: true, data: { email } },
      additional_document: [
        {
          document_type: "image",
          document_url: "https://provider.invalid/student-card",
        },
      ],
      selfie: { status: true, data: { selfie_url: "https://provider.invalid/selfie" } },
    },
    ...overrides,
  };
}

test("normalizes an exact University of Ilorin student email", () => {
  assert.equal(
    normalizeSchoolEmail("  Student.One@STUDENTS.UNILORIN.EDU.NG  "),
    email,
  );
});

test("rejects addresses outside the exact student domain", () => {
  const invalid = [
    "student@unilorin.edu.ng",
    "student@dept.students.unilorin.edu.ng",
    "student@students.unilorin.edu.ng.evil.example",
    "student @students.unilorin.edu.ng",
    "@students.unilorin.edu.ng",
  ];

  for (const value of invalid) {
    assert.throws(() => normalizeSchoolEmail(value), /school email/i);
  }
});

test("creates distinct attempt credentials with at least 128 bits of entropy", () => {
  const first = createAttemptMaterial();
  const second = createAttemptMaterial();

  assert.match(first.attemptId, /^va_[A-Za-z0-9_-]{22,}$/);
  assert.match(first.claimToken, /^ct_[A-Za-z0-9_-]{22,}$/);
  assert.match(first.referenceId, /^VR_[A-Za-z0-9_-]{22,}$/);
  assert.notEqual(first.attemptId, second.attemptId);
  assert.notEqual(first.claimToken, second.claimToken);
  assert.notEqual(first.referenceId, second.referenceId);
  assert.equal(hashClaimToken(first.claimToken).length, 64);
});

test("builds only the approved HTTPS DoJah identity launch URL", () => {
  const launchUrl = new URL(
    buildDojahLaunchUrl({ widgetId: "public-widget", referenceId: "VR_reference-value" }),
  );

  assert.equal(launchUrl.protocol, "https:");
  assert.equal(launchUrl.hostname, "identity.dojah.io");
  assert.equal(launchUrl.searchParams.get("widget_id"), "public-widget");
  assert.equal(launchUrl.searchParams.get("reference_id"), "VR_reference-value");
  assert.equal(launchUrl.searchParams.has("private_key"), false);
});

test("verifies the raw webhook body and rejects a modified body", () => {
  const secret = "test-only-webhook-secret";
  const rawBody = Buffer.from('{"reference_id":"VR_reference-value"}');
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  assert.equal(verifyDojahSignature(rawBody, signature, secret), true);
  assert.equal(
    verifyDojahSignature(Buffer.from(`${rawBody} `), signature, secret),
    false,
  );
  assert.equal(verifyDojahSignature(rawBody, "not-hex", secret), false);
});

test("keeps terminal verification states monotonic", () => {
  assert.equal(transitionStatus("created", "in_progress"), "in_progress");
  assert.equal(transitionStatus("pending_review", "approved"), "approved");
  assert.equal(transitionStatus("approved", "in_progress"), "approved");
  assert.equal(transitionStatus("rejected", "approved"), "rejected");
});

test("approves only an authoritative result with every required check", () => {
  const result = evaluateDojahVerification(completedVerification(), {
    email,
    referenceId: "VR_expected-reference",
  }, verificationPolicy);

  assert.deepEqual(result, { status: "approved", reason: "checks_passed" });
});

test("fails closed when provider fields are missing, unknown, or mismatched", () => {
  const attempt = { email, referenceId: "VR_expected-reference" };
  const cases = [
    {},
    completedVerification({ verification_status: "Unexpected" }),
    completedVerification({ reference_id: "VR_other-reference" }),
    completedVerification({ status: false }),
    completedVerification({ data: { email: { status: true, data: { email } } } }),
    completedVerification({
      data: {
        ...completedVerification().data,
        email: {
          status: true,
          data: { email: "other@students.unilorin.edu.ng" },
        },
      },
    }),
  ];

  for (const value of cases) {
    assert.notEqual(
      evaluateDojahVerification(value, attempt, verificationPolicy).status,
      "approved",
    );
  }
});

test("requires the confirmed liveness and document-type contract", () => {
  const attempt = { email, referenceId: "VR_expected-reference" };
  const wrongDocumentType = completedVerification({
    data: {
      ...completedVerification().data,
      id: {
        status: true,
        data: {
          id_data: {
            document_number: "STUDENT-1",
            document_type: "National ID",
          },
        },
      },
    },
  });

  assert.deepEqual(
    evaluateDojahVerification(completedVerification(), attempt, {
      ...verificationPolicy,
      contractConfirmed: false,
    }),
    { status: "pending_review", reason: "verification_contract_unconfirmed" },
  );
  assert.deepEqual(
    evaluateDojahVerification(
      completedVerification({ verification_mode: "VIDEO" }),
      attempt,
      verificationPolicy,
    ),
    { status: "pending_review", reason: "liveness_mode_missing" },
  );
  assert.deepEqual(
    evaluateDojahVerification(wrongDocumentType, attempt, verificationPolicy),
    { status: "pending_review", reason: "document_type_not_allowed" },
  );
});

test("routes a custom student-card upload to manual review without approving it", () => {
  const attempt = { email, referenceId: "VR_expected-reference" };

  assert.deepEqual(
    evaluateDojahVerification(
      completedStudentCardUpload(),
      attempt,
      verificationPolicy,
    ),
    { status: "pending_review", reason: "student_id_manual_review_required" },
  );
});

test("does not accept an unconfirmed school email in a student-card flow", () => {
  const attempt = { email, referenceId: "VR_expected-reference" };
  const result = completedStudentCardUpload({
    data: {
      ...completedStudentCardUpload().data,
      email: { status: false, data: { email } },
    },
  });

  assert.deepEqual(
    evaluateDojahVerification(result, attempt, verificationPolicy),
    { status: "pending_review", reason: "required_checks_missing" },
  );
});

test("maps non-completed provider states without granting access", () => {
  const attempt = { email, referenceId: "VR_expected-reference" };

  assert.equal(
    evaluateDojahVerification(
      completedVerification({ verification_status: "Ongoing" }),
      attempt,
    ).status,
    "in_progress",
  );
  assert.equal(
    evaluateDojahVerification(
      completedVerification({ verification_status: "Pending" }),
      attempt,
    ).status,
    "pending_review",
  );
  assert.equal(
    evaluateDojahVerification(
      completedVerification({ verification_status: "Failed" }),
      attempt,
    ).status,
    "rejected",
  );
});

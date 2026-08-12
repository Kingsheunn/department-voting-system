import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SCHOOL_DOMAIN = "students.unilorin.edu.ng";
const TERMINAL_STATUSES = new Set(["approved", "rejected", "abandoned", "expired"]);

function opaqueValue(prefix, size, randomBytesFn) {
  const value = randomBytesFn(size);
  if (!Buffer.isBuffer(value) || value.length < size) {
    throw new Error("Secure random source returned insufficient data");
  }
  return `${prefix}${value.toString("base64url")}`;
}

export function normalizeSchoolEmail(value) {
  if (typeof value !== "string") {
    throw new Error("A valid school email is required");
  }

  const email = value.trim().toLowerCase();
  const parts = email.split("@");
  const local = parts[0];
  const domain = parts[1];
  const validLocal =
    typeof local === "string" &&
    local.length <= 64 &&
    /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?$/.test(local) &&
    !local.includes("..");

  if (parts.length !== 2 || domain !== SCHOOL_DOMAIN || !validLocal) {
    throw new Error("A valid school email is required");
  }

  return email;
}

export function createAttemptMaterial(randomBytesFn = randomBytes) {
  return {
    attemptId: opaqueValue("va_", 16, randomBytesFn),
    claimToken: opaqueValue("ct_", 32, randomBytesFn),
    referenceId: opaqueValue("VR_", 16, randomBytesFn),
  };
}

export function createFirebaseUid(randomBytesFn = randomBytes) {
  return opaqueValue("fv_", 16, randomBytesFn);
}

export function hashClaimToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function fingerprintEmail(value) {
  return createHash("sha256")
    .update(normalizeSchoolEmail(value), "utf8")
    .digest("hex");
}

export function verifyClaimToken(token, expectedHash) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash ?? "")) {
    return false;
  }
  const actual = Buffer.from(hashClaimToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export function buildDojahLaunchUrl({ widgetId, referenceId }) {
  if (!widgetId || !referenceId) {
    throw new Error("Public DoJah widget configuration is required");
  }

  const url = new URL("https://identity.dojah.io/");
  url.searchParams.set("widget_id", widgetId);
  url.searchParams.set("reference_id", referenceId);
  return url.toString();
}

export function verifyDojahSignature(rawBody, signature, secret) {
  if (
    !Buffer.isBuffer(rawBody) ||
    typeof secret !== "string" ||
    secret.length === 0 ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function transitionStatus(current, next) {
  if (TERMINAL_STATUSES.has(current)) return current;
  const allowed = new Set([
    "created",
    "in_progress",
    "pending_review",
    "approved",
    "rejected",
    "abandoned",
    "expired",
  ]);
  return allowed.has(next) ? next : "pending_review";
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function evaluateDojahVerification(
  providerResult,
  attempt,
  { contractConfirmed = false, allowedDocumentTypes = [] } = {},
) {
  if (!providerResult || typeof providerResult !== "object") {
    return { status: "pending_review", reason: "provider_result_invalid" };
  }
  if (providerResult.reference_id !== attempt.referenceId) {
    return { status: "pending_review", reason: "reference_mismatch" };
  }

  const providerStatus = providerResult.verification_status;
  if (providerStatus === "Ongoing") {
    return { status: "in_progress", reason: "provider_ongoing" };
  }
  if (providerStatus === "Pending") {
    return { status: "pending_review", reason: "provider_pending" };
  }
  if (providerStatus === "Failed") {
    return { status: "rejected", reason: "provider_failed" };
  }
  if (providerStatus === "Abandoned") {
    return { status: "abandoned", reason: "provider_abandoned" };
  }
  if (providerStatus !== "Completed") {
    return { status: "pending_review", reason: "provider_status_unknown" };
  }
  if (contractConfirmed !== true) {
    return { status: "pending_review", reason: "verification_contract_unconfirmed" };
  }

  const emailCheck = providerResult.data?.email;
  const idCheck = providerResult.data?.id;
  const selfieCheck = providerResult.data?.selfie;
  let verifiedEmail;
  try {
    verifiedEmail = normalizeSchoolEmail(emailCheck?.data?.email);
  } catch {
    return { status: "pending_review", reason: "required_checks_missing" };
  }

  if (emailCheck?.status !== true || selfieCheck?.status !== true) {
    return { status: "pending_review", reason: "required_checks_missing" };
  }
  if (providerResult.verification_mode !== "LIVENESS") {
    return { status: "pending_review", reason: "liveness_mode_missing" };
  }
  if (providerResult.status !== true || verifiedEmail !== attempt.email) {
    return { status: "rejected", reason: "checks_failed" };
  }
  if (
    !idCheck &&
    Array.isArray(providerResult.data?.additional_document) &&
    providerResult.data.additional_document.length > 0
  ) {
    return {
      status: "pending_review",
      reason: "student_id_manual_review_required",
    };
  }

  const requiredFieldsPresent =
    idCheck?.status === true &&
    nonEmptyString(idCheck?.data?.id_data?.document_number) &&
    nonEmptyString(selfieCheck?.data?.selfie_url);

  if (!requiredFieldsPresent) {
    return { status: "pending_review", reason: "required_checks_missing" };
  }
  const documentType = idCheck.data.id_data.document_type;
  if (
    !Array.isArray(allowedDocumentTypes) ||
    !allowedDocumentTypes.includes(documentType)
  ) {
    return { status: "pending_review", reason: "document_type_not_allowed" };
  }
  return { status: "approved", reason: "checks_passed" };
}

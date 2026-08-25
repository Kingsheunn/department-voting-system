import {
  buildDojahLaunchUrl,
  createAttemptMaterial,
  createFirebaseUid,
  evaluateDojahVerification,
  hashClaimToken,
  isTerminalStatus,
  normalizeSchoolEmail,
  verifyClaimToken,
  verifyDojahSignature,
} from "./domain.js";
import {
  publicElectionConfiguration,
  validateElectionConfigurationInput,
} from "./election.js";

const JSON_LIMIT = 16 * 1024;
const WEBHOOK_LIMIT = 1024 * 1024;
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const CORS_METHODS = "GET, POST, PUT, OPTIONS";
const CORS_HEADERS = "authorization, content-type, idempotency-key";
const CORS_HEADER_SET = new Set(CORS_HEADERS.split(", "));
const CORS_METHOD_SET = new Set(CORS_METHODS.split(", "));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        cleanup();
        request.resume();
        reject(new HttpError(413, "Request body is too large"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function parseJson(rawBody) {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  if (status === 204) return response.end();
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendImage(response, { contentType, body }) {
  response.statusCode = 200;
  response.setHeader("cache-control", "no-store, private");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("content-type", contentType);
  response.setHeader("content-length", body.length);
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.end(body);
}

function applyCors(request, response, allowedOrigins) {
  const headers = request.headers ?? {};
  const origin = headers.origin;
  if (!origin) {
    if (request.method === "OPTIONS") throw new HttpError(403, "Origin is required");
    return false;
  }
  if (!allowedOrigins.has(origin)) throw new HttpError(403, "Origin is not allowed");

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  if (request.method !== "OPTIONS") return false;

  const requestedMethod = headers["access-control-request-method"];
  const requestedHeaders = (headers["access-control-request-headers"] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    typeof requestedMethod !== "string" ||
    !CORS_METHOD_SET.has(requestedMethod) ||
    requestedHeaders.some((header) => !CORS_HEADER_SET.has(header))
  ) {
    throw new HttpError(403, "CORS preflight is not allowed");
  }
  response.setHeader("access-control-allow-methods", CORS_METHODS);
  response.setHeader("access-control-allow-headers", CORS_HEADERS);
  response.setHeader("access-control-max-age", "600");
  return true;
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "Unauthorized");
  }
  return authorization.slice(7);
}

async function authorizedStaff(request, firebaseAuth) {
  if (!firebaseAuth?.verifyStaffToken) {
    throw new HttpError(503, "Staff authentication is unavailable");
  }
  try {
    return await firebaseAuth.verifyStaffToken(bearerToken(request));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Unauthorized");
  }
}

async function authorizedIdentity(request, firebaseAuth) {
  if (!firebaseAuth?.verifyIdentityToken) {
    throw new HttpError(503, "Voter authentication is unavailable");
  }
  let identity;
  try {
    identity = await firebaseAuth.verifyIdentityToken(bearerToken(request));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Unauthorized");
  }
  if (identity.identityVerified !== true) throw new HttpError(403, "Forbidden");
  return identity;
}

function reviewDecision(value) {
  if (value !== "approve" && value !== "reject") {
    throw new HttpError(400, "Review decision must be approve or reject");
  }
  return value;
}

function staffCanViewReview(staff) {
  return staff.verificationReviewer === true || staff.verificationAdmin === true;
}

function maskedEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function isReviewableAttempt(attempt, currentTime) {
  const expiresAt = Date.parse(attempt.expiresAt);
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > currentTime.getTime() &&
    attempt.status === "pending_review" &&
    (attempt.statusReason === "student_id_manual_review_required" ||
      attempt.reviewStage === "escalated_review")
  );
}

function idempotencyKey(request) {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new HttpError(400, "A valid Idempotency-Key header is required");
  }
  return value;
}

function rethrowReviewError(error) {
  if (error?.code === "NOT_FOUND") throw new HttpError(404, error.message);
  if (["REVIEW_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error?.code)) {
    throw new HttpError(409, error.message);
  }
  throw error;
}

async function authorizedAttempt(request, store, id, now) {
  const attempt = await store.getAttempt(id);
  const token = bearerToken(request);
  if (!attempt || !verifyClaimToken(token, attempt.claimTokenHash)) {
    throw new HttpError(401, "Unauthorized");
  }
  const expiresAt = Date.parse(attempt.expiresAt);
  if (!Number.isFinite(expiresAt) || now().getTime() >= expiresAt) {
    throw new HttpError(410, "Verification attempt expired");
  }
  return attempt;
}

function nextAction(status) {
  if (status === "approved") return "create_account";
  if (status === "pending_review") return "wait_for_review";
  if (["rejected", "abandoned", "expired"].includes(status)) return "restart_verification";
  return "complete_verification";
}

function createFixedWindowLimiter({ maxAttempts, windowMs, now }) {
  const counts = new Map();
  let windowEndsAt = 0;

  return function allow(key) {
    const currentTime = now().getTime();
    if (currentTime >= windowEndsAt) {
      counts.clear();
      windowEndsAt = currentTime + windowMs;
    }
    const count = counts.get(key) ?? 0;
    if (count >= maxAttempts) return false;
    counts.set(key, count + 1);
    return true;
  };
}

export function createApiHandler({
  store,
  dojahResolver,
  firebaseAuth,
  publicDojahConfig,
  webhookSecret,
  now = () => new Date(),
  verificationPolicy = {},
  accountProvisioningEnabled = false,
  manualReviewEnabled = false,
  electionConfigurationEnabled = false,
  attemptRateLimit,
  providerEnvironment,
  evidenceService,
  beleniosClient,
  allowedOrigins = [],
}) {
  if (
    !store ||
    !dojahResolver ||
    (accountProvisioningEnabled && !firebaseAuth) ||
    !publicDojahConfig?.widgetId ||
    !webhookSecret ||
    !["sandbox", "production"].includes(providerEnvironment) ||
    (electionConfigurationEnabled &&
      (!firebaseAuth?.verifyStaffToken ||
        !firebaseAuth?.verifyIdentityToken ||
        !store.getElectionConfiguration ||
        !store.saveElectionConfiguration ||
        !beleniosClient?.getElectionReadiness))
  ) {
    throw new Error("Verification API dependencies are incomplete");
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some((origin) => typeof origin !== "string")) {
    throw new Error("Verification API allowed origins are invalid");
  }
  const allowedOriginSet = new Set(allowedOrigins);
  const rateLimit = {
    maxAttempts: 5,
    windowMs: 60_000,
    ...(attemptRateLimit ?? {}),
  };
  if (
    !Number.isInteger(rateLimit.maxAttempts) ||
    rateLimit.maxAttempts < 1 ||
    !Number.isInteger(rateLimit.windowMs) ||
    rateLimit.windowMs < 1
  ) {
    throw new Error("Attempt rate-limit configuration is invalid");
  }
  const allowAttempt = createFixedWindowLimiter({ ...rateLimit, now });
  const attemptPolicy = {
    contractConfirmed: verificationPolicy.contractConfirmed === true,
    allowedDocumentTypes: Array.isArray(verificationPolicy.allowedDocumentTypes)
      ? [...verificationPolicy.allowedDocumentTypes]
      : [],
    providerEnvironment,
  };

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");
      if (applyCors(request, response, allowedOriginSet)) {
        return sendJson(response, 204);
      }

      if (request.method === "GET" && url.pathname === "/healthz") {
        return sendJson(response, 200, { status: "ok" });
      }

      if (request.method === "POST" && url.pathname === "/v1/verification-attempts") {
        if (!allowAttempt(request.socket.remoteAddress ?? "unknown")) {
          throw new HttpError(429, "Too many verification attempts");
        }
        const body = parseJson(await readBody(request, JSON_LIMIT));
        let email;
        try {
          email = normalizeSchoolEmail(body?.email);
        } catch {
          throw new HttpError(400, "A valid school email is required");
        }
        const material = createAttemptMaterial();
        const createdAt = now();
        const timestamp = createdAt.toISOString();
        const expiresAt = new Date(createdAt.getTime() + ATTEMPT_TTL_MS).toISOString();
        const deleteAfter = new Date(createdAt.getTime() + RETENTION_MS);
        await store.createAttempt({
          id: material.attemptId,
          email,
          referenceId: material.referenceId,
          claimTokenHash: hashClaimToken(material.claimToken),
          status: "created",
          statusReason: "attempt_created",
          accountStatus: "not_created",
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt,
          deleteAfter,
          verificationPolicy: {
            ...attemptPolicy,
            allowedDocumentTypes: [...attemptPolicy.allowedDocumentTypes],
          },
        });
        return sendJson(response, 201, {
          attemptId: material.attemptId,
          claimToken: material.claimToken,
          status: "created",
          expiresAt,
          verificationUrl: buildDojahLaunchUrl({
            widgetId: publicDojahConfig.widgetId,
            referenceId: material.referenceId,
          }),
        });
      }

      const attemptRoute = url.pathname.match(
        /^\/v1\/verification-attempts\/(va_[A-Za-z0-9_-]+)(?:\/(exchange))?$/,
      );
      if (attemptRoute && request.method === "GET" && !attemptRoute[2]) {
        const attempt = await authorizedAttempt(request, store, attemptRoute[1], now);
        return sendJson(response, 200, {
          status: attempt.status,
          nextAction: nextAction(attempt.status),
        });
      }

      if (attemptRoute?.[2] === "exchange" && request.method === "POST") {
        const attempt = await authorizedAttempt(request, store, attemptRoute[1], now);
        if (attempt.verificationPolicy?.providerEnvironment !== providerEnvironment) {
          throw new HttpError(409, "Verification environment changed");
        }
        if (attempt.status !== "approved") {
          throw new HttpError(409, "Verification is not approved");
        }
        if (!accountProvisioningEnabled) {
          throw new HttpError(503, "Account provisioning is disabled");
        }
        const uid = await store.reserveFirebaseUid(attempt.id, createFirebaseUid());
        if (!uid) {
          throw new HttpError(409, "Account provisioning is already in progress");
        }
        let firebaseCustomToken;
        try {
          firebaseCustomToken = await firebaseAuth.provisionAndMint({
            uid,
            email: attempt.email,
          });
          await store.markAccountReady(attempt.id);
        } catch (error) {
          await store.releaseAccountProvisioning(attempt.id);
          throw error;
        }
        return sendJson(response, 200, { firebaseCustomToken });
      }

      if (url.pathname === "/v1/admin/election-configuration") {
        if (!electionConfigurationEnabled) {
          throw new HttpError(503, "Election configuration is disabled");
        }
        const staff = await authorizedStaff(request, firebaseAuth);
        if (staff.verificationAdmin !== true) throw new HttpError(403, "Forbidden");

        if (request.method === "GET") {
          return sendJson(response, 200, {
            configuration: await store.getElectionConfiguration(),
          });
        }
        if (request.method === "PUT") {
          let input;
          try {
            input = validateElectionConfigurationInput(
              parseJson(await readBody(request, JSON_LIMIT)),
            );
          } catch {
            throw new HttpError(400, "Election configuration is invalid");
          }
          try {
            const configuration = await store.saveElectionConfiguration({
              ...input,
              actorUid: staff.uid,
            });
            return sendJson(response, 200, { configuration });
          } catch (error) {
            if (error?.code === "REVISION_CONFLICT") {
              throw new HttpError(409, "Election configuration changed");
            }
            throw error;
          }
        }
      }

      if (url.pathname === "/v1/admin/election-readiness" && request.method === "GET") {
        if (!electionConfigurationEnabled) {
          throw new HttpError(503, "Election configuration is disabled");
        }
        const staff = await authorizedStaff(request, firebaseAuth);
        if (staff.verificationAdmin !== true) throw new HttpError(403, "Forbidden");
        const configuration = await store.getElectionConfiguration();
        if (!configuration) throw new HttpError(404, "Election is not configured");
        try {
          return sendJson(response, 200, {
            readiness: await beleniosClient.getElectionReadiness(configuration.electionUuid),
          });
        } catch {
          throw new HttpError(503, "Election readiness is unavailable");
        }
      }

      if (url.pathname === "/v1/election/current" && request.method === "GET") {
        if (!electionConfigurationEnabled) {
          throw new HttpError(503, "Election configuration is disabled");
        }
        await authorizedIdentity(request, firebaseAuth);
        const configuration = publicElectionConfiguration(
          await store.getElectionConfiguration(),
        );
        if (!configuration) throw new HttpError(404, "Election is not published");
        try {
          const readiness = await beleniosClient.getElectionReadiness(
            configuration.electionUuid,
          );
          return sendJson(response, 200, {
            ...configuration,
            opensAt: readiness.opensAt ?? configuration.opensAt,
            closesAt: readiness.closesAt ?? configuration.closesAt,
            state: readiness.state,
            canVote: readiness.canVote,
          });
        } catch {
          throw new HttpError(503, "Election readiness is unavailable");
        }
      }

      const reviewRoute = url.pathname.match(
        /^\/v1\/admin\/verification-reviews\/(va_[A-Za-z0-9_-]+)\/(decisions|resolution)$/,
      );
      if (reviewRoute && request.method === "POST") {
        if (!manualReviewEnabled) throw new HttpError(503, "Manual review is disabled");
        const staff = await authorizedStaff(request, firebaseAuth);
        const action = reviewRoute[2];
        if (action === "decisions") {
          if (staff.verificationReviewer !== true || staff.verificationAdmin === true) {
            throw new HttpError(403, "Forbidden");
          }
        } else if (staff.verificationAdmin !== true) {
          throw new HttpError(403, "Forbidden");
        }
        const key = idempotencyKey(request);
        const body = parseJson(await readBody(request, JSON_LIMIT));
        const input = {
          id: reviewRoute[1],
          actorUid: staff.uid,
          decision: reviewDecision(body?.decision),
          idempotencyKey: key,
        };
        try {
          const result = action === "decisions"
            ? await store.recordReviewerDecision(input)
            : await store.resolveEscalatedReview(input);
          return sendJson(response, 200, result);
        } catch (error) {
          rethrowReviewError(error);
        }
      }

      if (url.pathname === "/v1/admin/verification-reviews" && request.method === "GET") {
        if (!manualReviewEnabled) throw new HttpError(503, "Manual review is disabled");
        const staff = await authorizedStaff(request, firebaseAuth);
        if (!staffCanViewReview(staff)) throw new HttpError(403, "Forbidden");
        const attempts = await store.listReviewableAttempts(20);
        return sendJson(response, 200, {
          reviews: attempts.map((attempt) => ({
            attemptId: attempt.id,
            maskedEmail: maskedEmail(attempt.email),
            status: attempt.status,
            reviewStage: attempt.reviewStage ?? "awaiting_first_review",
            createdAt: attempt.createdAt,
          })),
        });
      }

      const reviewViewRoute = url.pathname.match(
        /^\/v1\/admin\/verification-reviews\/(va_[A-Za-z0-9_-]+)(?:\/evidence\/(student-card))?$/,
      );
      if (reviewViewRoute && request.method === "GET") {
        if (!manualReviewEnabled) throw new HttpError(503, "Manual review is disabled");
        const staff = await authorizedStaff(request, firebaseAuth);
        if (!staffCanViewReview(staff)) throw new HttpError(403, "Forbidden");
        if (!evidenceService) throw new HttpError(503, "Review evidence is unavailable");
        const attempt = await store.getAttempt(reviewViewRoute[1]);
        if (!attempt) throw new HttpError(404, "Verification attempt not found");
        if (!isReviewableAttempt(attempt, now())) {
          throw new HttpError(409, "Verification attempt is not reviewable");
        }
        if (reviewViewRoute[2] === "student-card") {
          return sendImage(
            response,
            await evidenceService.fetchStudentCard(attempt.referenceId),
          );
        }
        const metadata = await evidenceService.getReviewMetadata(attempt.referenceId);
        return sendJson(response, 200, {
          attemptId: attempt.id,
          maskedEmail: maskedEmail(attempt.email),
          status: attempt.status,
          reviewStage: attempt.reviewStage ?? "awaiting_first_review",
          ...metadata,
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/webhooks/dojah") {
        const rawBody = await readBody(request, WEBHOOK_LIMIT);
        const signature = request.headers["x-dojah-signature"];
        if (!verifyDojahSignature(rawBody, signature, webhookSecret)) {
          throw new HttpError(401, "Invalid webhook signature");
        }

        const event = parseJson(rawBody);
        if (typeof event?.reference_id !== "string" || event.reference_id.length < 11) {
          throw new HttpError(400, "Webhook reference is invalid");
        }
        const attempt = await store.getAttemptByReferenceId(event.reference_id);
        if (!attempt) return sendJson(response, 204);
        if (isTerminalStatus(attempt.status)) return sendJson(response, 204);
        if (attempt.verificationPolicy?.providerEnvironment !== providerEnvironment) {
          return sendJson(response, 204);
        }

        const authoritativeResult = await dojahResolver(event.reference_id);
        const decision = evaluateDojahVerification(
          authoritativeResult,
          attempt,
          attempt.verificationPolicy,
        );
        await store.applyProviderResult(
          attempt.id,
          decision.status,
          decision.reason,
        );
        return sendJson(response, 204);
      }

      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Internal server error";
      return sendJson(response, status, { error: message });
    }
  };
}

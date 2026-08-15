const CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DASHBOARD_HOST = "app.dojah.io";

function approvedUrl(value, allowedHosts, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowedHosts.has(url.hostname)
  ) {
    throw new Error(`${label} URL is invalid`);
  }
  return url;
}

async function readBoundedBody(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("DoJah evidence body is invalid");

  const chunks = [];
  let totalBytes = 0;
  let complete = false;
  try {
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      Number.isFinite(Number(declaredLength)) &&
      Number(declaredLength) > maxBytes
    ) {
      throw new Error("DoJah evidence is too large");
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new Error("DoJah evidence body is invalid");
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error("DoJah evidence is too large");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the validation or stream error that caused cancellation.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

function checkedDetails(details, referenceId) {
  if (!details || details.reference_id !== referenceId) {
    throw new Error("DoJah evidence reference is invalid");
  }
  return details;
}

function studentCardUrl(details) {
  const documents = details.data?.additional_document;
  if (!Array.isArray(documents) || documents.length !== 1) {
    throw new Error("Student-card evidence is unavailable");
  }
  const url = documents[0]?.document_url;
  if (typeof url !== "string" || !url) {
    throw new Error("Student-card evidence is unavailable");
  }
  return url;
}

export function createDojahEvidenceService({
  resolveVerification,
  evidenceHosts,
  fetchImpl = fetch,
  maxBytes = 8 * 1024 * 1024,
}) {
  const allowedHosts = new Set(evidenceHosts);
  if (
    typeof resolveVerification !== "function" ||
    allowedHosts.size === 0 ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1
  ) {
    throw new Error("DoJah evidence configuration is incomplete");
  }

  async function resolve(referenceId) {
    return checkedDetails(await resolveVerification(referenceId), referenceId);
  }

  return {
    async getReviewMetadata(referenceId) {
      const details = await resolve(referenceId);
      const dashboardUrl = approvedUrl(
        details.verification_url,
        new Set([DASHBOARD_HOST]),
        "DoJah dashboard",
      );
      let studentCardAvailable = false;
      try {
        approvedUrl(studentCardUrl(details), allowedHosts, "DoJah evidence");
        studentCardAvailable = true;
      } catch {
        studentCardAvailable = false;
      }
      return { dashboardUrl: dashboardUrl.toString(), studentCardAvailable };
    },

    async fetchStudentCard(referenceId) {
      const details = await resolve(referenceId);
      const url = approvedUrl(
        studentCardUrl(details),
        allowedHosts,
        "DoJah evidence",
      );
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error("DoJah evidence redirect is not permitted");
      }
      if (!response.ok) throw new Error("DoJah evidence fetch failed");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0];
      if (!CONTENT_TYPES.has(contentType)) {
        throw new Error("DoJah evidence content type is invalid");
      }
      const body = await readBoundedBody(response, maxBytes);
      return { contentType, body };
    },
  };
}

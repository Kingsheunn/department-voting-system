const DOJAH_API_HOSTS = new Set(["sandbox.dojah.io", "api.dojah.io"]);
const DEFAULT_DOJAH_IMAGE_HOSTS = ["images.dojah.io"];
const MAX_SELFIE_BYTES = 5 * 1024 * 1024;

function authenticatedRequest(appId, privateKey) {
  return {
    AppId: appId,
    Authorization: privateKey,
  };
}

function selfieUrlFrom(entity, imageHosts) {
  const value = entity?.data?.selfie?.data?.selfie_url ?? entity?.selfie_url;
  if (typeof value !== "string") {
    throw new Error("DoJah selfie evidence is unavailable");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !imageHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("DoJah selfie evidence URL is invalid");
  }
  return url;
}

async function readBoundedBody(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("DoJah selfie evidence is invalid");

  const chunks = [];
  let totalBytes = 0;
  let complete = false;
  try {
    const declaredLength = response.headers?.get("content-length");
    if (
      declaredLength !== null &&
      Number.isFinite(Number(declaredLength)) &&
      Number(declaredLength) > maxBytes
    ) {
      throw new Error("DoJah selfie evidence is invalid");
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new Error("DoJah selfie evidence is invalid");
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error("DoJah selfie evidence is invalid");
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

async function fetchSelfie(fetchImpl, entity, imageHosts) {
  const response = await fetchImpl(selfieUrlFrom(entity, imageHosts), {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  const contentType = response.headers?.get("content-type") ?? "";
  if (
    !response.ok ||
    !contentType.toLowerCase().startsWith("image/")
  ) {
    throw new Error("DoJah selfie evidence retrieval failed");
  }
  const selfie = await readBoundedBody(response, MAX_SELFIE_BYTES);
  if (selfie.length === 0) {
    throw new Error("DoJah selfie evidence is invalid");
  }
  return selfie;
}

function normalizeLiveness(payload) {
  const liveness = payload?.entity?.liveness;
  const probability = liveness?.liveness_probability;
  if (
    typeof liveness?.liveness_check !== "boolean" ||
    typeof probability !== "number" ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 100
  ) {
    throw new Error("DoJah liveness response is invalid");
  }
  return {
    passed: liveness.liveness_check === true && probability > 50,
    probability,
  };
}

function normalizedVerification(entity, liveness) {
  const email = entity.data?.email;
  const id = entity.data?.id;
  const selfie = entity.data?.selfie;
  const additionalDocument = entity.data?.additional_document;
  return {
    reference_id: entity.reference_id,
    verification_status: entity.verification_status,
    status: entity.status,
    data: {
      email: email && {
        status: email.status,
        data: { email: email.data?.email },
      },
      id: id && {
        status: id.status,
        data: {
          id_data: {
            document_number: id.data?.id_data?.document_number,
            document_type: id.data?.id_data?.document_type,
          },
        },
      },
      selfie: selfie && { status: selfie.status },
      additional_document: Array.isArray(additionalDocument)
        ? additionalDocument.map((document) => ({
            document_type: document?.document_type,
          }))
        : additionalDocument,
    },
    liveness,
  };
}

export function createDojahResolver({
  baseUrl,
  appId,
  privateKey,
  imageHosts = DEFAULT_DOJAH_IMAGE_HOSTS,
  fetchImpl = fetch,
}) {
  const root = new URL(baseUrl);
  if (
    root.protocol !== "https:" ||
    !DOJAH_API_HOSTS.has(root.hostname) ||
    root.username ||
    root.password ||
    root.port ||
    root.search ||
    root.hash
  ) {
    throw new Error("DoJah API base URL must be an approved HTTPS endpoint");
  }
  if (!appId || !privateKey) {
    throw new Error("DoJah server configuration is incomplete");
  }
  const approvedImageHosts = new Set(imageHosts);
  if (
    approvedImageHosts.size === 0 ||
    [...approvedImageHosts].some(
      (host) => typeof host !== "string" || !/^[a-z0-9.-]+$/i.test(host),
    )
  ) {
    throw new Error("DoJah image hosts are invalid");
  }

  const resolveDetails = createDojahDetailsResolver({
    baseUrl,
    appId,
    privateKey,
    fetchImpl,
  });

  return async function resolveVerification(referenceId) {
    const entity = await resolveDetails(referenceId);
    if (entity.verification_status !== "Completed") return entity;

    const selfie = await fetchSelfie(fetchImpl, entity, approvedImageHosts);
    const livenessUrl = new URL("/api/v1/ml/liveness", root);
    const livenessResponse = await fetchImpl(livenessUrl, {
      method: "POST",
      headers: {
        ...authenticatedRequest(appId, privateKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({ image: selfie.toString("base64") }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!livenessResponse.ok) throw new Error("DoJah liveness check failed");
    const liveness = normalizeLiveness(await livenessResponse.json());
    return normalizedVerification(entity, liveness);
  };
}

export function createDojahDetailsResolver({ baseUrl, appId, privateKey, fetchImpl = fetch }) {
  const root = new URL(baseUrl);
  if (
    root.protocol !== "https:" ||
    !DOJAH_API_HOSTS.has(root.hostname) ||
    root.username ||
    root.password ||
    root.port ||
    root.search ||
    root.hash
  ) {
    throw new Error("DoJah API base URL must be an approved HTTPS endpoint");
  }
  if (!appId || !privateKey) {
    throw new Error("DoJah server configuration is incomplete");
  }

  return async function resolveDetails(referenceId) {
    const url = new URL("/api/v1/kyc/verification", root);
    url.searchParams.set("reference_id", referenceId);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: authenticatedRequest(appId, privateKey),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("DoJah verification lookup failed");
    const payload = await response.json();
    if (
      !payload?.entity ||
      typeof payload.entity !== "object" ||
      Array.isArray(payload.entity)
    ) {
      throw new Error("DoJah verification response is invalid");
    }
    return payload.entity;
  };
}

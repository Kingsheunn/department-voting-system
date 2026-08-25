const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "OPTIONS"]);
const ATTEMPT_PATH = "/v1/verification-attempts";
const EDGE_AUTH_HEADER = "x-department-edge-auth";
const EDGE_CLIENT_HEADER = "x-department-edge-client";

function corsHeaders(origin) {
  return origin
    ? { "access-control-allow-origin": origin, vary: "Origin" }
    : {};
}

function jsonError(status, error, origin, extraHeaders = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function configuredPortalOrigins(value) {
  if (typeof value !== "string") return null;
  const values = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (values.length === 0) return null;
  const origins = new Set();
  for (const value of values) {
    const origin = configuredOrigin(value);
    if (!origin) return null;
    origins.add(origin.origin);
  }
  return origins;
}

function configuredOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== value ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function fingerprint(secret, clientAddress) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`edge-client:${clientAddress}`)),
  );
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createGateway({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, environment) {
      const upstreamOrigin = configuredOrigin(environment.UPSTREAM_ORIGIN);
      const allowedPortalOrigins = configuredPortalOrigins(environment.ALLOWED_PORTAL_ORIGINS);
      const sharedSecret = environment.ORIGIN_SHARED_SECRET;
      const requestOrigin = request.headers.get("origin");
      const allowedRequestOrigin = allowedPortalOrigins?.has(requestOrigin) ? requestOrigin : null;
      if (!upstreamOrigin || !allowedPortalOrigins ||
          typeof sharedSecret !== "string" || sharedSecret.length < 32) {
        return jsonError(503, "Gateway configuration is unavailable", allowedRequestOrigin);
      }
      if (requestOrigin && !allowedRequestOrigin) {
        return jsonError(403, "Origin is not allowed");
      }

      const incomingUrl = new URL(request.url);
      if (incomingUrl.pathname !== "/healthz" && !incomingUrl.pathname.startsWith("/v1/")) {
        return jsonError(404, "Not found", allowedRequestOrigin);
      }
      if (!ALLOWED_METHODS.has(request.method)) {
        return jsonError(405, "Method not allowed", allowedRequestOrigin, {
          allow: [...ALLOWED_METHODS].join(", "),
        });
      }

      const clientAddress = request.headers.get("cf-connecting-ip");
      if (request.method === "POST" && incomingUrl.pathname === ATTEMPT_PATH) {
        if (!allowedRequestOrigin) {
          return jsonError(403, "Origin is required");
        }
        if (!clientAddress || !environment.ATTEMPT_RATE_LIMITER?.limit) {
          return jsonError(503, "Rate limit is unavailable", allowedRequestOrigin);
        }
        try {
          const result = await environment.ATTEMPT_RATE_LIMITER.limit({ key: clientAddress });
          if (!result.success) {
            return jsonError(429, "Too many verification attempts", allowedRequestOrigin);
          }
        } catch {
          return jsonError(503, "Rate limit is unavailable", allowedRequestOrigin);
        }
      }

      const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, upstreamOrigin);
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete(EDGE_AUTH_HEADER);
      headers.delete(EDGE_CLIENT_HEADER);
      headers.set(EDGE_AUTH_HEADER, sharedSecret);
      if (clientAddress) {
        headers.set(EDGE_CLIENT_HEADER, await fingerprint(sharedSecret, clientAddress));
      }

      const upstreamRequest = new Request(upstreamUrl, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        ...(request.body ? { duplex: "half" } : {}),
      });

      let upstreamResponse;
      try {
        upstreamResponse = await fetchImpl(upstreamRequest, { redirect: "manual" });
      } catch {
        return jsonError(502, "Upstream service is unavailable", allowedRequestOrigin);
      }
      if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
        return jsonError(502, "Upstream service is unavailable", allowedRequestOrigin);
      }
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });
    },
  };
}

export default createGateway();

const DOJAH_API_HOSTS = new Set(["sandbox.dojah.io", "api.dojah.io"]);

export function createDojahResolver({ baseUrl, appId, privateKey, fetchImpl = fetch }) {
  const root = new URL(baseUrl);
  if (
    root.protocol !== "https:" ||
    !DOJAH_API_HOSTS.has(root.hostname) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash
  ) {
    throw new Error("DoJah API base URL must be an approved HTTPS endpoint");
  }
  if (!appId || !privateKey) {
    throw new Error("DoJah server configuration is incomplete");
  }

  return async function resolveVerification(referenceId) {
    const url = new URL("/api/v1/kyc/verification", root);
    url.searchParams.set("reference_id", referenceId);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { AppId: appId, Authorization: privateKey },
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

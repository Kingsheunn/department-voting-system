const exactHttpsOrigin = (value: string | undefined) => {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid API origin");
  }
  if (
    url.protocol !== "https:" ||
    value !== url.origin ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) throw new Error("invalid API origin");
  return value;
};

export const createApiFetch = (
  apiOrigin: string | undefined,
  fetchRequest: typeof fetch = fetch,
): typeof fetch => {
  const origin = exactHttpsOrigin(apiOrigin);
  return (input, init) => {
    if (!origin) return fetchRequest(input, init);
    if (typeof input !== "string" || !input.startsWith("/v1/")) {
      return Promise.reject(new Error("invalid API path"));
    }
    return fetchRequest(`${origin}${input}`, init);
  };
};

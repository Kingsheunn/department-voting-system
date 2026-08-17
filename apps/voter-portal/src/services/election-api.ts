export type PublicElectionConfiguration = {
  title: string;
  publicUrl: string;
  electionUuid: string;
  opensAt: string;
  closesAt: string;
};

export type ElectionApi = {
  getCurrent(idToken: string): Promise<PublicElectionConfiguration | null>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;

const validElection = (value: unknown): value is PublicElectionConfiguration => {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.electionUuid !== "string") {
    return false;
  }
  if (!isIsoTimestamp(value.opensAt) || !isIsoTimestamp(value.closesAt)) return false;
  try {
    const url = new URL(String(value.publicUrl));
    const match = url.pathname.match(/^\/v3\/elections\/([A-Za-z0-9_-]{6,128})\/$/);
    return url.protocol === "https:" &&
      url.hostname === "vote.belenios.org" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      match?.[1] === value.electionUuid;
  } catch {
    return false;
  }
};

export const createElectionApi = (fetchRequest: typeof fetch = fetch): ElectionApi => ({
  getCurrent: async (idToken) => {
    const response = await fetchRequest("/v1/election/current", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("The election service is unavailable. Try again.");
    const body: unknown = await response.json();
    if (!validElection(body)) throw new Error("invalid election response");
    return body;
  },
});

export type ElectionConfiguration = {
  title: string;
  publicUrl: string;
  electionUuid: string;
  opensAt: string;
  closesAt: string;
  voterCount: number;
  rosterReviewed: boolean;
  credentialAuthorityConfirmed: boolean;
  trusteesConfirmed: boolean;
  published: boolean;
  revision: number;
  updatedAt: string;
};

export type ElectionConfigurationInput = Omit<
  ElectionConfiguration,
  "electionUuid" | "revision" | "updatedAt"
> & { expectedRevision: number };

export type ElectionApi = {
  getConfiguration(): Promise<ElectionConfiguration | null>;
  saveConfiguration(input: ElectionConfigurationInput): Promise<ElectionConfiguration>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;

const validBeleniosUrl = (value: unknown, electionUuid: unknown): value is string => {
  if (typeof value !== "string" || typeof electionUuid !== "string") return false;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/v3\/elections\/([A-Za-z0-9_-]{6,128})\/$/);
    return url.protocol === "https:" &&
      url.hostname === "vote.belenios.org" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      match?.[1] === electionUuid;
  } catch {
    return false;
  }
};

const validConfiguration = (value: unknown): value is ElectionConfiguration =>
  isRecord(value) &&
  typeof value.title === "string" &&
  validBeleniosUrl(value.publicUrl, value.electionUuid) &&
  isIsoTimestamp(value.opensAt) &&
  isIsoTimestamp(value.closesAt) &&
  Number.isInteger(value.voterCount) &&
  Number(value.voterCount) >= 1 &&
  Number(value.voterCount) <= 2500 &&
  typeof value.rosterReviewed === "boolean" &&
  typeof value.credentialAuthorityConfirmed === "boolean" &&
  typeof value.trusteesConfirmed === "boolean" &&
  typeof value.published === "boolean" &&
  Number.isInteger(value.revision) &&
  Number(value.revision) >= 1 &&
  isIsoTimestamp(value.updatedAt);

const readResponse = async (response: Response) => {
  if (!response.ok) {
    if (response.status === 409) throw new Error("Election setup changed. Reload and try again.");
    throw new Error("Election setup is unavailable. Try again.");
  }
  return response.json() as Promise<unknown>;
};

export const createElectionApi = (
  getIdToken: () => Promise<string>,
  fetchRequest: typeof fetch = fetch,
): ElectionApi => {
  const headers = async () => ({ Authorization: `Bearer ${await getIdToken()}` });

  return {
    getConfiguration: async () => {
      const body = await readResponse(await fetchRequest("/v1/admin/election-configuration", {
        headers: await headers(),
      }));
      if (!isRecord(body) || !("configuration" in body)) {
        throw new Error("invalid election response");
      }
      if (body.configuration === null) return null;
      if (!validConfiguration(body.configuration)) throw new Error("invalid election response");
      return body.configuration;
    },
    saveConfiguration: async (input) => {
      const body = await readResponse(await fetchRequest("/v1/admin/election-configuration", {
        method: "PUT",
        headers: {
          ...(await headers()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      }));
      if (!isRecord(body) || !validConfiguration(body.configuration)) {
        throw new Error("invalid election response");
      }
      return body.configuration;
    },
  };
};

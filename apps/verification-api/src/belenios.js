const API_BASE = "https://vote.belenios.org/v3/api/";
const API_VERSION = 6;
const MAX_RESPONSE_BYTES = 64 * 1024;
const ELECTION_STATES = new Set([
  "Draft",
  "Open",
  "Closed",
  "Shuffling",
  "EncryptedTally",
  "Tallied",
  "Archived",
]);
const UUID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

const unavailable = () => new Error("Belenios election service is unavailable");

const readJson = async (response) => {
  if (!response.ok || response.redirected) throw unavailable();
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw unavailable();
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw unavailable();
  }
  if (!response.body) throw unavailable();

  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw unavailable();
  }
};

const timestamp = (value) => {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) throw unavailable();
  return date.toISOString();
};

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);

export function createBeleniosClient({ fetchRequest = fetch, timeoutMs = 3_000 } = {}) {
  if (typeof fetchRequest !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Belenios client configuration is invalid");
  }

  return {
    async getElectionReadiness(electionUuid) {
      if (!UUID_PATTERN.test(electionUuid)) {
        throw new Error("Belenios election identifier is invalid");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const request = (path) => fetchRequest(new URL(path, API_BASE), {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      }).then(readJson);

      try {
        const [configuration, status, dates] = await Promise.all([
          request("configuration"),
          request(`elections/${electionUuid}`),
          request(`elections/${electionUuid}/automatic-dates`),
        ]);
        if (
          !isRecord(configuration) ||
          configuration.api_version !== API_VERSION ||
          typeof configuration.belenios_version !== "string" ||
          !configuration.belenios_version.startsWith("3.") ||
          !isRecord(status) ||
          !ELECTION_STATES.has(status.state) ||
          !isRecord(dates)
        ) {
          throw unavailable();
        }
        return {
          state: status.state,
          canVote: status.state === "Open",
          opensAt: timestamp(dates.open),
          closesAt: timestamp(dates.close),
        };
      } catch (error) {
        controller.abort();
        if (error?.message === "Belenios election identifier is invalid") throw error;
        throw unavailable();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

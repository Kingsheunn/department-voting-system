const INPUT_FIELDS = new Set([
  "expectedRevision",
  "title",
  "publicUrl",
  "opensAt",
  "closesAt",
  "voterCount",
  "rosterReviewed",
  "credentialAuthorityConfirmed",
  "trusteesConfirmed",
  "published",
]);

function invalid() {
  throw new Error("Election configuration is invalid");
}

function isoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    invalid();
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) invalid();
  return value;
}

function beleniosElection(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  const match = url.hash.match(/^#([A-Za-z0-9_-]{6,128})$/);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "vote.belenios.org" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/v3/election" ||
    url.search ||
    !match
  ) {
    invalid();
  }
  return { publicUrl: url.toString(), electionUuid: match[1] };
}

export function validateElectionConfigurationInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (Object.keys(value).some((field) => !INPUT_FIELDS.has(field))) invalid();
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (title.length < 3 || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) invalid();
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) invalid();
  if (!Number.isInteger(value.voterCount) || value.voterCount < 1 || value.voterCount > 2500) {
    invalid();
  }
  const readiness = [
    value.rosterReviewed,
    value.credentialAuthorityConfirmed,
    value.trusteesConfirmed,
    value.published,
  ];
  if (readiness.some((flag) => typeof flag !== "boolean")) invalid();
  if (value.published && readiness.slice(0, 3).some((flag) => flag !== true)) invalid();

  const opensAt = isoTimestamp(value.opensAt);
  const closesAt = isoTimestamp(value.closesAt);
  if (Date.parse(opensAt) >= Date.parse(closesAt)) invalid();
  const election = beleniosElection(value.publicUrl);

  return {
    expectedRevision: value.expectedRevision,
    configuration: {
      title,
      ...election,
      opensAt,
      closesAt,
      voterCount: value.voterCount,
      rosterReviewed: value.rosterReviewed,
      credentialAuthorityConfirmed: value.credentialAuthorityConfirmed,
      trusteesConfirmed: value.trusteesConfirmed,
      published: value.published,
    },
  };
}

export function publicElectionConfiguration(configuration) {
  if (!configuration?.published) return null;
  return {
    title: configuration.title,
    publicUrl: configuration.publicUrl,
    electionUuid: configuration.electionUuid,
    opensAt: configuration.opensAt,
    closesAt: configuration.closesAt,
  };
}

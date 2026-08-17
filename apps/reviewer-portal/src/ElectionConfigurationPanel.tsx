import { FormEvent, useEffect, useState } from "react";

import type {
  ElectionApi,
  ElectionConfiguration,
  ElectionConfigurationInput,
} from "./services/election-api";

const LAGOS_OFFSET = "+01:00";

const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  date.setUTCHours(date.getUTCHours() + 1);
  return date.toISOString().slice(0, 16);
};

const toIso = (local: string) => new Date(`${local}:00${LAGOS_OFFSET}`).toISOString();

const blankConfiguration = (): ElectionConfigurationInput => ({
  expectedRevision: 0,
  title: "",
  publicUrl: "",
  opensAt: "",
  closesAt: "",
  voterCount: 1,
  rosterReviewed: false,
  credentialAuthorityConfirmed: false,
  trusteesConfirmed: false,
  published: false,
});

const formValue = (configuration: ElectionConfiguration): ElectionConfigurationInput => ({
  expectedRevision: configuration.revision,
  title: configuration.title,
  publicUrl: configuration.publicUrl,
  opensAt: toLocalInput(configuration.opensAt),
  closesAt: toLocalInput(configuration.closesAt),
  voterCount: configuration.voterCount,
  rosterReviewed: configuration.rosterReviewed,
  credentialAuthorityConfirmed: configuration.credentialAuthorityConfirmed,
  trusteesConfirmed: configuration.trusteesConfirmed,
  published: configuration.published,
});

export default function ElectionConfigurationPanel({ api }: { api: ElectionApi }) {
  const [configuration, setConfiguration] = useState<ElectionConfigurationInput>(blankConfiguration);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    api.getConfiguration()
      .then((saved) => {
        if (active && saved) setConfiguration(formValue(saved));
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Election setup is unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [api]);

  const update = <K extends keyof ElectionConfigurationInput>(
    field: K,
    value: ElectionConfigurationInput[K],
  ) => setConfiguration((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.saveConfiguration({
        ...configuration,
        opensAt: toIso(configuration.opensAt),
        closesAt: toIso(configuration.closesAt),
      });
      setConfiguration(formValue(saved));
      setMessage("Election setup saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Election setup could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="election-setup" aria-labelledby="election-setup-title" aria-busy={loading || saving}>
      <div className="section-heading">
        <p className="overline">Administrator</p>
        <h2 id="election-setup-title">Election setup</h2>
        <p>Publish only the public Belenios election link. Private credentials and trustee keys stay in Belenios.</p>
      </div>
      {loading ? <p role="status">Loading election setup...</p> : (
        <form className="election-form" onSubmit={submit}>
          <label htmlFor="election-title">Election title</label>
          <input
            id="election-title"
            type="text"
            value={configuration.title}
            minLength={3}
            maxLength={120}
            required
            onChange={(event) => update("title", event.target.value)}
          />

          <label htmlFor="election-url">Public Belenios election URL</label>
          <input
            id="election-url"
            type="url"
            value={configuration.publicUrl}
            placeholder="https://vote.belenios.org/v3/elections/.../"
            required
            onChange={(event) => update("publicUrl", event.target.value)}
          />

          <div className="form-grid">
            <div>
              <label htmlFor="election-opens">Opens (Africa/Lagos)</label>
              <input id="election-opens" type="datetime-local" value={configuration.opensAt} required onChange={(event) => update("opensAt", event.target.value)} />
            </div>
            <div>
              <label htmlFor="election-closes">Closes (Africa/Lagos)</label>
              <input id="election-closes" type="datetime-local" value={configuration.closesAt} required onChange={(event) => update("closesAt", event.target.value)} />
            </div>
          </div>

          <label htmlFor="voter-count">Expected voter count</label>
          <input id="voter-count" type="number" min={1} max={2500} value={configuration.voterCount} required onChange={(event) => update("voterCount", Number(event.target.value))} />

          <fieldset className="readiness-checks">
            <legend>Publication checks</legend>
            <label><input type="checkbox" checked={configuration.rosterReviewed} onChange={(event) => update("rosterReviewed", event.target.checked)} />Voter roster reviewed in Belenios</label>
            <label><input type="checkbox" checked={configuration.credentialAuthorityConfirmed} onChange={(event) => update("credentialAuthorityConfirmed", event.target.checked)} />Credential authority configured in Belenios</label>
            <label><input type="checkbox" checked={configuration.trusteesConfirmed} onChange={(event) => update("trusteesConfirmed", event.target.checked)} />Trustees configured in Belenios</label>
            <label><input type="checkbox" checked={configuration.published} onChange={(event) => update("published", event.target.checked)} />Publish this link to verified voters</label>
          </fieldset>

          {error ? <p className="error" role="alert">{error}</p> : null}
          {message ? <p className="success" role="status">{message}</p> : null}
          <button className="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save election setup"}</button>
        </form>
      )}
    </section>
  );
}

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  ReviewDecision,
  ReviewDetail,
  ReviewerApi,
  ReviewSummary,
} from "./services/reviewer-api";
import type { StaffAuthService, StaffSession } from "./services/staff-auth";

type Props = {
  auth: StaffAuthService;
  createApi(getIdToken: () => Promise<string>): ReviewerApi;
};

const stageLabel = (stage: ReviewSummary["reviewStage"]) => ({
  awaiting_first_review: "Awaiting first review",
  awaiting_second_review: "Awaiting second reviewer",
  escalated_review: "Administrator decision required",
  resolved: "Resolved",
})[stage];

function Login({ auth, onSignedIn }: { auth: StaffAuthService; onSignedIn(session: StaffSession): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const session = await auth.signIn(String(data.get("email")), String(data.get("password")));
      if (!session.roles.reviewer && !session.roles.admin) {
        await auth.signOut();
        throw new Error("This account does not have review access.");
      }
      onSignedIn(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-intro" aria-labelledby="login-title">
        <p className="overline">Department Vote · Staff</p>
        <h1 id="login-title">Review student identity checks.</h1>
        <p>Use your pre-provisioned staff account. Evidence is displayed temporarily and is never copied into this portal.</p>
      </section>
      <form className="login-form" onSubmit={submit} aria-busy={busy}>
        <h2>Staff sign in</h2>
        <label htmlFor="email">Staff email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function EvidencePreview({ api, attemptId }: { api: ReviewerApi; attemptId: string }) {
  const [url, setUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setUrl(undefined);
  };

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const view = async () => {
    setBusy(true);
    setError("");
    try {
      const objectUrl = URL.createObjectURL(await api.getStudentCard(attemptId));
      setUrl(objectUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Student ID evidence is unavailable.");
    } finally {
      setBusy(false);
    }
  };

  if (url) return (
    <figure className="evidence-preview">
      <img src={url} alt="Submitted student ID" />
      <button className="secondary" type="button" onClick={close}>Close ID preview</button>
    </figure>
  );

  return (
    <div>
      <button className="secondary" type="button" onClick={view} disabled={busy}>
        {busy ? "Loading ID…" : "View ID temporarily"}
      </button>
      {error ? <p className="error" role="alert">{error} Close this review and retry.</p> : null}
    </div>
  );
}

function ReviewDecisionForm({
  api,
  detail,
  isAdmin,
  onComplete,
}: {
  api: ReviewerApi;
  detail: ReviewDetail;
  isAdmin: boolean;
  onComplete(): Promise<void>;
}) {
  const [decision, setDecision] = useState<ReviewDecision>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const resolving = isAdmin && detail.reviewStage === "escalated_review";
  const canAct = resolving || (!isAdmin && detail.reviewStage !== "escalated_review");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!decision || !canAct) return;
    setBusy(true);
    setMessage("");
    try {
      if (resolving) await api.resolveReview(detail.attemptId, decision);
      else await api.submitDecision(detail.attemptId, decision);
      setDecision(undefined);
      await onComplete();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Decision could not be submitted. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!canAct) return <p className="notice">This case is waiting for the assigned staff role.</p>;

  return (
    <form className="decision-form" onSubmit={submit} aria-busy={busy}>
      <fieldset>
        <legend>{resolving ? "Administrator resolution" : "Your decision"}</legend>
        <label><input type="radio" name="decision" checked={decision === "approve"} onChange={() => setDecision("approve")} />Approve</label>
        <label><input type="radio" name="decision" checked={decision === "reject"} onChange={() => setDecision("reject")} />Reject</label>
      </fieldset>
      {message ? <p className="error" role="alert">{message}</p> : null}
      <button className="primary" type="submit" disabled={!decision || busy}>
        {resolving ? "Resolve review" : "Submit decision"}
      </button>
    </form>
  );
}

function Workspace({
  auth,
  session,
  api,
  onSignedOut,
}: {
  auth: StaffAuthService;
  session: StaffSession;
  api: ReviewerApi;
  onSignedOut(): void;
}) {
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [detail, setDetail] = useState<ReviewDetail>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const loadQueue = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setReviews((await api.listReviews()).reviews);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review queue is unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const open = async (attemptId: string) => {
    setBusy(true);
    setError("");
    try {
      setDetail(await api.getReview(attemptId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review details are unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await auth.signOut();
    onSignedOut();
  };

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div><p className="overline">Department Vote · Staff</p><h1>Verification review</h1></div>
        <button className="text-action" type="button" onClick={signOut}>Sign out</button>
      </header>
      {error ? <p className="error banner" role="alert">{error}</p> : null}
      <div className="workspace" aria-busy={busy}>
        <section className="queue" aria-labelledby="queue-title">
          <h2 id="queue-title">Review queue</h2>
          {reviews.length === 0 && !busy ? <p className="empty">No cases need review.</p> : null}
          <ul>
            {reviews.map((review) => (
              <li key={review.attemptId}>
                <button type="button" onClick={() => void open(review.attemptId)} aria-label={`Review ${review.maskedEmail}`}>
                  <strong>{review.maskedEmail}</strong>
                  <span>{stageLabel(review.reviewStage)}</span>
                  <time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="review" aria-labelledby="review-title">
          {detail ? (
            <>
              <button className="back-action" type="button" onClick={() => setDetail(undefined)}>Back to queue</button>
              <p className="overline">{stageLabel(detail.reviewStage)}</p>
              <h2 id="review-title">{detail.maskedEmail}</h2>
              <p className="privacy-copy">Choose one evidence location. The ID image is fetched only when requested and cleared when closed.</p>
              <div className="evidence-actions">
                {detail.studentCardAvailable ? <EvidencePreview key={detail.attemptId} api={api} attemptId={detail.attemptId} /> : <p>ID preview unavailable.</p>}
                <a className="secondary link" href={detail.dashboardUrl} target="_blank" rel="noopener noreferrer">Open in DoJah dashboard</a>
              </div>
              <ReviewDecisionForm
                api={api}
                detail={detail}
                isAdmin={session.roles.admin}
                onComplete={async () => { setDetail(undefined); await loadQueue(); }}
              />
            </>
          ) : (
            <div className="review-placeholder"><p className="overline">Case details</p><h2 id="review-title">Select a student to begin.</h2><p>No evidence loads until you open a case and explicitly request it.</p></div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function App({ auth, createApi }: Props) {
  const [session, setSession] = useState<StaffSession>();
  const api = useMemo(
    () => session ? createApi(session.getIdToken) : undefined,
    [createApi, session],
  );
  if (!session || !api) return <Login auth={auth} onSignedIn={setSession} />;
  return (
    <Workspace
      auth={auth}
      session={session}
      api={api}
      onSignedOut={() => setSession(undefined)}
    />
  );
}

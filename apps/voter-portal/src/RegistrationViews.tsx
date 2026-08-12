import { useState, type FormEvent } from "react";

import { validateSchoolEmail } from "./domain/school-email";
import type { VerificationStatus } from "./services/registration-api";

export type BusyOperation = "create" | "status" | "account" | null;

const emailErrors = {
  required: "Enter your school email address.",
  "invalid-format": "Enter a valid email address.",
  "wrong-domain": "Use your @students.unilorin.edu.ng address.",
} as const;

export function EmailForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateSchoolEmail(email);
    if (!result.ok) {
      setError(emailErrors[result.code]);
      return;
    }
    setError(null);
    void onSubmit(result.email);
  };

  return (
    <div className="email-step">
      <p className="step-label">Step 1 of 3</p>
      <h2>Confirm your school email</h2>
      <p>We'll use it only to start and bind your verification attempt.</p>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <label htmlFor="school-email">School email address</label>
        <input
          id="school-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "email-error" : "email-help"}
        />
        <p id="email-help" className="field-help">Use the exact student email domain.</p>
        {error ? <p id="email-error" className="field-error" role="alert">{error}</p> : null}
        <button className="primary-action" type="submit" disabled={busy}>
          {busy ? "Starting verification..." : "Continue"}
        </button>
      </form>
      <p className="account-boundary">No voting account is created yet.</p>
    </div>
  );
}

const activeStatuses = new Set<VerificationStatus>([
  "created",
  "in_progress",
  "pending_review",
]);

type VerificationStateProps = {
  status: VerificationStatus;
  busy: BusyOperation;
  onOpen: () => void;
  onCheck: () => Promise<void>;
  onCreateAccount: () => Promise<void>;
  onReset: () => void;
};

export function VerificationState({
  status,
  busy,
  onOpen,
  onCheck,
  onCreateAccount,
  onReset,
}: VerificationStateProps) {
  const active = activeStatuses.has(status);
  const failed = status === "rejected" || status === "abandoned" || status === "expired";

  return (
    <div className="verification-state">
      <ol className="verification-steps" aria-label="Eligibility checks">
        <ProgressStep number="1" title="Confirm school email" detail="Complete" complete />
        <ProgressStep
          number="2"
          title="Check ID and liveness"
          detail={status === "approved" ? "Approved" : failed ? "Needs attention" : "In progress"}
          complete={status === "approved"}
          current={active || failed}
        />
        <ProgressStep
          number="3"
          title="Create your account"
          detail={status === "approved" ? "Ready" : "After approval"}
          current={status === "approved"}
        />
      </ol>

      <p className="status-message" role="status" aria-live="polite">
        {active
          ? "Pending server confirmation"
          : status === "approved"
            ? "Identity checks approved"
            : "Verification needs attention"}
      </p>

      {active ? (
        <div className="actions">
          <button className="primary-action" type="button" onClick={onOpen}>
            Open ID and liveness check
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void onCheck()}
            disabled={busy === "status"}
          >
            {busy === "status" ? "Checking status..." : "Check verification status"}
          </button>
        </div>
      ) : status === "approved" ? (
        <button
          className="primary-action"
          type="button"
          onClick={() => void onCreateAccount()}
          disabled={busy === "account"}
        >
          {busy === "account" ? "Creating your account..." : "Create your voting account"}
        </button>
      ) : (
        <button className="secondary-action" type="button" onClick={onReset}>Start again</button>
      )}
    </div>
  );
}

function ProgressStep({
  number,
  title,
  detail,
  complete = false,
  current = false,
}: {
  number: string;
  title: string;
  detail: string;
  complete?: boolean;
  current?: boolean;
}) {
  return (
    <li
      className="verification-step"
      data-state={complete ? "complete" : current ? "current" : "waiting"}
    >
      <span className="step-marker" aria-hidden="true">{number}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </li>
  );
}

export function SuccessState() {
  return (
    <div className="success-state" role="status">
      <p className="step-label">VERIFICATION COMPLETE</p>
      <h2>Your account is ready.</h2>
      <p>This tab is authenticated for the current session.</p>
    </div>
  );
}

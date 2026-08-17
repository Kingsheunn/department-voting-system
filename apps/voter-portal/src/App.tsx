import { useState } from "react";

import {
  EmailForm,
  SuccessState,
  VerificationState,
  type BusyOperation,
} from "./RegistrationViews";
import type { FirebaseAuthService } from "./services/firebase-auth";
import type { ElectionApi, PublicElectionConfiguration } from "./services/election-api";
import type {
  RegistrationApi,
  VerificationAttempt,
  VerificationStatus,
} from "./services/registration-api";

type AppProps = {
  registration: RegistrationApi;
  firebaseAuth: FirebaseAuthService;
  election: ElectionApi;
  openVerification: (url: string) => void;
};

export default function App({ registration, firebaseAuth, election, openVerification }: AppProps) {
  const [attempt, setAttempt] = useState<VerificationAttempt | null>(null);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [currentElection, setCurrentElection] = useState<PublicElectionConfiguration | null>(null);
  const [busy, setBusy] = useState<BusyOperation>(null);
  const [message, setMessage] = useState<string | null>(null);

  const createAttempt = async (email: string) => {
    setBusy("create");
    setMessage(null);
    try {
      const nextAttempt = await registration.createAttempt(email);
      setAttempt(nextAttempt);
      setStatus(nextAttempt.status);
    } catch {
      setMessage("We could not start verification. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const checkStatus = async () => {
    if (!attempt) return;
    setBusy("status");
    setMessage(null);
    try {
      const result = await registration.getStatus(attempt.attemptId, attempt.claimToken);
      setStatus(result.status);
    } catch {
      setMessage("We could not refresh your status. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const createAccount = async () => {
    if (!attempt || status !== "approved") return;
    setBusy("account");
    setMessage(null);
    try {
      const token = await registration.exchangeFirebaseToken(
        attempt.attemptId,
        attempt.claimToken,
      );
      const session = await firebaseAuth.signInWithCustomToken(token);
      setSignedIn(true);
      try {
        setCurrentElection(await election.getCurrent(await session.getIdToken()));
      } catch {
        setMessage("Your account is ready, but election details are temporarily unavailable.");
      }
    } catch {
      setMessage("Your account could not be created. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const openAttempt = () => {
    if (!attempt) return;
    setMessage(null);
    try {
      openVerification(attempt.verificationUrl);
    } catch {
      setMessage("We could not open verification. Allow pop-ups and try again.");
    }
  };

  const resetAttempt = () => {
    setAttempt(null);
    setStatus(null);
    setMessage(null);
  };

  return (
    <main className="portal-shell">
      <section className="portal-intro" aria-labelledby="portal-heading">
        <p className="overline">YOUR PATH TO THE POLLS</p>
        <h1 id="portal-heading">Three checks. Then you're ready.</h1>
        <p className="intro-copy">
          Use your school details to confirm you're eligible for the department election.
        </p>
        <aside className="privacy-note" aria-label="Privacy information">
          <strong>Private by design</strong>
          <span>Your ID images are not stored in this portal.</span>
        </aside>
      </section>

      <section className="portal-workflow" aria-label="Voter registration">
        {signedIn ? (
          <SuccessState election={currentElection} />
        ) : attempt && status ? (
          <VerificationState
            status={status}
            busy={busy}
            onOpen={openAttempt}
            onCheck={checkStatus}
            onCreateAccount={createAccount}
            onReset={resetAttempt}
          />
        ) : (
          <EmailForm busy={busy === "create"} onSubmit={createAttempt} />
        )}

        {message ? <p className="service-error" role="alert">{message}</p> : null}
        <footer className="belenios-note">Secure voting is handled separately by Belenios.</footer>
      </section>
    </main>
  );
}

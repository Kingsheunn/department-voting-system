import { useMemo, useState, type FormEvent } from "react";
import {
  CheckCircledIcon,
  ChevronRightIcon,
  ClockIcon,
  EnvelopeClosedIcon,
  IdCardIcon,
  InfoCircledIcon,
  LockClosedIcon,
} from "@radix-ui/react-icons";

import { BottomSheet } from "./mobile/BottomSheet";
import { KeyboardInput, useKeyboard } from "./mobile/Keyboard";
import { MobileScroll } from "./mobile/MobileScroll";
import { validateSchoolEmail } from "./eligibility/school-email";
import { buildDojahLaunchUrl, createVerificationReference } from "./verification/dojah-launch";

const DOJAH_WIDGET_ID = import.meta.env.VITE_DOJAH_WIDGET_ID ?? "6a799e050162484635a29b5f";

const getEmailFromUrl = () => {
  const result = validateSchoolEmail(new URLSearchParams(window.location.search).get("email") ?? "");
  return result.ok ? result.email : null;
};

const emailErrorMessages = {
  required: "Enter your school email address.",
  "invalid-format": "Enter a valid email address.",
  "wrong-domain": "Use your @students.unilorin.edu.ng address.",
} as const;

export default function Prototype() {
  const [email, setEmail] = useState<string | null>(getEmailFromUrl);

  return email ? (
    <EligibilityScreen email={email} />
  ) : (
    <EmailScreen onAccepted={setEmail} />
  );
}

function EmailScreen({ onAccepted }: { onAccepted: (email: string) => void }) {
  const keyboard = useKeyboard();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateSchoolEmail(value);

    if (!result.ok) {
      setError(emailErrorMessages[result.code]);
      return;
    }

    keyboard.hide();
    setError(null);
    window.history.replaceState({}, "", `/?email=${encodeURIComponent(result.email)}`);
    onAccepted(result.email);
  };

  return (
    <MobileScroll className="app-screen">
      <main className="screen-content email-screen" aria-labelledby="email-heading">
        <p className="overline">YOUR PATH TO THE POLLS</p>
        <div className="email-icon" aria-hidden="true"><EnvelopeClosedIcon /></div>
        <h1 id="email-heading">Start with your school email.</h1>
        <p className="intro-copy">Use your University of Ilorin student address to begin the eligibility check.</p>

        <form className="email-form" onSubmit={submit} noValidate>
          <label htmlFor="school-email">School email address</label>
          <KeyboardInput
            id="school-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@students.unilorin.edu.ng"
            value={value}
            onBlur={() => keyboard.hide()}
            onChange={(event) => setValue(event.currentTarget.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "school-email-error" : "school-email-help"}
          />
          <p id="school-email-help" className="field-help">Only the exact student email domain is accepted.</p>
          {error ? <p id="school-email-error" className="field-error" role="alert">{error}</p> : null}
          <button className="primary-action email-submit" type="submit">
            <span>Continue</span><ChevronRightIcon aria-hidden="true" />
          </button>
        </form>

        <p className="boundary-note"><LockClosedIcon aria-hidden="true" /> No voting account is created yet.</p>
      </main>
    </MobileScroll>
  );
}

function EligibilityScreen({ email }: { email: string }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [referenceId] = useState(createVerificationReference);
  const verificationUrl = useMemo(
    () => buildDojahLaunchUrl({ widgetId: DOJAH_WIDGET_ID, email, referenceId }),
    [email, referenceId],
  );

  return (
    <>
      <MobileScroll className="app-screen">
        <main className="screen-content eligibility-screen" aria-labelledby="eligibility-heading">
          <p className="overline">YOUR PATH TO THE POLLS</p>
          <h1 id="eligibility-heading">Three checks.<br />{" "}Then you’re ready.</h1>
          <p className="intro-copy">Use your school details to confirm you’re eligible for the department election.</p>

          <ol className="verification-steps" aria-label="Eligibility checks">
            <li className="verification-step complete">
              <span className="step-marker">1</span><span className="step-line solid" aria-hidden="true" />
              <div><h2>Confirm school email</h2><p><CheckCircledIcon aria-hidden="true" /> Complete</p></div>
            </li>
            <li className="verification-step current" aria-current="step">
              <span className="step-marker">2</span><span className="step-line dashed" aria-hidden="true" />
              <div><h2>Check ID and liveness</h2><p><ClockIcon aria-hidden="true" /> Up next</p></div>
            </li>
            <li className="verification-step waiting">
              <span className="step-marker">3</span>
              <div><h2>Create your account</h2><p><ClockIcon aria-hidden="true" /> After approval</p></div>
            </li>
          </ol>

          <section className="privacy-note" aria-labelledby="privacy-heading">
            <span className="privacy-icon" aria-hidden="true"><LockClosedIcon /></span>
            <div><h2 id="privacy-heading">Private by design</h2><p>Your ID images are not stored in this portal.</p></div>
          </section>

          <a className="primary-action" href={verificationUrl} target="_blank" rel="noopener noreferrer">
            <IdCardIcon aria-hidden="true" /><span>Continue to ID check</span><ChevronRightIcon aria-hidden="true" />
          </a>

          <button className="info-action" type="button" onClick={() => setInfoOpen(true)}>
            <InfoCircledIcon aria-hidden="true" /><span>How verification works</span><ChevronRightIcon aria-hidden="true" />
          </button>

          <footer className="belenios-note"><LockClosedIcon aria-hidden="true" /><span>Secure voting is handled by Belenios.</span></footer>
        </main>
      </MobileScroll>

      <BottomSheet
        open={infoOpen}
        onOpenChange={setInfoOpen}
        title="How verification works"
        description="Three independent checks protect access to the election."
        snap={0.58}
      >
        <div className="verification-explainer">
          <p>DoJah checks your student ID and live face. Your school email must use the permitted domain.</p>
          <p>Completion is not the same as approval. Our server confirms the signed DoJah result before Firebase creates your account.</p>
          <p>Belenios handles the ballot separately, so this portal never receives your vote choice.</p>
          <button type="button" className="sheet-close" onClick={() => setInfoOpen(false)}>Got it</button>
        </div>
      </BottomSheet>
    </>
  );
}

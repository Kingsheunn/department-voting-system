import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./app.css";
import { createFirebaseAuthService } from "./services/firebase-auth";
import { createRegistrationApi } from "./services/registration-api";

const DOJAH_ORIGIN = "https://identity.dojah.io";

const openVerification = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== DOJAH_ORIGIN) {
    throw new Error("Invalid verification destination");
  }

  window.open(url.toString(), "_blank", "noopener,noreferrer");
};

const firebaseAuth = createFirebaseAuthService({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App
      registration={createRegistrationApi()}
      firebaseAuth={firebaseAuth}
      openVerification={openVerification}
    />
  </React.StrictMode>,
);

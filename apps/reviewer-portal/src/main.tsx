import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./app.css";
import { createApiFetch } from "./services/api-fetch";
import { createElectionApi } from "./services/election-api";
import { createReviewerApi } from "./services/reviewer-api";
import { createLazyStaffAuthService } from "./services/lazy-staff-auth";

const apiFetch = createApiFetch(import.meta.env.VITE_API_BASE_URL);

const auth = createLazyStaffAuthService(async () => {
  const { createStaffAuthService } = await import("./services/staff-auth");
  return createStaffAuthService(
    {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    },
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL,
  );
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      auth={auth}
      createApi={(getIdToken) => createReviewerApi(getIdToken, apiFetch)}
      createElectionApi={(getIdToken) => createElectionApi(getIdToken, apiFetch)}
    />
  </StrictMode>,
);

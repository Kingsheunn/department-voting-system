export type VerificationStatus =
  | "created"
  | "in_progress"
  | "pending_review"
  | "approved"
  | "rejected"
  | "abandoned"
  | "expired";

export type VerificationStatusResponse = {
  status: VerificationStatus;
  nextAction: string | null;
};

export type VerificationAttempt = {
  attemptId: string;
  claimToken: string;
  verificationUrl: string;
  status: "created";
};

export type RegistrationApi = {
  createAttempt(email: string): Promise<VerificationAttempt>;
  getStatus(attemptId: string, claimToken: string): Promise<VerificationStatusResponse>;
  exchangeFirebaseToken(attemptId: string, claimToken: string): Promise<string>;
};

const DOJAH_ORIGIN = "https://identity.dojah.io";
const STATUSES = new Set<VerificationStatus>([
  "created",
  "in_progress",
  "pending_review",
  "approved",
  "rejected",
  "abandoned",
  "expired",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseDojahUrl = (value: unknown) => {
  if (typeof value !== "string") throw new Error("invalid verification response");

  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== DOJAH_ORIGIN) {
    throw new Error("invalid verification response");
  }

  return url.toString();
};

const parseJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) throw new Error("The registration service is unavailable. Try again.");
  return response.json();
};

const authorization = (claimToken: string) => ({ Authorization: `Bearer ${claimToken}` });
const attemptPath = (attemptId: string) =>
  `/v1/verification-attempts/${encodeURIComponent(attemptId)}`;

export const createRegistrationApi = (fetchRequest: typeof fetch = fetch): RegistrationApi => ({
  createAttempt: async (email) => {
    const body = await parseJson(
      await fetchRequest("/v1/verification-attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );

    if (
      !isRecord(body) ||
      typeof body.attemptId !== "string" ||
      typeof body.claimToken !== "string" ||
      body.status !== "created"
    ) {
      throw new Error("invalid verification response");
    }

    return {
      attemptId: body.attemptId,
      claimToken: body.claimToken,
      verificationUrl: parseDojahUrl(body.verificationUrl),
      status: "created",
    };
  },
  getStatus: async (attemptId, claimToken) => {
    const response = await fetchRequest(attemptPath(attemptId), {
      headers: authorization(claimToken),
    });
    if (response.status === 410) return { status: "expired", nextAction: "restart" };

    const body = await parseJson(response);

    if (
      !isRecord(body) ||
      typeof body.status !== "string" ||
      !STATUSES.has(body.status as VerificationStatus) ||
      (body.nextAction !== null && typeof body.nextAction !== "string")
    ) {
      throw new Error("invalid verification response");
    }

    return {
      status: body.status as VerificationStatus,
      nextAction: body.nextAction,
    };
  },
  exchangeFirebaseToken: async (attemptId, claimToken) => {
    const body = await parseJson(
      await fetchRequest(`${attemptPath(attemptId)}/exchange`, {
        method: "POST",
        headers: authorization(claimToken),
      }),
    );

    if (!isRecord(body) || typeof body.firebaseCustomToken !== "string") {
      throw new Error("invalid verification response");
    }

    return body.firebaseCustomToken;
  },
});

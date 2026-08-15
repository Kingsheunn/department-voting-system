export type ReviewDecision = "approve" | "reject";
export type ReviewStage =
  | "awaiting_first_review"
  | "awaiting_second_review"
  | "escalated_review"
  | "resolved";

export type ReviewSummary = {
  attemptId: string;
  maskedEmail: string;
  status: string;
  reviewStage: ReviewStage;
  createdAt: string;
};

export type ReviewDetail = Omit<ReviewSummary, "createdAt"> & {
  dashboardUrl: string;
  studentCardAvailable: boolean;
};

export type ReviewResult = {
  status: string;
  reviewStage: ReviewStage;
};

export type ReviewerApi = {
  listReviews(): Promise<{ reviews: ReviewSummary[] }>;
  getReview(attemptId: string): Promise<ReviewDetail>;
  getStudentCard(attemptId: string): Promise<Blob>;
  submitDecision(attemptId: string, decision: ReviewDecision): Promise<ReviewResult>;
  resolveReview(attemptId: string, decision: ReviewDecision): Promise<ReviewResult>;
};

const REVIEW_STAGES = new Set<ReviewStage>([
  "awaiting_first_review",
  "awaiting_second_review",
  "escalated_review",
  "resolved",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const reviewPath = (attemptId: string) =>
  `/v1/admin/verification-reviews/${encodeURIComponent(attemptId)}`;

const validSummary = (value: unknown): value is ReviewSummary =>
  isRecord(value) &&
  typeof value.attemptId === "string" &&
  typeof value.maskedEmail === "string" &&
  typeof value.status === "string" &&
  typeof value.reviewStage === "string" &&
  REVIEW_STAGES.has(value.reviewStage as ReviewStage) &&
  typeof value.createdAt === "string";

const validDetail = (value: unknown): value is ReviewDetail => {
  if (
    !isRecord(value) ||
    typeof value.attemptId !== "string" ||
    typeof value.maskedEmail !== "string" ||
    typeof value.status !== "string" ||
    typeof value.reviewStage !== "string" ||
    !REVIEW_STAGES.has(value.reviewStage as ReviewStage) ||
    typeof value.dashboardUrl !== "string" ||
    typeof value.studentCardAvailable !== "boolean"
  ) return false;

  let dashboardUrl: URL;
  try {
    dashboardUrl = new URL(value.dashboardUrl);
  } catch {
    return false;
  }
  return (
    dashboardUrl.protocol === "https:" &&
    dashboardUrl.hostname === "app.dojah.io" &&
    dashboardUrl.port === "" &&
    dashboardUrl.username === "" &&
    dashboardUrl.password === ""
  );
};

const validResult = (value: unknown): value is ReviewResult =>
  isRecord(value) &&
  typeof value.status === "string" &&
  typeof value.reviewStage === "string" &&
  REVIEW_STAGES.has(value.reviewStage as ReviewStage);

const responseBody = async (response: Response) => {
  if (!response.ok) throw new Error("The review service is unavailable. Try again.");
  return response.json() as Promise<unknown>;
};

export const createReviewerApi = (
  getIdToken: () => Promise<string>,
  fetchRequest: typeof fetch = fetch,
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
): ReviewerApi => {
  const authorization = async () => ({ Authorization: `Bearer ${await getIdToken()}` });

  const postDecision = async (
    attemptId: string,
    action: "decisions" | "resolution",
    decision: ReviewDecision,
  ) => {
    const body = await responseBody(
      await fetchRequest(`${reviewPath(attemptId)}/${action}`, {
        method: "POST",
        headers: {
          ...(await authorization()),
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({ decision }),
      }),
    );
    if (!validResult(body)) throw new Error("invalid review response");
    return body;
  };

  return {
    listReviews: async () => {
      const body = await responseBody(
        await fetchRequest("/v1/admin/verification-reviews", {
          headers: await authorization(),
        }),
      );
      if (!isRecord(body) || !Array.isArray(body.reviews) || !body.reviews.every(validSummary)) {
        throw new Error("invalid review response");
      }
      return { reviews: body.reviews };
    },
    getReview: async (attemptId) => {
      const body = await responseBody(
        await fetchRequest(reviewPath(attemptId), { headers: await authorization() }),
      );
      if (!validDetail(body)) throw new Error("invalid review response");
      return body;
    },
    getStudentCard: async (attemptId) => {
      const response = await fetchRequest(`${reviewPath(attemptId)}/evidence/student-card`, {
        headers: await authorization(),
      });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
        throw new Error("Student ID evidence is unavailable. Try again.");
      }
      return response.blob();
    },
    submitDecision: (attemptId, decision) => postDecision(attemptId, "decisions", decision),
    resolveReview: (attemptId, decision) => postDecision(attemptId, "resolution", decision),
  };
};

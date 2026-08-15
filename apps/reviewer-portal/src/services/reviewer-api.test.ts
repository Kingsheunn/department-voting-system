import { describe, expect, it, vi } from "vitest";

import { createReviewerApi } from "./reviewer-api";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("createReviewerApi", () => {
  it("adds the Firebase bearer token to queue and detail requests", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ reviews: [] }))
      .mockResolvedValueOnce(jsonResponse({
        attemptId: "va_one",
        maskedEmail: "s***@students.unilorin.edu.ng",
        status: "pending_review",
        reviewStage: "awaiting_first_review",
        dashboardUrl: "https://app.dojah.io/review/one",
        studentCardAvailable: true,
      }));
    const api = createReviewerApi(() => Promise.resolve("firebase-id-token"), fetchRequest);

    await api.listReviews();
    await api.getReview("va_one");

    expect(fetchRequest).toHaveBeenNthCalledWith(1, "/v1/admin/verification-reviews", {
      headers: { Authorization: "Bearer firebase-id-token" },
    });
    expect(fetchRequest).toHaveBeenNthCalledWith(
      2,
      "/v1/admin/verification-reviews/va_one",
      { headers: { Authorization: "Bearer firebase-id-token" } },
    );
  });

  it("uses an idempotency key for reviewer decisions", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "pending_review", reviewStage: "awaiting_second_review" }),
    );
    const api = createReviewerApi(() => Promise.resolve("token"), fetchRequest, () => "review-key");

    await api.submitDecision("va_one", "approve");

    expect(fetchRequest).toHaveBeenCalledWith(
      "/v1/admin/verification-reviews/va_one/decisions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "Idempotency-Key": "review-key",
        },
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
  });

  it("rejects a dashboard URL outside DoJah", async () => {
    const api = createReviewerApi(
      () => Promise.resolve("token"),
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        attemptId: "va_one",
        maskedEmail: "s***@students.unilorin.edu.ng",
        status: "pending_review",
        reviewStage: "awaiting_first_review",
        dashboardUrl: "https://malicious.example/review/one",
        studentCardAvailable: true,
      })),
    );

    await expect(api.getReview("va_one")).rejects.toThrow("invalid review response");
  });

  it("rejects a DoJah dashboard URL on a custom port", async () => {
    const api = createReviewerApi(
      () => Promise.resolve("token"),
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        attemptId: "va_one",
        maskedEmail: "s***@students.unilorin.edu.ng",
        status: "pending_review",
        reviewStage: "awaiting_first_review",
        dashboardUrl: "https://app.dojah.io:4443/review/one",
        studentCardAvailable: true,
      })),
    );

    await expect(api.getReview("va_one")).rejects.toThrow("invalid review response");
  });
});

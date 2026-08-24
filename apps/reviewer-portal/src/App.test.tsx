import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { ElectionApi, ElectionConfiguration } from "./services/election-api";
import type { ReviewerApi, ReviewDetail } from "./services/reviewer-api";
import type { StaffAuthService } from "./services/staff-auth";

const detail: ReviewDetail = {
  attemptId: "va_one",
  maskedEmail: "s***@students.unilorin.edu.ng",
  status: "pending_review",
  reviewStage: "awaiting_first_review",
  dashboardUrl: "https://app.dojah.io/review/one",
  studentCardAvailable: true,
};

const electionConfiguration: ElectionConfiguration = {
  title: "Department election",
  publicUrl: "https://vote.belenios.org/v3/election#demo-election",
  electionUuid: "demo-election",
  opensAt: "2026-09-01T08:00:00.000Z",
  closesAt: "2026-09-01T16:00:00.000Z",
  voterCount: 120,
  rosterReviewed: true,
  credentialAuthorityConfirmed: true,
  trusteesConfirmed: true,
  published: true,
  revision: 1,
  updatedAt: "2026-08-16T10:00:00.000Z",
};

const createServices = (roles = { reviewer: true, admin: false }) => {
  const api: ReviewerApi = {
    listReviews: vi.fn().mockResolvedValue({ reviews: [{ ...detail, createdAt: "2026-08-12T10:00:00.000Z" }] }),
    getReview: vi.fn().mockResolvedValue(detail),
    getStudentCard: vi.fn().mockResolvedValue(new Blob(["id"], { type: "image/jpeg" })),
    submitDecision: vi.fn().mockResolvedValue({ status: "pending_review", reviewStage: "awaiting_second_review" }),
    resolveReview: vi.fn().mockResolvedValue({ status: "approved", reviewStage: "resolved" }),
  };
  const auth: StaffAuthService = {
    signIn: vi.fn().mockResolvedValue({ roles, getIdToken: vi.fn().mockResolvedValue("token") }),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  const electionApi: ElectionApi = {
    getConfiguration: vi.fn().mockResolvedValue(electionConfiguration),
    getReadiness: vi.fn().mockResolvedValue({
      state: "Open",
      canVote: true,
      opensAt: electionConfiguration.opensAt,
      closesAt: electionConfiguration.closesAt,
    }),
    saveConfiguration: vi.fn().mockResolvedValue({ ...electionConfiguration, revision: 2 }),
  };
  return {
    auth,
    createApi: vi.fn().mockReturnValue(api),
    createElectionApi: vi.fn().mockReturnValue(electionApi),
    api,
    electionApi,
  };
};

const signInAndOpen = async (services: ReturnType<typeof createServices>) => {
  const user = userEvent.setup();
  render(
    <App
      auth={services.auth}
      createApi={services.createApi}
      createElectionApi={services.createElectionApi}
    />,
  );
  await user.type(screen.getByLabelText("Staff email"), "reviewer@example.test");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await user.click(await screen.findByRole("button", { name: /review s\*\*\*@students/i }));
  return user;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("reviewer portal", () => {
  it("does not fetch ID evidence until the reviewer asks to view it", async () => {
    const services = createServices();
    await signInAndOpen(services);

    expect(services.api.getStudentCard).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open in DoJah dashboard" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("revokes the temporary ID URL when the preview closes", async () => {
    const services = createServices();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:student-id");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const user = await signInAndOpen(services);

    await user.click(screen.getByRole("button", { name: "View ID temporarily" }));
    expect(await screen.findByRole("img", { name: "Submitted student ID" })).toHaveAttribute(
      "src",
      "blob:student-id",
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close ID preview" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:student-id");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("img", { name: "Submitted student ID" })).not.toBeInTheDocument();
  });

  it("starts without a selected review decision", async () => {
    const services = createServices();
    await signInAndOpen(services);

    expect(screen.getByRole("radio", { name: "Approve" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Reject" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit decision" })).toBeDisabled();
    expect(services.api.submitDecision).not.toHaveBeenCalled();
  });

  it("uses the admin resolution action for an escalated review", async () => {
    const services = createServices({ reviewer: false, admin: true });
    services.api.getReview = vi.fn().mockResolvedValue({ ...detail, reviewStage: "escalated_review" });
    const user = await signInAndOpen(services);

    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Resolve review" }));

    await waitFor(() => expect(services.api.resolveReview).toHaveBeenCalledWith("va_one", "approve"));
    expect(services.api.submitDecision).not.toHaveBeenCalled();
  });

  it("shows election configuration only to administrators", async () => {
    const admin = createServices({ reviewer: false, admin: true });
    const user = userEvent.setup();
    render(
      <App
        auth={admin.auth}
        createApi={admin.createApi}
        createElectionApi={admin.createElectionApi}
      />,
    );
    await user.type(screen.getByLabelText("Staff email"), "admin@example.test");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Election setup" })).toBeVisible();
    expect(screen.getByLabelText("Election title")).toHaveValue("Department election");
    expect(await screen.findByText("Open — voters can enter the ballot.")).toBeVisible();
    await user.clear(screen.getByLabelText("Election title"));
    await user.type(screen.getByLabelText("Election title"), "Updated election");
    await user.click(screen.getByRole("button", { name: "Save election setup" }));
    await waitFor(() => expect(admin.electionApi.saveConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 1, title: "Updated election" }),
    ));

    cleanup();
    const reviewer = createServices({ reviewer: true, admin: false });
    render(
      <App
        auth={reviewer.auth}
        createApi={reviewer.createApi}
        createElectionApi={reviewer.createElectionApi}
      />,
    );
    await user.type(screen.getByLabelText("Staff email"), "reviewer@example.test");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.queryByRole("heading", { name: "Election setup" })).not.toBeInTheDocument();
  });
});

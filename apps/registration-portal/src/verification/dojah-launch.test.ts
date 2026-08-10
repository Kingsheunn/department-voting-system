import { describe, expect, it } from "vitest";

import {
  buildDojahLaunchUrl,
  createVerificationReference,
  interpretDojahClientEvent,
} from "./dojah-launch";

describe("createVerificationReference", () => {
  it("creates an opaque reference accepted by DoJah", () => {
    const reference = createVerificationReference(() => "018f681d-09c8-7d8c-a8f7-337402ad4c44");

    expect(reference).toBe("DV-018F681D09C87D8CA8F7337402AD4C44");
    expect(reference.length).toBeGreaterThan(10);
  });
});
describe("buildDojahLaunchUrl", () => {
  it("builds an allowlisted widget URL with the verified email and opaque reference", () => {
    const url = new URL(
      buildDojahLaunchUrl({
        widgetId: "widget-123",
        email: "student@students.unilorin.edu.ng",
        referenceId: "DV-018F681D09C87D8CA8F7337402AD4C44",
      }),
    );

    expect(url.origin).toBe("https://identity.dojah.io");
    expect(url.searchParams.get("widget_id")).toBe("widget-123");
    expect(url.searchParams.get("reference_id")).toBe("DV-018F681D09C87D8CA8F7337402AD4C44");
    expect(url.searchParams.get("user_data[email]")).toBe("student@students.unilorin.edu.ng");
  });

  it("rejects missing public widget configuration", () => {
    expect(() =>
      buildDojahLaunchUrl({
        widgetId: "",
        email: "student@students.unilorin.edu.ng",
        referenceId: "DV-018F681D09C87D8CA8F7337402AD4C44",
      }),
    ).toThrow("Dojah widget ID is not configured");
  });
});

describe("interpretDojahClientEvent", () => {
  it("treats a success callback as submitted, never approved", () => {
    expect(interpretDojahClientEvent("success")).toBe("submitted");
  });

  it("maps errors and closure to recoverable client states", () => {
    expect(interpretDojahClientEvent("error")).toBe("retry");
    expect(interpretDojahClientEvent("close")).toBe("abandoned");
  });
});

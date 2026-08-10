const DOJAH_WIDGET_ORIGIN = "https://identity.dojah.io";

type BuildDojahLaunchUrlInput = {
  widgetId: string;
  email: string;
  referenceId: string;
};
export type DojahClientEvent = "loading" | "begin" | "success" | "error" | "close";
export type ClientVerificationState = "ongoing" | "submitted" | "retry" | "abandoned";

export const createVerificationReference = (
  randomUUID: () => string = () => crypto.randomUUID(),
): string => `DV-${randomUUID().replaceAll("-", "").toUpperCase()}`;

export const buildDojahLaunchUrl = ({
  widgetId,
  email,
  referenceId,
}: BuildDojahLaunchUrlInput): string => {
  if (!widgetId.trim()) {
    throw new Error("Dojah widget ID is not configured");
  }

  const url = new URL(DOJAH_WIDGET_ORIGIN);
  url.searchParams.set("widget_id", widgetId);
  url.searchParams.set("reference_id", referenceId);
  url.searchParams.set("user_data[email]", email);
  return url.toString();
};

export const interpretDojahClientEvent = (event: DojahClientEvent): ClientVerificationState => {
  if (event === "success") return "submitted";
  if (event === "error") return "retry";
  if (event === "close") return "abandoned";
  return "ongoing";
};

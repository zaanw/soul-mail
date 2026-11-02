import { isCloudflare } from "./runtime";
export function config() {
  const appUrl = new URL(process.env.APP_URL || "http://localhost:3000");
  const domain = (process.env.MAIL_DOMAIN || "localhost").toLowerCase();
  if (!/^(localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(domain))
    throw new Error("Invalid MAIL_DOMAIN");
  if (
    process.env.NODE_ENV === "production" &&
    appUrl.protocol !== "https:" &&
    appUrl.hostname !== "localhost"
  )
    throw new Error("APP_URL must use HTTPS");
  return {
    appUrl,
    domain,
    smtp:
      (!!process.env.RESEND_API_KEY &&
        !!(process.env.MAIL_FROM || process.env.SMTP_FROM)) ||
      (!isCloudflare() && !!process.env.SMTP_HOST && !!process.env.SMTP_FROM),
    verification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
  };
}
export const folders = [
  "inbox",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
] as const;
export function normalizeAddress(s: string) {
  return s.trim().toLowerCase();
}
export function isInternalAddress(s: string, domain: string) {
  return s.split("@")[1]?.toLowerCase() === domain.toLowerCase();
}

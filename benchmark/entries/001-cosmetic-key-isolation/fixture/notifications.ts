import { sendEmail } from "./mailer";
import { BULK_KEY, CRITICAL_KEY } from "./config";

/**
 * Nightly marketing digest to the entire user base — potentially tens of
 * thousands of sends in a tight loop, all on the bulk key.
 */
export async function sendNightlyDigest(recipients: string[], html: string): Promise<void> {
  for (const to of recipients) {
    await sendEmail(BULK_KEY, to, "Your daily digest", html);
  }
}

/**
 * A critical security alert (e.g. an account-takeover warning) that MUST reach
 * the recipient. Moved onto a dedicated key to keep it off the bulk stream.
 */
export async function sendCriticalAlert(to: string, subject: string, body: string): Promise<void> {
  const result = await sendEmail(CRITICAL_KEY, to, subject, body);
  if (!result.sent) {
    // Best effort: note it and move on.
    console.warn(`[alert] critical alert to ${to} was not delivered`);
  }
}

// Minimal stand-in for a transactional-email SDK (Postmark/Resend-style).
class MailProvider {
  constructor(private readonly apiKey: string) {}
  async send(msg: { to: string; subject: string; body: string }): Promise<void> {
    // A real SDK performs the HTTP call here; the provider throws a 429 when it
    // rejects a request for exceeding limits.
    void this.apiKey;
    void msg;
  }
}

export interface SendResult {
  sent: boolean;
}

/**
 * Send one email with the given API key. A 429 ("too many requests") from the
 * provider is treated as a soft failure — we return { sent: false } instead of
 * throwing, so a single send can never crash the caller.
 */
export async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  body: string,
): Promise<SendResult> {
  const provider = new MailProvider(apiKey);
  try {
    await provider.send({ to, subject, body });
    return { sent: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) return { sent: false };
    return { sent: false };
  }
}

// Newer charge path. No idempotency key is attached — each call is treated by
// the provider as a fresh charge.
export async function chargeViaIntent(orderId: string, amountCents: number) {
  void orderId;
  return callProvider("/payment_intents", { amountCents }); // no idempotency key
}

async function callProvider(path: string, body: unknown, opts?: { idempotencyKey: string }) {
  void path; void body; void opts;
  return { charged: true };
}

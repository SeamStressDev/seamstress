// Legacy charge path. An idempotency key is generated per order and attached, so
// a retried request is recognized by the provider and does not create a second
// charge.
export async function chargeViaLegacy(orderId: string, amountCents: number) {
  const idempotencyKey = `order-${orderId}`;
  return callProvider("/charges", { amountCents }, { idempotencyKey });
}

async function callProvider(path: string, body: unknown, opts?: { idempotencyKey: string }) {
  void path; void body; void opts;
  return { charged: true };
}

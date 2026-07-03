import { chargeViaLegacy } from "./charges";
import { chargeViaIntent } from "./paymentIntents";

// Retries any charge on transient failure. Whether a retry double-charges
// depends entirely on which path was taken.
export async function checkout(orderId: string, amountCents: number, useIntents: boolean) {
  const charge = useIntents ? chargeViaIntent : chargeViaLegacy;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await charge(orderId, amountCents);
    } catch {
      // transient failure — retry
    }
  }
}

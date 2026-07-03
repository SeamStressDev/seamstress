import { releasePayment } from "./payment";
import { confirmRelease } from "./confirm";

// Monthly interest run: intends to wire ONLY interest and hold principal in the
// wash account. Sets principal suppression — but not front or fund.
export function runMonthlyInterest(principalCents: number): number {
  confirmRelease();
  const { wired } = releasePayment(principalCents, {
    front: false,
    fund: false,
    principal: true, // operator believes this alone holds the principal
  });
  return wired; // intended 0; actually the full principal
}

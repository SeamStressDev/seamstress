// Confirmation guard shown before release. It warns that funds leave the bank
// but shows neither the amount nor whether this is the intended interest payment
// or the full principal — it cannot distinguish the safe case from the
// catastrophic one.
export function confirmRelease(): boolean {
  console.warn("Account is a Wire Account and funds will be sent out of the bank. Continue?");
  return true; // operator clicks through
}

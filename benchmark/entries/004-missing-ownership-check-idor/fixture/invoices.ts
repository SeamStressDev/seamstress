type Invoice = { id: number; ownerId: string; amountCents: number };
const invoices: Invoice[] = [];

// Neighboring route that DOES scope to the owner — so the absent check in
// getDocument reads as an omission, not the codebase's house style.
export function getInvoice(requesterId: string, invoiceId: number): Invoice | undefined {
  const inv = invoices.find((i) => i.id === invoiceId);
  if (!inv || inv.ownerId !== requesterId) return undefined;
  return inv;
}

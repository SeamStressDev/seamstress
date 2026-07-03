// In-memory store backing the support-ticket endpoints. Swapped for the DB
// adapter in production builds; ids follow the same scheme either way.

export type Ticket = { id: number; openedBy: string; subject: string };

export type Attachment = {
  id: number;
  ticketId: number;
  uploadedBy: string;
  filename: string;
  contentType: string;
  data: string;
};

const tickets: Ticket[] = [
  { id: 310, openedBy: "u_2054", subject: "Invoice PDF renders blank" },
  { id: 312, openedBy: "u_1198", subject: "App crashes on export" },
];

const attachments: Attachment[] = [
  { id: 4471, ticketId: 310, uploadedBy: "u_2054", filename: "invoice-march.pdf", contentType: "application/pdf", data: "JVBERi0xLjQK" },
  { id: 4472, ticketId: 310, uploadedBy: "u_2054", filename: "render-screenshot.png", contentType: "image/png", data: "iVBORw0KGgo" },
  { id: 4473, ticketId: 312, uploadedBy: "u_1198", filename: "crash-log.txt", contentType: "text/plain", data: "RXJyb3I6IGV4cG9ydCBmYWlsZWQK" },
];

// Attachment ids are sequential; the counter picks up after the seed rows.
let nextAttachmentId = 4474;

export function insertAttachment(
  ticketId: number,
  uploadedBy: string,
  filename: string,
  contentType: string,
  data: string,
): Attachment {
  const row = { id: nextAttachmentId++, ticketId, uploadedBy, filename, contentType, data };
  attachments.push(row);
  return row;
}

export function findAttachment(id: number): Attachment | undefined {
  return attachments.find((a) => a.id === id);
}

export function attachmentsForTicket(ticketId: number): Attachment[] {
  return attachments.filter((a) => a.ticketId === ticketId);
}

export function ticketsOpenedBy(userId: string): Ticket[] {
  return tickets.filter((t) => t.openedBy === userId);
}

export function attachmentCount(): number {
  return attachments.length;
}

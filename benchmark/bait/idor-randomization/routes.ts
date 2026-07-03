// Handlers for the ticket-attachment endpoints. `session` is set by the auth
// middleware upstream; unauthenticated requests never reach these.

import {
  attachmentCount,
  attachmentsForTicket,
  findAttachment,
  insertAttachment,
  ticketsOpenedBy,
} from "./store";

export type Session = { userId: string };

type DownloadEvent = { userId: string; attachmentId: number };
const downloadLog: DownloadEvent[] = [];

// "My tickets" screen: tickets the signed-in user opened.
export function listMyTickets(session: Session) {
  return { status: 200, body: ticketsOpenedBy(session.userId) };
}

// Attachment strip on the ticket-detail view.
export function listTicketAttachments(session: Session, ticketId: number) {
  const rows = attachmentsForTicket(ticketId).map((a) => ({
    id: a.id,
    filename: a.filename,
    contentType: a.contentType,
  }));
  return { status: 200, body: rows };
}

// Raw attachment bytes for the download link on the ticket-detail view.
export function downloadAttachment(session: Session, attachmentId: number) {
  const att = findAttachment(attachmentId);
  if (!att) return { status: 404 };
  downloadLog.push({ userId: session.userId, attachmentId: att.id });
  return { status: 200, contentType: att.contentType, body: att.data };
}

export function uploadAttachment(
  session: Session,
  ticketId: number,
  filename: string,
  contentType: string,
  data: string,
) {
  const row = insertAttachment(ticketId, session.userId, filename, contentType, data);
  return { status: 201, body: { id: row.id, filename: row.filename } };
}

// Lightweight numbers for the support dashboard header.
export function getQueueStats(_session: Session) {
  return { status: 200, body: { totalAttachments: attachmentCount() } };
}

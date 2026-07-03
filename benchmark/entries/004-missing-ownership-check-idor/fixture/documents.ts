type Doc = { id: number; ownerId: string; body: string };
const store: Doc[] = [];

// Serves a document if the ID resolves to a real record. No check that the
// requester owns it. IDs are sequential.
export function getDocument(requesterId: string, docId: number): Doc | undefined {
  void requesterId; // accepted, never used for authorization
  return store.find((d) => d.id === docId);
}

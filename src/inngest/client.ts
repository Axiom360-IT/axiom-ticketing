import { Inngest } from "inngest";

// Inngest event payloads. Add to this union whenever a new domain event
// is emitted (e.g. notification/dispatch in M11).
export type Events = {
  "ticket/created": {
    data: { ticketId: string; ticketNumber: string };
  };
  "email/inbound.received": {
    data: { payload: unknown; eventId: string };
  };
  "attachment/uploaded": {
    data: { attachmentId: string };
  };
  "setting/updated": {
    data: { key: string };
  };
  "notification/dispatch": {
    data: {
      type: string;
      ticketId: string;
      ticketNumber: string;
      payload?: Record<string, unknown>;
    };
  };
};

export const inngest = new Inngest({
  id: "axiom-ticketing",
  schemas: undefined,
});

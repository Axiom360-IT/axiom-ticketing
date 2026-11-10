import { describe, expect, it } from "vitest";
import type { NotificationDispatchPayload } from "@/inngest/client";
import { planDelivery, type PreferenceRow, type Recipient } from "./plan";

const tech: Recipient = {
  id: "tech",
  email: "tech@axiom360.it",
  phone: "+15550001",
  language: "en",
};
const customer: Recipient = {
  id: "cust",
  email: "cust@client.com",
  phone: "+15550002",
  language: "en",
};

const payload = (
  over: Partial<NotificationDispatchPayload> = {},
): NotificationDispatchPayload => ({
  type: "ticket.assigned",
  email: {
    template: {
      template: "ticket_created_staff",
      data: {
        ticketNumber: "T-1",
        customerName: "C",
        subject: "S",
        adminUrl: "https://x/y",
      },
    },
    ticketNumber: "T-1",
  },
  sms: {
    template: {
      template: "ticket_created",
      data: { ticketNumber: "T-1", ticketUrl: "https://x/y" },
    },
  },
  inApp: { titleArgs: { ticketNumber: "T-1" }, linkUrl: "/admin/tickets/1" },
  ...over,
});

const base = {
  preferences: [] as PreferenceRow[],
  customerIds: new Set<string>(),
  customerSmsEnabled: true,
};

describe("planDelivery", () => {
  it("sends bell + email + SMS to a staff member with no stored preferences", () => {
    const p = planDelivery({ ...base, data: payload(), recipients: [tech] });
    expect(p.emails.map((e) => e.to)).toEqual(["tech@axiom360.it"]);
    expect(p.sms.map((s) => s.to)).toEqual(["+15550001"]);
    expect(p.inApp.map((r) => r.userId)).toEqual(["tech"]);
    expect(p.dispatched).toBe(1);
  });

  it("honours a recipient's own switches, channel by channel", () => {
    const p = planDelivery({
      ...base,
      data: payload(),
      recipients: [tech],
      preferences: [
        { userId: "tech", emailEnabled: false, smsEnabled: true, inAppEnabled: true },
      ],
    });
    expect(p.emails).toEqual([]);
    expect(p.sms).toHaveLength(1);
    expect(p.inApp).toHaveLength(1);
  });

  it("does not text a customer who never opted in, but does for staff", () => {
    const p = planDelivery({
      ...base,
      data: payload(),
      recipients: [tech, customer],
      customerIds: new Set(["cust"]),
    });
    expect(p.sms.map((s) => s.to)).toEqual(["+15550001"]);
    expect(p.emails).toHaveLength(2);
  });

  it("texts a customer who opted in, unless the global customer-SMS switch is off", () => {
    const optedIn: PreferenceRow[] = [
      { userId: "cust", emailEnabled: true, smsEnabled: true, inAppEnabled: true },
    ];
    const on = planDelivery({
      ...base,
      data: payload(),
      recipients: [customer],
      customerIds: new Set(["cust"]),
      preferences: optedIn,
    });
    expect(on.sms).toHaveLength(1);

    const off = planDelivery({
      ...base,
      data: payload(),
      recipients: [customer],
      customerIds: new Set(["cust"]),
      preferences: optedIn,
      customerSmsEnabled: false,
    });
    expect(off.sms).toEqual([]);
    // The switch only affects SMS.
    expect(off.emails).toHaveLength(1);
  });

  it("skips a channel when the recipient has no address for it", () => {
    const p = planDelivery({
      ...base,
      data: payload(),
      recipients: [{ ...tech, email: null, phone: null }],
    });
    expect(p.emails).toEqual([]);
    expect(p.sms).toEqual([]);
    expect(p.inApp).toHaveLength(1);
  });

  it("only plans the channels the producer supplied", () => {
    const p = planDelivery({
      ...base,
      data: payload({ email: undefined, sms: undefined }),
      recipients: [tech],
    });
    expect(p.emails).toEqual([]);
    expect(p.sms).toEqual([]);
    expect(p.inApp).toHaveLength(1);
  });

  it("carries the producer's reply-to-ticket flag onto the email", () => {
    const d = payload();
    d.email = { ...d.email!, replyToTicket: true };
    const p = planDelivery({ ...base, data: d, recipients: [tech] });
    expect(p.emails[0].replyToTicket).toBe(true);
  });

  it("plans nothing for nobody", () => {
    const p = planDelivery({ ...base, data: payload(), recipients: [] });
    expect(p).toEqual({ emails: [], sms: [], inApp: [], dispatched: 0 });
  });

  describe("organization mutes", () => {
    it("silences exactly the muted channel and leaves the others", () => {
      const p = planDelivery({
        ...base,
        data: payload(),
        recipients: [tech],
        orgAllowance: { email: false, sms: true, inApp: true },
      });
      expect(p.emails).toEqual([]);
      expect(p.sms).toHaveLength(1);
      expect(p.inApp).toHaveLength(1);
    });

    it("can silence every channel", () => {
      const p = planDelivery({
        ...base,
        data: payload(),
        recipients: [tech, customer],
        customerIds: new Set(["cust"]),
        orgAllowance: { email: false, sms: false, inApp: false },
      });
      expect(p.emails).toEqual([]);
      expect(p.sms).toEqual([]);
      expect(p.inApp).toEqual([]);
    });

    it("never turns ON something the person switched off (it only subtracts)", () => {
      const p = planDelivery({
        ...base,
        data: payload(),
        recipients: [tech],
        preferences: [
          { userId: "tech", emailEnabled: false, smsEnabled: false, inAppEnabled: false },
        ],
        orgAllowance: { email: true, sms: true, inApp: true },
      });
      expect(p.emails).toEqual([]);
      expect(p.sms).toEqual([]);
      expect(p.inApp).toEqual([]);
    });

    it("does not enable customer SMS just because the org allows it", () => {
      const p = planDelivery({
        ...base,
        data: payload(),
        recipients: [customer],
        customerIds: new Set(["cust"]),
        orgAllowance: { email: true, sms: true, inApp: true },
      });
      expect(p.sms).toEqual([]);
    });

    it("behaves as before when no organization applies", () => {
      const a = planDelivery({ ...base, data: payload(), recipients: [tech] });
      const b = planDelivery({
        ...base,
        data: payload(),
        recipients: [tech],
        orgAllowance: undefined,
      });
      expect(a).toEqual(b);
    });
  });
});

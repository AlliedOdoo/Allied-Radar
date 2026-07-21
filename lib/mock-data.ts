export const sourceHealth = [
  { name: "Outlook", count: 18, tone: "blue" },
  { name: "Teams", count: 9, tone: "green" },
  { name: "Odoo Discuss", count: 6, tone: "yellow" },
  { name: "WhatsApp", count: 12, tone: "red" },
];

export const smartViews = [
  { label: "Needs reply", count: 7, active: true },
  { label: "Waiting on me", count: 4, active: false },
  { label: "Waiting on them", count: 6, active: false },
  { label: "Today", count: 15, active: false },
  { label: "Opportunities", count: 3, active: false },
];

export const people = [
  { name: "John Smith", initials: "JS", context: "Quote request" },
  { name: "Neil", initials: "NL", context: "Ticket escalation" },
  { name: "Sarah", initials: "SA", context: "Contract loop" },
  { name: "Rael", initials: "RP", context: "Design review" },
];

export const topics = [
  "Quotes",
  "Approvals",
  "Odoo",
  "Follow-ups",
  "Contracts",
  "Billing",
  "Ops risk",
];

export const messages = [
  {
    id: "msg-001",
    source: "WhatsApp" as const,
    destination: "+27825550118",
    destinationLabel: "John Smith (+27 82 555 0118)",
    subject: undefined,
    contact: "John Smith",
    initials: "JS",
    title: "Needs quote before close of business",
    summary:
      "John asked for pricing on the rental extension and mentioned the client wants confirmation today.",
    reason: "You were asked a direct question and the message includes a same-day deadline.",
    detail:
      "John has followed up twice about rental pricing. The important bit is not the greeting — it is the deadline and the fact that the customer is waiting on a firm number.",
    priority: "critical",
    priorityLabel: "Critical",
    status: "Unread",
    nextAction: "Draft reply",
    time: "12 min ago",
    dateGroup: "Today",
    displayDate: "17 Jul 2026",
    displayTime: "10:44",
    receivedAt: "2026-07-17T10:44:00+02:00",
    lastContact: "Today at 10:44",
    openLoops: "Quote, ETA, approval owner",
    draft:
      "Hi John — I’m checking the rental extension pricing now and will confirm the number before close of business. If anything needs approval, I’ll flag it clearly before we commit.",
  },
  {
    id: "msg-002",
    source: "Odoo Discuss" as const,
    destination: "42",
    destinationLabel: "Sales Ops / Deliveries",
    contact: "Sales Ops",
    initials: "SO",
    title: "SO00052 approved but waiting on delivery note",
    summary:
      "The quote was approved in Odoo, but delivery documentation has not been attached yet.",
    reason: "This can block fulfilment if the delivery note is missed.",
    detail:
      "Odoo indicates the commercial approval is done. The next operational step is the document attachment and confirmation back to the team.",
    priority: "high",
    priorityLabel: "Needs reply",
    status: "Waiting on you",
    nextAction: "Confirm docs",
    time: "38 min ago",
    dateGroup: "Today",
    displayDate: "17 Jul 2026",
    displayTime: "10:18",
    receivedAt: "2026-07-17T10:18:00+02:00",
    lastContact: "Today at 10:18",
    openLoops: "Delivery note",
    draft:
      "Approved noted. I’ll attach/check the delivery note and confirm once the pack is complete.",
  },
  {
    id: "msg-003",
    source: "Outlook" as const,
    destination: "sarah@example.com",
    destinationLabel: "Sarah M. (sarah@example.com)",
    subject: "Re: Contract clause feedback",
    contact: "Sarah M.",
    initials: "SM",
    title: "Contract clause feedback requested",
    summary:
      "Sarah asked whether the liability wording is acceptable before the revised contract goes out.",
    reason: "This references a contract deadline and asks for your decision.",
    detail:
      "The decision needed is whether to accept the proposed wording or route it for legal review.",
    priority: "high",
    priorityLabel: "Review",
    status: "Unread",
    nextAction: "Draft position",
    time: "1h ago",
    dateGroup: "Today",
    displayDate: "17 Jul 2026",
    displayTime: "09:52",
    receivedAt: "2026-07-17T09:52:00+02:00",
    lastContact: "Yesterday",
    openLoops: "Clause review",
    draft:
      "Thanks Sarah — I’m reviewing the clause now. My instinct is to be cautious on the liability wording, so I’ll confirm whether we can accept it or need a legal pass before it goes out.",
  },
  {
    id: "msg-004",
    source: "Teams" as const,
    destination: "19:allied-demo-chat@thread.v2",
    destinationLabel: "Neil / Ticket #4321",
    contact: "Neil",
    initials: "NL",
    title: "Ticket #4321 may need escalation",
    summary:
      "Neil shared that the customer is still blocked and asked whether to escalate internally.",
    reason: "A customer-facing issue is unresolved and waiting on a decision.",
    detail:
      "The message is not urgent by timestamp alone, but the customer impact makes it worth surfacing.",
    priority: "medium",
    priorityLabel: "Potential risk",
    status: "Read",
    nextAction: "Suggest next step",
    time: "2h ago",
    dateGroup: "Yesterday",
    displayDate: "16 Jul 2026",
    displayTime: "16:27",
    receivedAt: "2026-07-16T16:27:00+02:00",
    lastContact: "Today",
    openLoops: "Escalation decision",
    draft:
      "Let’s escalate #4321 internally, but keep the customer update simple: we’re investigating with the right team and will come back with the next concrete step.",
  },
];

export const actionItems = [
  "Confirm quote amount before close of business",
  "Check whether approval is needed",
  "Review the recipient and message before sending",
];

export const draftOptions = [
  "Shorten",
  "Make warmer",
  "Make firmer",
  "Add context",
  "Extract actions",
];

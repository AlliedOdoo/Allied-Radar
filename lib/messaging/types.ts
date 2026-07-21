export const MESSAGE_PROVIDERS = [
  "Outlook",
  "Teams",
  "Odoo Discuss",
  "WhatsApp",
] as const;

export type MessageProvider = (typeof MESSAGE_PROVIDERS)[number];

export type OutboundMessage = {
  provider: MessageProvider;
  destination: string;
  destinationLabel: string;
  content: string;
  subject?: string;
  replyToId?: string;
  replyMode?: "reply" | "reply_all";
  cc?: string[];
  bcc?: string[];
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  attachments?: Array<{
    name: string;
    contentType: string;
    contentBytes: string;
    size: number;
  }>;
  clientRequestId: string;
};

export type ConfirmedSendRequest = OutboundMessage & {
  confirmationToken?: string;
  confirmation: {
    action: "send_now";
    recipient: string;
    reviewed: true;
  };
};

export type SendResult = {
  provider: MessageProvider;
  state: "accepted" | "sent" | "handoff";
  providerMessageId?: string;
  handoffUrl?: string;
  handoffId?: string;
  handoffExpiresAt?: string;
  pushQueued?: boolean;
  detail: string;
};

export type ProviderStatus = {
  provider: MessageProvider;
  configured: boolean;
  delivery: "api" | "handoff";
  detail: string;
};

export class MessagingError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "MessagingError";
    this.code = code;
    this.status = status;
  }
}

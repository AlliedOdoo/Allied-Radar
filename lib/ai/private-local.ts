type ContextMessage = {
  source?: string;
  contact?: string;
  title?: string;
  summary?: string;
  detail?: string;
  reason?: string;
  status?: string;
  time?: string;
};

function clean(value?: string | null, fallback = "") {
  return value?.replace(/\s+/g, " ").trim() || fallback;
}

function sentence(value: string, max = 240) {
  const text = clean(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  return `${clipped.slice(0, Math.max(0, clipped.lastIndexOf(" ")))}...`;
}

function likelyAction(text: string) {
  const lower = text.toLowerCase();
  if (/(quote|price|pricing|cost|estimate)/.test(lower)) return "Confirm pricing or prepare a quote.";
  if (/(approve|approval|sign off|authori[sz]e)/.test(lower)) return "Check whether approval is needed.";
  if (/(urgent|today|close of business|asap|deadline)/.test(lower)) return "Treat this as time-sensitive.";
  if (/(attachment|attached|document|contract|invoice)/.test(lower)) return "Check the related document or attachment.";
  if (/(meeting|call|schedule|calendar)/.test(lower)) return "Confirm timing or next meeting details.";
  return "Decide whether a reply or follow-up is needed.";
}

export function runPrivateDraft(input: {
  message: string;
  tone?: "warm" | "firm" | "short" | "detailed";
  instruction?: string;
  context?: string;
}) {
  const source = clean(input.message);
  const context = clean(input.context);
  const action = likelyAction(`${source} ${context} ${input.instruction ?? ""}`);

  if (input.tone === "short") {
    return "Hi - thanks for the message. I'm checking this now and will come back to you shortly.";
  }

  if (input.tone === "firm") {
    return [
      "Hi,",
      "",
      "Thanks for the message. I'm reviewing the details now and will confirm the next step once I've checked the required information.",
      "",
      action,
      "",
      "Kind regards,",
    ].join("\n");
  }

  if (input.tone === "detailed") {
    return [
      "Hi,",
      "",
      "Thanks for the message. I'm going through the details and checking the related context before I respond properly.",
      "",
      `From what I can see, the main point is: ${sentence(source, 280)}`,
      context ? `Relevant context: ${sentence(context, 260)}` : "",
      `Next step: ${action}`,
      "",
      "I'll come back with a clear answer shortly.",
      "",
      "Kind regards,",
    ].filter(Boolean).join("\n");
  }

  return [
    "Hi,",
    "",
    "Thanks for the message. I'm checking this now and will come back to you shortly with a clear answer.",
    "",
    action,
    "",
    "Kind regards,",
  ].join("\n");
}

export function runPrivateSearch(query: string) {
  const terms = clean(query)
    .split(/\s+/)
    .filter((term) => term.length > 2);
  const topics = terms.filter((term) => !/^(the|and|for|with|from|this|that|what|when|where)$/i.test(term)).slice(0, 8);
  const likelyPeople = terms.filter((term) => /^[A-Z][a-z]+/.test(term)).slice(0, 5);
  return {
    expandedQuery: clean(query),
    likelyPeople,
    topics,
    filters: {
      source: null,
      needsReply: /(reply|respond|answer|follow.?up)/i.test(query),
      urgent: /(urgent|today|asap|deadline|close of business)/i.test(query),
    },
  };
}

export function runPrivateChat(input: {
  question: string;
  selectedMessage?: ContextMessage | null;
  inboxMessages?: ContextMessage[];
}) {
  const question = clean(input.question).toLowerCase();
  const selected = input.selectedMessage;
  const inbox = input.inboxMessages ?? [];
  const focus = selected
    ? `${selected.contact || "Selected sender"}: ${selected.summary || selected.detail || selected.title || "No detail available."}`
    : "";

  if (/catch|summary|summari[sz]e|missed|recap/.test(question)) {
    const items = inbox.slice(0, 6).map((message, index) =>
      `${index + 1}. ${message.contact || message.source || "Unknown"} - ${sentence(message.summary || message.detail || message.title || "", 150)}`,
    );
    return items.length
      ? `Here's the private catch-up from the visible inbox:\n\n${items.join("\n")}`
      : "I don't have visible inbox context to summarize yet. Sync your inbox or select a thread first.";
  }

  if (/need.*reply|reply|respond|answer/.test(question)) {
    const candidates = inbox
      .filter((message) => /(asked|please|can you|confirm|need|waiting|quote|approve|urgent)/i.test(`${message.summary} ${message.detail}`))
      .slice(0, 6)
      .map((message, index) => `${index + 1}. ${message.contact || message.source || "Unknown"} - ${sentence(message.summary || message.detail || "", 150)}`);
    return candidates.length
      ? `These look most likely to need a reply:\n\n${candidates.join("\n")}`
      : "I don't see an obvious reply-needed item in the visible messages. Open a thread if you want me to assess that specific conversation.";
  }

  if (/draft|write|compose/.test(question)) {
    return runPrivateDraft({
      message: selected?.detail || selected?.summary || focus || "the selected conversation",
      tone: "warm",
      context: selected?.reason,
    });
  }

  if (selected) {
    return [
      `For the selected thread, the main point is: ${sentence(focus, 260)}`,
      `Suggested next step: ${likelyAction(`${selected.summary} ${selected.detail} ${selected.reason}`)}`,
    ].join("\n");
  }

  return 'I can help privately with catch-up, reply-needed checks, and draft wording from the visible inbox context. Ask "catch me up" or select a thread.';
}

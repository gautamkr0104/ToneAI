import type {
  AccountRef,
  ExternalConversation,
  ExternalMessage,
  MessagingProvider,
  SendResult,
} from "./provider.js";

/**
 * MockInstagramProvider — full functionality without real Instagram
 * credentials. Used for development, tests and demos. Implements the exact
 * same interface as InstagramProvider so the rest of the system is
 * provider-agnostic.
 */
interface MockThread {
  participantName: string;
  isKnownContact: boolean;
  messages: ExternalMessage[];
}

const HOUR = 3600_000;

function msg(
  id: string,
  sender: "them" | "me",
  text: string,
  ageHours: number,
): ExternalMessage {
  return {
    externalId: id,
    sender,
    text,
    timestamp: new Date(Date.now() - ageHours * HOUR).toISOString(),
  };
}

export function defaultMockThreads(): MockThread[] {
  return [
    {
      participantName: "Aarav",
      isKnownContact: true,
      messages: [
        msg("m1", "them", "bro are you coming tonight?", 5),
        msg("m2", "me", "yeah probably, what time?", 4.8),
        msg("m3", "them", "9-ish at my place", 4.5),
        msg("m4", "me", "ok cool 👍", 4.2),
        msg("m5", "them", "yo are you coming tonight??", 0.5),
      ],
    },
    {
      participantName: "Priya",
      isKnownContact: true,
      messages: [
        msg("m6", "them", "did you finish the assignment?", 26),
        msg("m7", "me", "half of it lol, why 😭", 25.5),
        msg("m8", "them", "can you send me your notes", 25),
      ],
    },
    {
      participantName: "coach_ravi",
      isKnownContact: false,
      messages: [
        msg("m9", "them", "Hi! Interested in personal training sessions?", 48),
      ],
    },
    {
      participantName: "Mom",
      isKnownContact: true,
      messages: [
        msg("m10", "them", "beta call me when free", 72),
        msg("m11", "me", "haan ma, evening pakka", 71),
      ],
    },
  ];
}

export class MockInstagramProvider implements MessagingProvider {
  readonly name = "mock-instagram";

  private threads: Map<string, MockThread>;
  private sendLog: Array<{ accountRef: AccountRef; conversationId: string; text: string; at: Date }> = [];
  private counter = 1000;

  constructor(threads: MockThread[] = defaultMockThreads()) {
    this.threads = new Map(
      threads.map((t, i) => ["conv_" + (i + 1), t]),
    );
  }

  /** Test hook: inject an incoming message to simulate a webhook delivery. */
  simulateIncoming(conversationId: string, text: string): void {
    const t = this.threads.get(conversationId);
    if (!t) return;
    this.counter++;
    t.messages.push(msg("mock_" + this.counter, "them", text, 0));
  }

  /** Test hook: everything the mock "sent". */
  get sentMessages(): Array<{ conversationId: string; text: string }> {
    return this.sendLog.map((s) => ({ conversationId: s.conversationId, text: s.text }));
  }

  async listConversations(_accountRef: AccountRef): Promise<ExternalConversation[]> {
    const out: ExternalConversation[] = [];
    for (const [id, t] of this.threads) {
      out.push({
        externalId: id,
        participantName: t.participantName,
        isKnownContact: t.isKnownContact,
        messages: t.messages.slice(-12),
      });
    }
    return out;
  }

  async listMessages(
    _accountRef: AccountRef,
    externalConversationId: string,
  ): Promise<ExternalMessage[]> {
    const t = this.threads.get(externalConversationId);
    if (!t) throw new Error("conversation_not_found");
    return t.messages;
  }

  async sendMessage(
    _accountRef: AccountRef,
    externalConversationId: string,
    text: string,
  ): Promise<SendResult> {
    const t = this.threads.get(externalConversationId);
    if (!t) return { ok: false, error: "conversation_not_found" };
    this.counter++;
    const id = "mock_out_" + this.counter;
    t.messages.push(msg(id, "me", text, 0));
    this.sendLog.push({
      accountRef: _accountRef,
      conversationId: externalConversationId,
      text,
      at: new Date(),
    });
    return { ok: true, externalMessageId: id };
  }
}

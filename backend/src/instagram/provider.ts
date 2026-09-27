import { env } from "../config/env.js";
import { logger } from "../logger.js";

/**
 * MessagingProvider, the platform-neutral interface so future WhatsApp,
 * Telegram, Messenger and Email providers can plug in without app changes.
 *
 * COMPLIANCE RULES (enforced by design):
 * - No scraping of Instagram.
 * - No reverse-engineered or private APIs.
 * - No Accessibility Services and no UI automation of the Instagram app.
 * - Never handles Instagram passwords; OAuth access tokens only.
 */
export interface ExternalMessage {
  externalId: string;
  sender: "them" | "me";
  text: string;
  timestamp: string;
}

export interface ExternalConversation {
  externalId: string;
  participantName: string;
  participantAvatarUrl?: string;
  isKnownContact: boolean;
  messages: ExternalMessage[];
}

export interface SendResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
}

export interface AccountRef {
  igUserId: string;
  accessToken: string;
  graphVersion: string;
}

export interface MessagingProvider {
  readonly name: string;
  listConversations(accountRef: AccountRef): Promise<ExternalConversation[]>;
  listMessages(accountRef: AccountRef, externalConversationId: string): Promise<ExternalMessage[]>;
  sendMessage(accountRef: AccountRef, externalConversationId: string, text: string): Promise<SendResult>;
}

/**
 * Official Meta Graph API implementation for Instagram Messaging.
 * Uses only documented endpoints: GET /{ig-user-id}/conversations,
 * GET /{conversation-id}/messages and POST /{ig-user-id}/messages.
 */
export class InstagramProvider implements MessagingProvider {
  readonly name = "instagram";

  private fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  private url(path: string): string {
    return "https://graph.facebook.com/" + env.instagramGraphVersion + path;
  }

  async listConversations(accountRef: AccountRef): Promise<ExternalConversation[]> {
    const url = this.url(
      "/" + accountRef.igUserId +
        "/conversations?platform=instagram&fields=participants,updated_time,messages.limit(20){from,id,message,created_time}&limit=25",
    );
    const res = await this.fetchFn(url, {
      headers: { Authorization: "Bearer " + accountRef.accessToken },
    });
    if (!res.ok) {
      logger.warn("graph conversations fetch failed", { status: res.status });
      throw new Error("graph_error_" + res.status);
    }
    type GraphConversation = {
      id: string;
      updated_time: string;
      participants?: Array<{ username?: string; name?: string; id?: string }>;
      messages?: {
        data?: Array<{
          id: string;
          from?: { id?: string; username?: string };
          message?: string;
          created_time: string;
        }>;
      };
    };
    const json = (await res.json()) as { data?: GraphConversation[] };
    const out: ExternalConversation[] = [];
    for (const c of json.data ?? []) {
      const msgs: ExternalMessage[] = (c.messages?.data ?? []).map((m) => ({
        externalId: m.id,
        // Self-detection compares the message author id with the connected
        // account's ig-user-id when available.
        sender: m.from?.id === accountRef.igUserId ? "me" : "them",
        text: m.message ?? "",
        timestamp: m.created_time,
      }));
      const participants = c.participants ?? [];
      const other =
        participants.find((p) => p.id !== accountRef.igUserId) ?? participants[0];
      out.push({
        externalId: c.id,
        participantName: other?.name ?? other?.username ?? "Unknown",
        isKnownContact: false,
        messages: msgs,
      });
    }
    return out;
  }

  async listMessages(
    accountRef: AccountRef,
    externalConversationId: string,
  ): Promise<ExternalMessage[]> {
    const url = this.url(
      "/" + externalConversationId + "/messages?fields=from,id,message,created_time&limit=50",
    );
    const res = await this.fetchFn(url, {
      headers: { Authorization: "Bearer " + accountRef.accessToken },
    });
    if (!res.ok) throw new Error("graph_error_" + res.status);
    type GraphMessage = {
      id: string;
      from?: { id?: string; username?: string };
      message?: string;
      created_time: string;
    };
    const json = (await res.json()) as { data?: GraphMessage[] };
    return (json.data ?? []).map((m) => ({
      externalId: m.id,
      sender: m.from?.id === accountRef.igUserId ? "me" : "them",
      text: m.message ?? "",
      timestamp: m.created_time,
    }));
  }

  async sendMessage(
    accountRef: AccountRef,
    externalConversationId: string,
    text: string,
  ): Promise<SendResult> {
    const url = this.url("/" + accountRef.igUserId + "/messages");
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accountRef.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { conversation_id: externalConversationId },
        message: { text },
      }),
    });
    if (!res.ok) {
      logger.warn("graph send failed", { status: res.status });
      return { ok: false, error: "graph_error_" + res.status };
    }
    const json = (await res.json()) as { message_id?: string };
    return { ok: true, externalMessageId: json.message_id };
  }
}

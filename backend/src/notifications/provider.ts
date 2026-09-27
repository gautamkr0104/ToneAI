import { env } from "../config/env.js";
import { logger } from "../logger.js";

/**
 * NotificationProvider abstraction.
 * Implementations: NoopNotificationProvider (default), FcmNotificationProvider.
 */
export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface NotificationProvider {
  readonly name: string;
  sendToUser(payload: PushPayload): Promise<boolean>;
}

export class NoopNotificationProvider implements NotificationProvider {
  readonly name = "noop";
  async sendToUser(payload: PushPayload): Promise<boolean> {
    logger.info("notification (noop)", { userId: payload.userId, title: payload.title });
    return true;
  }
}

/**
 * FCM HTTP v1-lite via legacy server key endpoint is deprecated; this uses the
 * FCM v1 API shape with an OAuth-less service placeholder. In production,
 * plug firebase-admin with a service account via env credentials.
 */
export class FcmNotificationProvider implements NotificationProvider {
  readonly name = "fcm";
  constructor(private serverKey: string) {}
  async sendToUser(payload: PushPayload): Promise<boolean> {
    // Placeholder implementation: real deployments should use firebase-admin.
    logger.warn("fcm provider is a stub; configure firebase-admin for production", {
      userId: payload.userId,
    });
    void this.serverKey;
    return false;
  }
}

export function createNotificationProvider(): NotificationProvider {
  if (env.notificationProvider === "fcm" && env.fcmServerKey) {
    return new FcmNotificationProvider(env.fcmServerKey);
  }
  return new NoopNotificationProvider();
}

export const notificationProvider: NotificationProvider = createNotificationProvider();

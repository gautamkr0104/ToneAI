/**
 * Turbo mode — user-level opt-in for sending AI replies without prior
 * approval (like an agentic "turbo" mode). Deliberately requires an explicit
 * acknowledgement string to enable, and NEVER bypasses the hard guardrails:
 * sensitive content, unknown senders, and unknown-fact questions are still
 * held as drafts.
 */
import { query } from "../db/pool.js";
import { audit } from "../audit.js";

export interface TurboSettings {
  turboMode: boolean;
  turboAcknowledgedAt: Date | null;
  updatedAt: Date | null;
}

export async function getTurbo(userId: string): Promise<TurboSettings> {
  const { rows } = await query<{
    turbo_mode: boolean;
    turbo_acknowledged_at: Date | null;
    updated_at: Date;
  }>(
    "SELECT turbo_mode, turbo_acknowledged_at, updated_at FROM user_automation_settings WHERE user_id=$1",
    [userId],
  );
  const r = rows[0];
  return {
    turboMode: r?.turbo_mode ?? false,
    turboAcknowledgedAt: r?.turbo_acknowledged_at ?? null,
    updatedAt: r?.updated_at ?? null,
  };
}

/** Enable requires the literal acknowledgement "I_UNDERSTAND" (recorded). */
export async function setTurbo(
  userId: string,
  enabled: boolean,
  acknowledgement?: string,
): Promise<TurboSettings> {
  if (enabled && acknowledgement !== "I_UNDERSTAND") {
    throw Object.assign(
      new Error("turbo_ack_required: to enable turbo mode send acknowledgement:'I_UNDERSTAND'"),
      { statusCode: 400 },
    );
  }
  await query(
    `INSERT INTO user_automation_settings (user_id, turbo_mode, turbo_acknowledged_at)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET
       turbo_mode=$2,
       turbo_acknowledged_at=CASE WHEN $2 THEN now() ELSE turbo_acknowledged_at END,
       updated_at=now()`,
    [userId, enabled, enabled ? new Date() : null],
  );
  await audit(userId, enabled ? "automation.turbo_enabled" : "automation.turbo_disabled");
  return getTurbo(userId);
}

/** Fast check used by hot paths (generate/webhook). Defaults false. */
export async function isTurboOn(userId: string): Promise<boolean> {
  const { rows } = await query<{ turbo_mode: boolean }>(
    "SELECT turbo_mode FROM user_automation_settings WHERE user_id=$1",
    [userId],
  );
  return rows[0]?.turbo_mode ?? false;
}

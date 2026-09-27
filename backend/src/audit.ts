import { query } from "./db/pool.js";
import { logger, redactMessage } from "./logger.js";

/**
 * Record an audit event. Never throws — auditing must not break requests.
 * Private content in metadata must be redacted by callers using redactMessage.
 */
export async function audit(
  userId: string | null,
  action: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_events (user_id, action, resource_type, resource_id, metadata)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        userId,
        action,
        resourceType ?? null,
        resourceId ?? null,
        metadata ? JSON.stringify(redactMetadata(metadata)) : "{}",
      ],
    );
  } catch (err) {
    logger.warn("audit write failed", { action, err: String(err) });
  }
}

function redactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/token|secret|password|key/i.test(k)) out[k] = "[REDACTED]";
    else if (k === "message" && typeof v === "string") out[k] = redactMessage(v);
    else out[k] = v;
  }
  return out;
}

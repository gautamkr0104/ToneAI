/**
 * Structured logger with mandatory redaction.
 *
 * - Tokens, passwords, API keys, secrets: always redacted.
 * - Private message content: redacted in production (LOG_MESSAGE_CONTENT=false).
 * - Emails: partially masked.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /(access_token|refresh_token|token|authorization|api[_-]?key|secret|password)?"?\s*[:=]\s*"([^"]{4,})"/gi,
    '$1: "[REDACTED]"',
  ],
  [
    /(access_token|refresh_token|token|api[_-]?key|secret|password)=([A-Za-z0-9._~+/=-]{4,})/gi,
    "$1=[REDACTED]",
  ],
  [
    /(EA[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{16,})/g,
    "[REDACTED]",
  ],
  [
    /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    "$1***@$2",
  ],
];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|api[_-]?key|authorization/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

/**
 * Redact a message body for logs / diagnostics. Private message content is
 * never written to production logs.
 */
export function redactMessage(content: string): string {
  if (process.env.LOG_MESSAGE_CONTENT === "1") return content;
  return `[msg:${content.length} chars]`;
}

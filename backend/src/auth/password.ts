import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt (no external deps).
 * Format: scrypt$N$salt_b64$hash_b64
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const derived = await scrypt(password.normalize("NFKC"), salt, 64);
  void N;
  return `scrypt$16384$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length);
  return (
    derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
  );
}

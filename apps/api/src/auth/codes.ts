import { createHash, randomInt } from "node:crypto";

export const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

/** Zero-padded 6-digit code from a CSPRNG. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * sha256, not bcrypt: codes are single-use, expire in 15 minutes, and lock
 * after 5 wrong attempts, so offline brute force of a leaked hash is moot —
 * and verification stays O(µs).
 */
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export type CodeState = "valid" | "expired" | "consumed" | "locked";

export function codeState(
  record: { expiresAt: Date; consumedAt: Date | null; attempts: number },
  now: Date = new Date()
): CodeState {
  if (record.consumedAt) {
    return "consumed";
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    return "locked";
  }
  if (now.getTime() > record.expiresAt.getTime()) {
    return "expired";
  }
  return "valid";
}

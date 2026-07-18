import type { CompanyStatus } from "@company-rag/database";

export type LoginInput = {
  userFound: boolean;
  hasPassword: boolean;
  passwordOk: boolean;
  emailVerified: boolean;
  companyStatus: CompanyStatus | null;
};

export type LoginDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: "INVALID_CREDENTIALS" | "EMAIL_NOT_VERIFIED" | "ACCOUNT_UNAVAILABLE"; message: string };

/**
 * The complete login gating matrix in one pure function.
 * Unknown user, no password set, and wrong password are indistinguishable
 * from outside (no account enumeration). Suspended/pending companies get a
 * generic "unavailable" — the reason is not disclosed.
 */
export function evaluateLogin(input: LoginInput): LoginDecision {
  if (!input.userFound || !input.hasPassword || !input.passwordOk) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password."
    };
  }
  if (!input.emailVerified) {
    return {
      ok: false,
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
      message: "Verify your email before signing in."
    };
  }
  if (input.companyStatus !== "ACTIVE") {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_UNAVAILABLE",
      message: "This account is currently unavailable."
    };
  }
  return { ok: true };
}

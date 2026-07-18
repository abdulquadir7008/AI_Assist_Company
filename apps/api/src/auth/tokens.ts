import jwt from "jsonwebtoken";

/**
 * Two disjoint token scopes: "user" (tenant members) and "root" (platform
 * admin). verifyToken enforces the expected scope, so a root token can never
 * authenticate as a tenant user and vice versa.
 */
export type TokenType = "user" | "root";

export class TokenError extends Error {}

export function signToken(
  payload: { sub: string; typ: TokenType },
  secret: string,
  expiresIn: string
): string {
  return jwt.sign({ typ: payload.typ }, secret, {
    subject: payload.sub,
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"]
  });
}

export function verifyToken(token: string, expectedTyp: TokenType, secret: string): { sub: string } {
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  } catch {
    throw new TokenError("Invalid or expired token.");
  }
  if (decoded.typ !== expectedTyp || typeof decoded.sub !== "string" || decoded.sub.length === 0) {
    throw new TokenError("Token scope mismatch.");
  }
  return { sub: decoded.sub };
}

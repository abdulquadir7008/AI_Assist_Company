import bcrypt from "bcryptjs";
import { config } from "../config.js";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

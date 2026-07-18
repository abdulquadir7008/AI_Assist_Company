import nodemailer from "nodemailer";
import { config } from "../config.js";

export type SendCodeResult = { delivered: boolean; devCode?: string };

/**
 * Dev-friendly delivery: with SMTP configured (SMTP_HOST/USER/PASS), a real
 * email is sent. Without it, the code is logged to the API console and
 * returned so routes can surface it as devVerificationCode — dev only.
 */
export async function sendVerificationCode(email: string, code: string): Promise<SendCodeResult> {
  const { host, port, user, pass, from } = config.smtp;

  if (host && user && pass) {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    await transport.sendMail({
      from,
      to: email,
      subject: "Your verification code",
      text: `Your verification code is ${code}. It is valid for 15 minutes.`
    });
    return { delivered: true };
  }

  console.log(`[mailer] verification code for ${email}: ${code}`);
  return { delivered: false, devCode: code };
}

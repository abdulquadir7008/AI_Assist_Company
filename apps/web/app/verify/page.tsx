"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { resendCode, verifyEmail } from "../../lib/api";

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyEmail({ email, code });
      router.replace("/login?verified=1");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null);
    setNotice(null);
    try {
      const result = await resendCode(email);
      setNotice(
        result.devVerificationCode
          ? `New code (dev mode): ${result.devVerificationCode}`
          : "If the account exists and is unverified, a new code was sent."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resend code.");
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded border border-line bg-white p-5 shadow-panel"
    >
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">6-digit code</span>
        <input
          required
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          className="w-full rounded border border-line px-3 py-2 text-center font-mono text-xl tracking-[0.4em] outline-none focus:border-accent"
          placeholder="000000"
        />
      </label>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="flex h-10 w-full items-center justify-center gap-2 rounded bg-accent text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Verify account
      </button>
      <button
        type="button"
        onClick={() => void onResend()}
        disabled={!email}
        className="w-full text-center text-sm font-medium text-accent hover:underline disabled:opacity-50"
      >
        Resend code
      </button>
    </form>
  );
}

export default function VerifyPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">
            <MailCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">Verify your account</h1>
            <p className="text-sm text-muted">Enter the code we sent you — valid 15 minutes</p>
          </div>
        </div>
        <Suspense fallback={null}>
          <VerifyForm />
        </Suspense>
      </div>
    </main>
  );
}

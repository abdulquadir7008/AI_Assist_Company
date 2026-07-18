"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Loader2, ShieldCheck } from "lucide-react";
import { register } from "../../lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [userName, setUserName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; devVerificationCode?: string } | null>(
    null
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await register({ companyName, userName, email, password });
      setResult({ message: response.message, devVerificationCode: response.devVerificationCode });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">Register your company</h1>
            <p className="text-sm text-muted">You become the workspace admin</p>
          </div>
        </div>

        {result ? (
          <div className="space-y-3 rounded border border-line bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2 text-emerald-700">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <p className="text-sm font-semibold">Account created</p>
            </div>
            <p className="text-sm text-ink">{result.message}</p>
            {result.devVerificationCode ? (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">Dev mode — verification code:</p>
                <p className="mt-1 font-mono text-2xl tracking-[0.3em]">
                  {result.devVerificationCode}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => router.push(`/verify?email=${encodeURIComponent(email)}`)}
              className="flex h-10 w-full items-center justify-center rounded bg-accent text-sm font-semibold text-white"
            >
              Enter verification code
            </button>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-3 rounded border border-line bg-white p-5 shadow-panel"
          >
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Company name</span>
              <input
                required
                minLength={2}
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Acme Inc."
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Your name</span>
              <input
                required
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Jane Doe"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Work email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="you@acme.com"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Password (min 8 characters)</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Confirm password</span>
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>

            {error ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded bg-accent text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Create workspace
            </button>

            <p className="text-center text-sm text-muted">
              Already registered?{" "}
              <Link href="/login" className="font-semibold text-accent hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

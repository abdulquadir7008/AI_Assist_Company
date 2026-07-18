"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, ShieldCheck, Sparkles } from "lucide-react";
import { ApiError, login, setupDemo } from "../../lib/api";
import { getSession, setSession } from "../../lib/session";

const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    if (getSession()) {
      router.replace("/");
    }
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsVerification(false);
    try {
      const result = await login({ email, password });
      setSession(result);
      router.replace(result.user.mustChangePassword ? "/change-password" : "/");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
      }
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onSeedDemo() {
    setSeeding(true);
    setError(null);
    try {
      await setupDemo();
      setEmail("admin@demo-company.test");
      setPassword("demo-password");
      setNotice("Demo workspace ready — credentials filled in below.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Demo setup failed.");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">Private Company AI Assistant</h1>
            <p className="text-sm text-muted">Sign in to your workspace</p>
          </div>
        </div>

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
              placeholder="you@company.com"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="••••••••"
            />
          </label>

          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
              {needsVerification ? (
                <>
                  {" "}
                  <Link
                    href={`/verify?email=${encodeURIComponent(email)}`}
                    className="font-semibold underline"
                  >
                    Verify now
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}
          {notice ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="flex h-10 w-full items-center justify-center gap-2 rounded bg-accent text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogIn className="h-4 w-4" aria-hidden="true" />
            )}
            Sign in
          </button>

          <p className="text-center text-sm text-muted">
            New company?{" "}
            <Link href="/register" className="font-semibold text-accent hover:underline">
              Register your workspace
            </Link>
          </p>
        </form>

        {demoMode ? (
          <div className="mt-4 rounded border border-dashed border-line bg-white p-4 text-sm text-muted">
            <p className="mb-2 flex items-center gap-1.5 font-medium text-ink">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
              Demo mode
            </p>
            <p>
              Try the app with seeded personas — e.g.{" "}
              <code className="rounded bg-paper px-1">admin@demo-company.test</code> /{" "}
              <code className="rounded bg-paper px-1">demo-password</code> (also hr@, legal@,
              employee@, contractor@).
            </p>
            <button
              type="button"
              onClick={() => void onSeedDemo()}
              disabled={seeding}
              className="mt-2 rounded border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-60"
            >
              {seeding ? "Seeding…" : "Seed demo workspace"}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

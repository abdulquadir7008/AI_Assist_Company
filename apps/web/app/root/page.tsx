"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { BadgeCheck, Loader2, LogOut, ServerCog, Users } from "lucide-react";
import {
  ApiError,
  RootCompany,
  RootCompanyUser,
  rootListCompanies,
  rootListCompanyUsers,
  rootLogin,
  rootSetCompanyStatus,
  rootVerifyUser
} from "../../lib/api";
import { clearRootSession, getRootSession, RootSession, setRootSession } from "../../lib/session";

/**
 * Platform operations dashboard. Root admins manage company lifecycle
 * (verify, suspend, activate) but can never see tenant documents or chats —
 * the API has no root endpoints for tenant content at all.
 */
export default function RootPage() {
  const [session, setSessionState] = useState<RootSession | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    setSessionState(getRootSession());
    setBooted(true);
  }, []);

  if (!booted) {
    return null;
  }

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-line bg-ink text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <ServerCog className="h-6 w-6" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-semibold">Root Admin</h1>
              <p className="text-xs text-white/70">
                Platform operations — no access to tenant documents or chats
              </p>
            </div>
          </div>
          {session ? (
            <button
              type="button"
              onClick={() => {
                clearRootSession();
                setSessionState(null);
              }}
              className="flex items-center gap-1.5 rounded border border-white/30 px-3 py-1.5 text-sm hover:border-white"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {session.email} · Sign out
            </button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6">
        {session ? (
          <Dashboard session={session} onExpired={() => setSessionState(null)} />
        ) : (
          <RootLogin onLogin={setSessionState} />
        )}
      </div>
    </main>
  );
}

function RootLogin({ onLogin }: { onLogin: (session: RootSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await rootLogin({ email, password });
      const session = { token: result.token, email: result.rootAdmin.email };
      setRootSession(session);
      onLogin(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Root sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto max-w-sm space-y-3 rounded border border-line bg-white p-5 shadow-panel"
    >
      <h2 className="text-base font-semibold text-ink">Root sign in</h2>
      <p className="text-xs text-muted">
        Credentials come from ROOT_ADMIN_EMAIL / ROOT_ADMIN_PASSWORD in the API environment.
      </p>
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="root@platform"
        className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <input
        type="password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="••••••••"
        className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="flex h-10 w-full items-center justify-center gap-2 rounded bg-ink text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Sign in
      </button>
    </form>
  );
}

function Dashboard({ session, onExpired }: { session: RootSession; onExpired: () => void }) {
  const [companies, setCompanies] = useState<RootCompany[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [companyUsers, setCompanyUsers] = useState<Record<string, RootCompanyUser[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    (caught: unknown, fallback: string) => {
      if (caught instanceof ApiError && caught.status === 401) {
        clearRootSession();
        onExpired();
        return;
      }
      setError(caught instanceof Error ? caught.message : fallback);
    },
    [onExpired]
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await rootListCompanies(session.token);
      setCompanies(result.companies);
    } catch (caught) {
      handleError(caught, "Could not load companies.");
    } finally {
      setBusy(false);
    }
  }, [session.token, handleError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleUsers(companyId: string) {
    if (expanded === companyId) {
      setExpanded(null);
      return;
    }
    setExpanded(companyId);
    try {
      const result = await rootListCompanyUsers(session.token, companyId);
      setCompanyUsers((current) => ({ ...current, [companyId]: result.users }));
    } catch (caught) {
      handleError(caught, "Could not load users.");
    }
  }

  async function setStatus(companyId: string, status: "ACTIVE" | "SUSPENDED") {
    try {
      await rootSetCompanyStatus(session.token, companyId, status);
      await refresh();
    } catch (caught) {
      handleError(caught, "Could not update company.");
    }
  }

  async function verifyUser(companyId: string, userId: string) {
    try {
      await rootVerifyUser(session.token, userId);
      const result = await rootListCompanyUsers(session.token, companyId);
      setCompanyUsers((current) => ({ ...current, [companyId]: result.users }));
      await refresh();
    } catch (caught) {
      handleError(caught, "Could not verify user.");
    }
  }

  return (
    <section className="rounded border border-line bg-white shadow-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold text-ink">Companies ({companies.length})</h2>
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden="true" /> : null}
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="divide-y divide-line">
        {companies.map((company) => (
          <div key={company.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {company.name} <span className="font-normal text-muted">· {company.slug}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {company.userCount} users · {company.documentCount} documents · created{" "}
                  {new Date(company.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "rounded px-2 py-1 text-xs font-medium",
                    company.status === "ACTIVE"
                      ? "bg-emerald-50 text-emerald-700"
                      : company.status === "SUSPENDED"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-800"
                  )}
                >
                  {company.status.replace("_", " ")}
                </span>
                {company.status === "SUSPENDED" || company.status === "PENDING_VERIFICATION" ? (
                  <button
                    type="button"
                    onClick={() => void setStatus(company.id, "ACTIVE")}
                    className="rounded border border-line px-2 py-1 text-xs font-medium text-emerald-700 hover:border-emerald-500"
                  >
                    Activate
                  </button>
                ) : null}
                {company.status !== "SUSPENDED" ? (
                  <button
                    type="button"
                    onClick={() => void setStatus(company.id, "SUSPENDED")}
                    className="rounded border border-line px-2 py-1 text-xs font-medium text-red-700 hover:border-red-500"
                  >
                    Suspend
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void toggleUsers(company.id)}
                  className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  Users
                </button>
              </div>
            </div>

            {expanded === company.id ? (
              <div className="mt-3 rounded border border-line bg-paper p-3">
                {(companyUsers[company.id] ?? []).map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-3 py-1.5 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="text-ink">{user.email}</span>
                      {user.name ? <span className="text-muted"> · {user.name}</span> : null}
                    </div>
                    {user.emailVerifiedAt ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-700">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        verified
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void verifyUser(company.id, user.id)}
                        className="rounded border border-line px-2 py-1 text-xs font-medium text-accent hover:border-accent"
                      >
                        Verify manually
                      </button>
                    )}
                  </div>
                ))}
                {(companyUsers[company.id] ?? []).length === 0 ? (
                  <p className="text-xs text-muted">Loading users…</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {companies.length === 0 && !busy ? (
          <p className="px-4 py-6 text-sm text-muted">No companies registered yet.</p>
        ) : null}
      </div>
    </section>
  );
}

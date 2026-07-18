"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { changePassword } from "../../lib/api";
import { getSession, setSession } from "../../lib/session";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [forced, setForced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setForced(session.user.mustChangePassword);
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(session.token, { currentPassword, newPassword });
      setSession({ ...session, user: { ...session.user, mustChangePassword: false } });
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">
              {forced ? "Set your own password" : "Change password"}
            </h1>
            <p className="text-sm text-muted">
              {forced
                ? "Your account was created with a temporary password — replace it to continue."
                : "Pick a new password (min 8 characters)."}
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded border border-line bg-white p-5 shadow-panel"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">
              {forced ? "Temporary password" : "Current password"}
            </span>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">New password</span>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Confirm new password</span>
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
            Save password
          </button>
        </form>
      </div>
    </main>
  );
}

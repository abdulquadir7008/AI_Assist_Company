"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  AccessMatrix,
  AdminDocument,
  adminAccessMatrix,
  adminAudit,
  adminBulkAccess,
  adminCreateUser,
  adminListDocuments,
  adminListUsers,
  adminUpdateDocumentAccess,
  adminUpdateUser,
  ApiError,
  AuditEntry,
  CompanyUser,
  DepartmentName,
  Role
} from "../../lib/api";
import { AuthSession, clearSession, getSession } from "../../lib/session";
import { ArrowLeft, BadgeCheck, Check, Loader2, ShieldCheck, UserPlus, X } from "lucide-react";

const allRoles: Role[] = ["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"];
const allDepartments: DepartmentName[] = [
  "GENERAL",
  "ENGINEERING",
  "HR",
  "LEGAL",
  "SALES",
  "SUPPORT",
  "LEADERSHIP"
];

const tabs = ["Users", "Documents", "Access Matrix", "Audit"] as const;
type Tab = (typeof tabs)[number];

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tab, setTab] = useState<Tab>("Users");
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [matrix, setMatrix] = useState<AccessMatrix | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tempPasswordNotice, setTempPasswordNotice] = useState<{
    email: string;
    tempPassword: string;
  } | null>(null);

  useEffect(() => {
    const cached = getSession();
    if (!cached) {
      router.replace("/login");
      return;
    }
    setSession(cached);
  }, [router]);

  const refresh = useCallback(
    async (activeSession: AuthSession) => {
      setBusy(true);
      setError(null);
      try {
        const [usersResult, documentsResult, matrixResult, auditResult] = await Promise.all([
          adminListUsers(activeSession.token),
          adminListDocuments(activeSession.token),
          adminAccessMatrix(activeSession.token),
          adminAudit(activeSession.token)
        ]);
        setUsers(usersResult.users);
        setDocuments(documentsResult.documents);
        setMatrix(matrixResult);
        setAuditEntries(auditResult.entries);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "Could not load admin data.");
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  useEffect(() => {
    if (session) {
      void refresh(session);
    }
  }, [session, refresh]);

  async function run(action: () => Promise<unknown>, successNotice: string) {
    if (!session) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successNotice);
      await refresh(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-ink">Access Administration</h1>
              <p className="text-sm text-muted">
                Signed in as {session?.user.email ?? "…"} — roles resolved server-side per request
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to assistant
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-4 px-5 py-5">
        <div className="inline-flex rounded border border-line bg-white p-1">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={clsx(
                "rounded px-3 py-1.5 text-sm font-medium",
                tab === item ? "bg-ink text-white" : "text-muted hover:text-ink"
              )}
            >
              {item}
            </button>
          ))}
          {busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin self-center text-muted" /> : null}
        </div>

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
        {tempPasswordNotice ? (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">
              Temporary password for {tempPasswordNotice.email} — share it securely, it will not be
              shown again:
            </p>
            <p className="mt-1 select-all font-mono text-base">{tempPasswordNotice.tempPassword}</p>
            <button
              type="button"
              onClick={() => setTempPasswordNotice(null)}
              className="mt-1 text-xs font-medium underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {tab === "Users" && session ? (
          <section className="space-y-3">
            <AddUserForm
              busy={busy}
              onCreate={(payload) =>
                void run(async () => {
                  const result = await adminCreateUser(session.token, payload);
                  setTempPasswordNotice({
                    email: result.user.email,
                    tempPassword: result.tempPassword
                  });
                }, `Created account for ${payload.email}.`)
              }
            />
            <div className="rounded border border-line bg-white p-4 shadow-panel">
              <h2 className="mb-3 text-base font-semibold text-ink">Users, roles and departments</h2>
              <div className="space-y-3">
                {users.map((user) => (
                  <article key={user.id} className="rounded border border-line p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {user.name ?? user.email}
                        <span className="ml-2 text-xs font-normal text-muted">{user.email}</span>
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        {user.emailVerifiedAt ? (
                          <span className="flex items-center gap-1 text-emerald-700">
                            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            verified
                          </span>
                        ) : (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                            unverified
                          </span>
                        )}
                        {user.mustChangePassword ? (
                          <span className="rounded bg-paper px-1.5 py-0.5 text-muted">
                            temp password
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {allRoles.map((role) => (
                          <label key={role} className="flex items-center gap-1 text-xs text-ink">
                            <input
                              type="checkbox"
                              checked={user.roles.includes(role)}
                              disabled={busy}
                              onChange={(event) => {
                                const nextRoles = event.target.checked
                                  ? [...user.roles, role]
                                  : user.roles.filter((item) => item !== role);
                                if (nextRoles.length === 0) {
                                  setError("A user needs at least one role.");
                                  return;
                                }
                                void run(
                                  () => adminUpdateUser(session.token, user.id, { roles: nextRoles }),
                                  `Updated roles for ${user.email}.`
                                );
                              }}
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                      <select
                        value={user.department}
                        disabled={busy}
                        onChange={(event) =>
                          void run(
                            () =>
                              adminUpdateUser(session.token, user.id, {
                                department: event.target.value as DepartmentName
                              }),
                            `Updated department for ${user.email}.`
                          )
                        }
                        className="rounded border border-line px-2 py-1 text-xs outline-none focus:border-accent"
                      >
                        {allDepartments.map((department) => (
                          <option key={department} value={department}>
                            {department}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "Documents" && session ? (
          <section className="space-y-3">
            {selectedDocs.size > 0 ? (
              <BulkBar
                count={selectedDocs.size}
                busy={busy}
                onApply={(roles, departments) =>
                  void run(
                    () =>
                      adminBulkAccess(session.token, {
                        documentIds: [...selectedDocs],
                        allowedRoles: roles,
                        allowedDepartments: departments
                      }),
                    `Reclassified ${selectedDocs.size} document(s).`
                  ).then(() => setSelectedDocs(new Set()))
                }
              />
            ) : null}
            {documents.map((document) => (
              <DocumentAclCard
                key={document.id}
                document={document}
                busy={busy}
                selected={selectedDocs.has(document.id)}
                onToggleSelect={(checked) =>
                  setSelectedDocs((current) => {
                    const next = new Set(current);
                    if (checked) {
                      next.add(document.id);
                    } else {
                      next.delete(document.id);
                    }
                    return next;
                  })
                }
                onSave={(roles, departments) =>
                  void run(
                    () =>
                      adminUpdateDocumentAccess(session.token, document.id, {
                        allowedRoles: roles,
                        allowedDepartments: departments
                      }),
                    `Reclassified “${document.title}”.`
                  )
                }
              />
            ))}
          </section>
        ) : null}

        {tab === "Access Matrix" && matrix ? (
          <section className="overflow-x-auto rounded border border-line bg-white p-4 shadow-panel">
            <h2 className="mb-3 text-base font-semibold text-ink">
              Who can read what (computed from the same rule retrieval enforces)
            </h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3 font-medium">Document</th>
                  {matrix.roles.map((role) => (
                    <th key={role} className="px-2 py-2 font-medium">
                      {role}
                    </th>
                  ))}
                  {matrix.departments.map((department) => (
                    <th key={department} className="px-2 py-2 font-medium text-muted">
                      {department}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.documents.map((document) => (
                  <tr key={document.id} className="border-b border-line/60">
                    <td className="max-w-[260px] truncate py-2 pr-3 text-ink">
                      {document.title}
                      {document.unclassified ? (
                        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          Unclassified
                        </span>
                      ) : null}
                    </td>
                    {matrix.roles.map((role) => (
                      <td key={role} className="px-2 py-2">
                        {document.access[role] ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" aria-label="allowed" />
                        ) : (
                          <X className="h-3.5 w-3.5 text-red-400" aria-label="denied" />
                        )}
                      </td>
                    ))}
                    {matrix.departments.map((department) => (
                      <td key={department} className="px-2 py-2">
                        {document.departmentAccess[department] ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" aria-label="allowed" />
                        ) : (
                          <X className="h-3.5 w-3.5 text-red-300" aria-label="denied" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {tab === "Audit" && session ? (
          <section className="rounded border border-line bg-white p-4 shadow-panel">
            <h2 className="mb-3 text-base font-semibold text-ink">Audit log</h2>
            <div className="space-y-2">
              {auditEntries.map((entry) => (
                <article key={entry.id} className="rounded border border-line p-3 text-xs">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-ink px-1.5 py-0.5 font-medium text-white">
                      {entry.action}
                    </span>
                    <span className="text-muted">
                      {entry.userId
                        ? (users.find((user) => user.id === entry.userId)?.email ?? entry.userId)
                        : "system / root"}
                    </span>
                    <span className="text-muted">[{entry.rolesSnapshot.join(", ") || "—"}]</span>
                    <span className="text-muted">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-muted">
                    {JSON.stringify(entry.detail)}
                  </pre>
                </article>
              ))}
              {auditEntries.length === 0 ? (
                <p className="text-sm text-muted">No audit entries yet.</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function AddUserForm({
  busy,
  onCreate
}: {
  busy: boolean;
  onCreate: (payload: {
    email: string;
    name: string;
    roles: Role[];
    department: DepartmentName;
    tempPassword?: string;
  }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Role[]>(["EMPLOYEE"]);
  const [department, setDepartment] = useState<DepartmentName>("GENERAL");
  const [tempPassword, setTempPassword] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roles.length === 0) {
      return;
    }
    onCreate({
      email,
      name,
      roles,
      department,
      ...(tempPassword ? { tempPassword } : {})
    });
    setEmail("");
    setName("");
    setRoles(["EMPLOYEE"]);
    setDepartment("GENERAL");
    setTempPassword("");
  }

  return (
    <form onSubmit={onSubmit} className="rounded border border-line bg-white p-4 shadow-panel">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
        <UserPlus className="h-4 w-4 text-accent" aria-hidden="true" />
        Add a teammate
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="teammate@company.com"
          className="rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Full name"
          className="rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <select
          value={department}
          onChange={(event) => setDepartment(event.target.value as DepartmentName)}
          className="rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {allDepartments.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={tempPassword}
          onChange={(event) => setTempPassword(event.target.value)}
          placeholder="Temp password (optional — generated if empty)"
          minLength={tempPassword ? 8 : undefined}
          className="rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {allRoles.map((role) => (
          <label key={role} className="flex items-center gap-1 text-xs text-ink">
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(event) =>
                setRoles((current) =>
                  event.target.checked ? [...current, role] : current.filter((item) => item !== role)
                )
              }
            />
            {role}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        The account is pre-verified and must change its password on first sign-in.
      </p>
      <button
        type="submit"
        disabled={busy || roles.length === 0}
        className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        Create account
      </button>
    </form>
  );
}

function AclEditor({
  roles,
  departments,
  onChange,
  disabled
}: {
  roles: Role[];
  departments: DepartmentName[];
  onChange: (roles: Role[], departments: DepartmentName[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {allRoles.map((role) => (
          <label key={role} className="flex items-center gap-1 text-xs text-ink">
            <input
              type="checkbox"
              checked={role === "ADMIN" || roles.includes(role)}
              disabled={disabled || role === "ADMIN"}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...roles, role] : roles.filter((item) => item !== role),
                  departments
                )
              }
            />
            {role}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {allDepartments.map((department) => (
          <label key={department} className="flex items-center gap-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={departments.includes(department)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  roles,
                  event.target.checked
                    ? [...departments, department]
                    : departments.filter((item) => item !== department)
                )
              }
            />
            {department}
          </label>
        ))}
      </div>
    </div>
  );
}

function DocumentAclCard({
  document,
  busy,
  selected,
  onToggleSelect,
  onSave
}: {
  document: AdminDocument;
  busy: boolean;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onSave: (roles: Role[], departments: DepartmentName[]) => void;
}) {
  const [roles, setRoles] = useState<Role[]>(document.allowedRoles.filter((role) => role !== "ADMIN"));
  const [departments, setDepartments] = useState<DepartmentName[]>(document.allowedDepartments);

  return (
    <article className="rounded border border-line bg-white p-4 shadow-panel">
      <div className="mb-2 flex items-start justify-between gap-3">
        <label className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onToggleSelect(event.target.checked)}
          />
          <span className="truncate text-sm font-semibold text-ink">{document.title}</span>
          {document.unclassified ? (
            <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
              Unclassified — admin-only (legacy hint: {document.legacyVisibilityHint})
            </span>
          ) : null}
        </label>
        <span className="shrink-0 text-xs text-muted">
          {document.chunkCount} chunks
          {document.overriddenChunks.length > 0
            ? ` · ${document.overriddenChunks.length} overridden`
            : ""}
        </span>
      </div>
      <AclEditor
        roles={roles}
        departments={departments}
        disabled={busy}
        onChange={(nextRoles, nextDepartments) => {
          setRoles(nextRoles);
          setDepartments(nextDepartments);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onSave(["ADMIN", ...roles], departments)}
        className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        Save access rules
      </button>
    </article>
  );
}

function BulkBar({
  count,
  busy,
  onApply
}: {
  count: number;
  busy: boolean;
  onApply: (roles: Role[], departments: DepartmentName[]) => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<DepartmentName[]>([]);

  return (
    <div className="rounded border border-accent/40 bg-accent/5 p-4">
      <p className="mb-2 text-sm font-semibold text-ink">
        Bulk reclassify {count} selected document(s)
      </p>
      <AclEditor
        roles={roles}
        departments={departments}
        disabled={busy}
        onChange={(nextRoles, nextDepartments) => {
          setRoles(nextRoles);
          setDepartments(nextDepartments);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onApply(["ADMIN", ...roles], departments)}
        className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        Apply to selected
      </button>
    </div>
  );
}

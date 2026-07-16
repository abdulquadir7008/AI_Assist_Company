"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  AccessMatrix,
  AdminDocument,
  adminAccessMatrix,
  adminAudit,
  adminBulkAccess,
  adminListDocuments,
  adminListUsers,
  adminUpdateDocumentAccess,
  adminUpdateUser,
  AuditEntry,
  DemoUser,
  DepartmentName,
  Role,
  TenantContext
} from "../../lib/api";
import { ArrowLeft, Check, Loader2, ShieldCheck, X } from "lucide-react";

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
  const [context, setContext] = useState<TenantContext | null>(null);
  const [tab, setTab] = useState<Tab>("Users");
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [matrix, setMatrix] = useState<AccessMatrix | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const cached = window.localStorage.getItem("company-rag-context-v2");
    if (cached) {
      setContext(JSON.parse(cached) as TenantContext);
    } else {
      setError("Open the main page first so the workspace can start.");
    }
  }, []);

  const refresh = useCallback(
    async (activeContext: TenantContext) => {
      setBusy(true);
      setError(null);
      try {
        const [usersResult, documentsResult, matrixResult, auditResult] = await Promise.all([
          adminListUsers(activeContext),
          adminListDocuments(activeContext),
          adminAccessMatrix(activeContext),
          adminAudit(activeContext)
        ]);
        setUsers(usersResult.users);
        setDocuments(documentsResult.documents);
        setMatrix(matrixResult);
        setAuditEntries(auditResult.entries);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load admin data.");
      } finally {
        setBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    if (context) {
      void refresh(context);
    }
  }, [context, refresh]);

  const activeUser = useMemo(
    () => context?.users.find((user) => user.id === context.userId),
    [context]
  );

  async function run(action: () => Promise<unknown>, successNotice: string) {
    if (!context) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successNotice);
      await refresh(context);
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
                Signed in as {activeUser?.email ?? "…"} — roles resolved server-side per request
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

        {tab === "Users" && context ? (
          <section className="rounded border border-line bg-white p-4 shadow-panel">
            <h2 className="mb-3 text-base font-semibold text-ink">Users, roles and departments</h2>
            <div className="space-y-3">
              {users.map((user) => (
                <article key={user.id} className="rounded border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">
                      {user.name ?? user.email}
                      <span className="ml-2 text-xs font-normal text-muted">{user.email}</span>
                    </p>
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
                                () => adminUpdateUser(context, user.id, { roles: nextRoles }),
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
                            adminUpdateUser(context, user.id, {
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
          </section>
        ) : null}

        {tab === "Documents" && context ? (
          <section className="space-y-3">
            {selectedDocs.size > 0 ? (
              <BulkBar
                count={selectedDocs.size}
                busy={busy}
                onApply={(roles, departments) =>
                  void run(
                    () =>
                      adminBulkAccess(context, {
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
                      adminUpdateDocumentAccess(context, document.id, {
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

        {tab === "Audit" && context ? (
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
                      {users.find((user) => user.id === entry.userId)?.email ?? entry.userId}
                    </span>
                    <span className="text-muted">[{entry.rolesSnapshot.join(", ")}]</span>
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

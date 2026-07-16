"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  askQuestion,
  CompanyDocument,
  DemoUser,
  DepartmentName,
  downloadDocument,
  listDocuments,
  Role,
  setupDemo,
  Source,
  TenantContext,
  uploadDocument
} from "../lib/api";
import { AnswerWithSources } from "../components/AnswerWithSources";
import {
  Bot,
  Building2,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UploadCloud,
  UserRound,
  Wrench
} from "lucide-react";
import clsx from "clsx";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  grounded?: boolean;
};

const categories = [
  "HR_POLICY",
  "PRODUCT",
  "TECHNICAL",
  "LEGAL",
  "TRAINING",
  "OTHER"
] as const;

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

const contextStorageKey = "company-rag-context-v2";

export default function Home() {
  const [context, setContext] = useState<TenantContext | null>(null);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Ask a question about uploaded company documents."
    }
  ]);
  const [provider, setProvider] = useState<"openai" | "huggingface">("openai");
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("HR_POLICY");
  const [uploadRoles, setUploadRoles] = useState<Role[]>([]);
  const [uploadDepartments, setUploadDepartments] = useState<DepartmentName[]>([]);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readyCount = useMemo(
    () => documents.filter((document) => document.status === "READY").length,
    [documents]
  );

  async function refreshDocuments(activeContext = context) {
    if (!activeContext) {
      return;
    }

    setLoadingDocuments(true);
    try {
      const result = await listDocuments(activeContext);
      setDocuments(result.documents);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load documents.");
    } finally {
      setLoadingDocuments(false);
    }
  }

  useEffect(() => {
    const cached = window.localStorage.getItem(contextStorageKey);

    async function boot() {
      try {
        let activeContext = cached ? (JSON.parse(cached) as TenantContext) : await setupDemo();
        if (!activeContext.users?.length) {
          activeContext = await setupDemo();
        }
        window.localStorage.setItem(contextStorageKey, JSON.stringify(activeContext));
        setContext(activeContext);
        await refreshDocuments(activeContext);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not start workspace.");
      }
    }

    void boot();
  }, []);

  const activeUser = useMemo(
    () => context?.users.find((user) => user.id === context.userId),
    [context]
  );
  const isAdmin = activeUser?.roles.includes("ADMIN") ?? false;

  async function switchPersona(userId: string) {
    if (!context) {
      return;
    }
    const nextContext = { ...context, userId };
    window.localStorage.setItem(contextStorageKey, JSON.stringify(nextContext));
    setContext(nextContext);
    setError(null);
    // Permissions changed: refetch what this persona is allowed to see.
    await refreshDocuments(nextContext);
  }

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!context || !file) {
      setError("Choose a document first.");
      return;
    }

    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", title);
    formData.set("category", category);
    // Multipart fields are strings, so ACL arrays travel JSON-encoded.
    // Leaving both empty omits the fields → server defaults to admin-only.
    if (uploadRoles.length > 0 || uploadDepartments.length > 0) {
      formData.set("allowedRoles", JSON.stringify(uploadRoles));
      formData.set("allowedDepartments", JSON.stringify(uploadDepartments));
    }

    try {
      await uploadDocument(context, formData);
      setTitle("");
      setUploadRoles([]);
      setUploadDepartments([]);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
      await refreshDocuments(context);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function onAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!context || !trimmed) {
      return;
    }

    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setQuestion("");
    setAnswering(true);
    setError(null);

    try {
      const result = await askQuestion(context, { question: trimmed, provider });
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          grounded: result.grounded
        }
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Question failed.");
    } finally {
      setAnswering(false);
    }
  }

  async function onDownload(documentId: string, filename: string) {
    if (!context) {
      return;
    }
    try {
      await downloadDocument(context, documentId, filename);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
        setError("This document is not available to your current role.");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Download failed.");
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal text-ink">
                Private Company AI Assistant
              </h1>
              <p className="text-sm text-muted">RAG workspace for internal company knowledge</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Metric icon={Building2} label="Workspace" value={context ? "Ready" : "Starting"} />
              <Metric icon={FileText} label="Docs" value={String(documents.length)} />
              <Metric icon={Search} label="Indexed" value={String(readyCount)} />
            </div>
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted" aria-hidden="true" />
              <select
                value={context?.userId ?? ""}
                onChange={(event) => void switchPersona(event.target.value)}
                className="rounded border border-line px-2 py-1.5 text-sm outline-none focus:border-accent"
                title="Switch demo persona"
              >
                {(context?.users ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email} · {user.roles.join("+")} · {user.department}
                  </option>
                ))}
              </select>
              {isAdmin ? (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 rounded border border-line px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-accent"
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  Admin
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className="space-y-5">
          <div className="rounded border border-line bg-white p-4 shadow-panel">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Documents</h2>
              <button
                type="button"
                onClick={() => void refreshDocuments()}
                className="grid h-9 w-9 place-items-center rounded border border-line text-muted hover:border-accent hover:text-accent"
                title="Refresh documents"
              >
                <RefreshCw
                  className={clsx("h-4 w-4", loadingDocuments && "animate-spin")}
                  aria-hidden="true"
                />
              </button>
            </div>

            {!isAdmin ? (
              <p className="rounded border border-dashed border-line p-3 text-xs text-muted">
                Only admins can upload documents. Switch to the admin persona to add content.
              </p>
            ) : (
            <form className="space-y-3" onSubmit={onUpload}>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="block w-full rounded border border-line bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
              />
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Document title"
                className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as typeof category)}
                className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item.replace("_", " ")}
                  </option>
                ))}
              </select>
              <fieldset className="rounded border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-muted">
                  Who can access this document?
                </legend>
                <p className="mb-2 text-xs text-muted">
                  Leave everything unchecked to keep it admin-only until classified.
                </p>
                <div className="mb-2">
                  <p className="mb-1 text-xs font-medium text-ink">Roles</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {allRoles.map((role) => (
                      <label key={role} className="flex items-center gap-1 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={role === "ADMIN" || uploadRoles.includes(role)}
                          disabled={role === "ADMIN"}
                          onChange={(event) =>
                            setUploadRoles((current) =>
                              event.target.checked
                                ? [...current, role]
                                : current.filter((item) => item !== role)
                            )
                          }
                        />
                        {role}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-ink">Departments</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {allDepartments.map((department) => (
                      <label key={department} className="flex items-center gap-1 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={uploadDepartments.includes(department)}
                          onChange={(event) =>
                            setUploadDepartments((current) =>
                              event.target.checked
                                ? [...current, department]
                                : current.filter((item) => item !== department)
                            )
                          }
                        />
                        {department}
                      </label>
                    ))}
                  </div>
                </div>
              </fieldset>
              <button
                type="submit"
                disabled={uploading || !context}
                className="flex h-10 w-full items-center justify-center gap-2 rounded bg-accent px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UploadCloud className="h-4 w-4" aria-hidden="true" />
                )}
                Upload
              </button>
            </form>
            )}
          </div>

          <div className="rounded border border-line bg-white shadow-panel">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-base font-semibold text-ink">Library</h2>
            </div>
            <div className="max-h-[430px] overflow-y-auto p-3">
              {documents.length === 0 ? (
                <div className="rounded border border-dashed border-line p-4 text-sm text-muted">
                  No documents indexed yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((document) => (
                    <article key={document.id} className="rounded border border-line p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-ink">
                            {document.title}
                          </h3>
                          <p className="mt-1 text-xs text-muted">
                            {document.category.replace("_", " ")} ·{" "}
                            {document._count?.chunks ?? 0} chunks
                          </p>
                        </div>
                        <span
                          className={clsx(
                            "shrink-0 rounded px-2 py-1 text-xs font-medium",
                            document.status === "READY"
                              ? "bg-emerald-50 text-emerald-700"
                              : document.status === "FAILED"
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-signal"
                          )}
                        >
                          {document.status}
                        </span>
                      </div>
                      {document.failureReason ? (
                        <p className="mt-2 text-xs text-red-700">{document.failureReason}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="flex min-h-[680px] flex-col rounded border border-line bg-white shadow-panel">
          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-accent" aria-hidden="true" />
              <h2 className="text-base font-semibold text-ink">Assistant</h2>
            </div>
            <div className="inline-flex w-fit rounded border border-line p-1">
              {(["openai", "huggingface"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setProvider(item)}
                  className={clsx(
                    "rounded px-3 py-1.5 text-sm font-medium capitalize",
                    provider === item ? "bg-ink text-white" : "text-muted hover:text-ink"
                  )}
                >
                  {item === "openai" ? "OpenAI" : "Hugging Face"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={clsx(
                  "flex gap-3",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" ? (
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded bg-accent text-white">
                    <Bot className="h-4 w-4" aria-hidden="true" />
                  </div>
                ) : null}
                <div
                  className={clsx(
                    "max-w-[820px] rounded border px-4 py-3 text-sm leading-6",
                    message.role === "user"
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-paper text-ink"
                  )}
                >
                  {message.role === "assistant" ? (
                    <AnswerWithSources
                      content={message.content}
                      sources={message.sources ?? []}
                      grounded={message.grounded ?? true}
                      messageIndex={index}
                      onDownload={(documentId, filename) => void onDownload(documentId, filename)}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
            {answering ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Retrieving context
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mx-4 mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <form className="border-t border-line p-4" onSubmit={onAsk}>
            <div className="flex gap-3">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                placeholder="What is our refund policy?"
                className="min-h-12 flex-1 resize-none rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={answering || !question.trim() || !context}
                className="grid h-12 w-12 shrink-0 place-items-center rounded bg-accent text-white disabled:cursor-not-allowed disabled:opacity-60"
                title="Send question"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-line px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

"use client";

import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  askQuestion,
  chatUploadDocument,
  CompanyDocument,
  ConversationSummary,
  deleteConversation,
  DepartmentName,
  downloadDocument,
  getConversation,
  getSuggestions,
  listConversations,
  listDocuments,
  me,
  Role,
  Source,
  Suggestion,
  uploadDocument,
  validateAiKey
} from "../lib/api";
import {
  AuthSession,
  clearOpenAiKey,
  clearSession,
  getOpenAiKey,
  getSession,
  setOpenAiKey,
  setSession
} from "../lib/session";
import { AnswerWithSources } from "../components/AnswerWithSources";
import {
  Bot,
  Building2,
  FileText,
  FileUp,
  KeyRound,
  Lightbulb,
  Loader2,
  LogOut,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRound,
  Wrench
} from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ChatMessage = {
  role: "user" | "assistant" | "upload";
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

const greeting: ChatMessage = {
  role: "assistant",
  content:
    "Ask a question about uploaded company documents — or drop a file here and ask about it right away."
};

export default function Home() {
  const router = useRouter();
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // Hugging Face is the default; OpenAI activates only with a user-supplied key.
  const [provider, setProvider] = useState<"openai" | "huggingface">("huggingface");
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySaving, setKeySaving] = useState(false);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("HR_POLICY");
  const [uploadRoles, setUploadRoles] = useState<Role[]>([]);
  const [uploadDepartments, setUploadDepartments] = useState<DepartmentName[]>([]);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [chatUploading, setChatUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);

  const readyCount = useMemo(
    () => documents.filter((document) => document.status === "READY").length,
    [documents]
  );

  const isEmptyChat = messages.length <= 1 && !answering;

  function signOut() {
    clearSession();
    router.replace("/login");
  }

  const handleAuthFailure = useCallback(
    (caught: unknown, fallback: string) => {
      if (caught instanceof ApiError && caught.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      setError(caught instanceof Error ? caught.message : fallback);
    },
    [router]
  );

  async function refreshDocuments(activeSession = session) {
    if (!activeSession) {
      return;
    }

    setLoadingDocuments(true);
    try {
      const result = await listDocuments(activeSession.token);
      setDocuments(result.documents);
    } catch (caught) {
      handleAuthFailure(caught, "Could not load documents.");
    } finally {
      setLoadingDocuments(false);
    }
  }

  const refreshConversations = useCallback(
    async (activeSession: AuthSession) => {
      try {
        const result = await listConversations(activeSession.token);
        setConversations(result.conversations);
      } catch (caught) {
        handleAuthFailure(caught, "Could not load conversations.");
      }
    },
    [handleAuthFailure]
  );

  useEffect(() => {
    const cached = getSession();
    if (!cached) {
      router.replace("/login");
      return;
    }
    if (cached.user.mustChangePassword) {
      router.replace("/change-password");
      return;
    }

    async function boot(active: AuthSession) {
      try {
        // Refresh roles/department from the server — the token only carries
        // identity, so permission changes appear on the next page load.
        const current = await me(active.token);
        const refreshed = { token: active.token, user: current.user };
        setSession(refreshed);
        setSessionState(refreshed);
        if (current.user.mustChangePassword) {
          router.replace("/change-password");
          return;
        }
        await Promise.all([
          refreshDocuments(refreshed),
          refreshConversations(refreshed),
          getSuggestions(refreshed.token)
            .then((result) => setSuggestions(result.suggestions))
            .catch(() => setSuggestions([]))
        ]);
      } catch (caught) {
        if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "Could not start workspace.");
      }
    }

    void boot(cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const activeUser = session?.user ?? null;
  const isAdmin = activeUser?.roles.includes("ADMIN") ?? false;

  function startNewChat() {
    setActiveConversationId(null);
    setMessages([greeting]);
    setError(null);
  }

  function selectProvider(next: "openai" | "huggingface") {
    if (next === "openai" && !getOpenAiKey()) {
      // OpenAI only runs with a key — ask for it before switching.
      setKeyError(null);
      setKeyPanelOpen(true);
      return;
    }
    setProvider(next);
  }

  async function saveOpenAiKey() {
    if (!session || keySaving) {
      return;
    }
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyError("Paste your OpenAI API key (starts with sk-).");
      return;
    }
    setKeySaving(true);
    setKeyError(null);
    try {
      // Validated with a test call before it is accepted.
      await validateAiKey(session.token, { provider: "openai", apiKey: trimmed });
      setOpenAiKey(trimmed);
      setKeyInput("");
      setKeyPanelOpen(false);
      setProvider("openai");
      // A question that failed on a bad key re-runs automatically now.
      if (retryQuestion) {
        const pending = retryQuestion;
        setRetryQuestion(null);
        void ask(pending, "openai");
      }
    } catch (caught) {
      setKeyError(
        caught instanceof ApiError && caught.code === "PROVIDER_KEY_INVALID"
          ? "That key was rejected by OpenAI. Please enter a valid API key."
          : caught instanceof Error
            ? caught.message
            : "Key validation failed."
      );
    } finally {
      setKeySaving(false);
    }
  }

  function disconnectOpenAi() {
    clearOpenAiKey();
    setProvider("huggingface");
    setKeyPanelOpen(false);
  }

  async function openConversation(conversationId: string) {
    if (!session) {
      return;
    }
    setError(null);
    try {
      const result = await getConversation(session.token, conversationId);
      setActiveConversationId(conversationId);
      setMessages([
        greeting,
        ...result.conversation.messages.flatMap<ChatMessage>((message) => [
          { role: "user", content: message.question },
          {
            role: "assistant",
            content: message.answer,
            sources: message.sources,
            grounded: message.grounded
          }
        ])
      ]);
    } catch (caught) {
      handleAuthFailure(caught, "Could not load conversation.");
    }
  }

  async function removeConversation(conversationId: string) {
    if (!session) {
      return;
    }
    try {
      await deleteConversation(session.token, conversationId);
      if (activeConversationId === conversationId) {
        startNewChat();
      }
      await refreshConversations(session);
    } catch (caught) {
      handleAuthFailure(caught, "Could not delete conversation.");
    }
  }

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!session || !file) {
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
      await uploadDocument(session.token, formData);
      setTitle("");
      setUploadRoles([]);
      setUploadDepartments([]);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
      await refreshDocuments(session);
    } catch (caught) {
      handleAuthFailure(caught, "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function onChatUpload(file: File) {
    if (!session || chatUploading) {
      return;
    }
    setChatUploading(true);
    setError(null);
    setMessages((current) => [
      ...current,
      { role: "upload", content: `Uploading “${file.name}”…` }
    ]);
    try {
      const result = await chatUploadDocument(session.token, file);
      setMessages((current) => [
        ...current.slice(0, -1),
        {
          role: "upload",
          content: `“${result.document.title}” is indexed and private to you (an admin can share it wider). Ask away.`
        }
      ]);
      await refreshDocuments(session);
    } catch (caught) {
      setMessages((current) => current.slice(0, -1));
      handleAuthFailure(caught, "Upload failed.");
    } finally {
      setChatUploading(false);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void onChatUpload(file);
    }
  }

  async function ask(text: string, askProvider: "openai" | "huggingface" = provider) {
    const trimmed = text.trim();
    if (!session || !trimmed || answering) {
      return;
    }

    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setQuestion("");
    setAnswering(true);
    setError(null);

    try {
      const result = await askQuestion(
        session.token,
        {
          question: trimmed,
          provider: askProvider,
          ...(activeConversationId ? { conversationId: activeConversationId } : {})
        },
        getOpenAiKey()
      );
      setActiveConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          grounded: result.grounded
        }
      ]);
      await refreshConversations(session);
    } catch (caught) {
      // A rejected/missing OpenAI key is NOT a session failure: withdraw the
      // question, ask for a valid key, and re-run automatically once saved.
      if (
        caught instanceof ApiError &&
        (caught.code === "PROVIDER_KEY_INVALID" || caught.code === "PROVIDER_KEY_REQUIRED")
      ) {
        clearOpenAiKey();
        setMessages((current) => current.slice(0, -1));
        setRetryQuestion(trimmed);
        setKeyError(
          caught.code === "PROVIDER_KEY_INVALID"
            ? "Your OpenAI key was rejected. Enter a valid key and your question will run."
            : "OpenAI needs your API key. Enter it and your question will run."
        );
        setKeyPanelOpen(true);
        return;
      }
      handleAuthFailure(caught, "Question failed.");
    } finally {
      setAnswering(false);
    }
  }

  async function onAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await ask(question);
  }

  async function onDownload(documentId: string, filename: string) {
    if (!session) {
      return;
    }
    try {
      await downloadDocument(session.token, documentId, filename);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
        setError("This document is not available to your current role.");
        return;
      }
      handleAuthFailure(caught, "Download failed.");
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
              <Metric icon={Building2} label="Workspace" value={session ? "Ready" : "Starting"} />
              <Metric icon={FileText} label="Docs" value={String(documents.length)} />
              <Metric icon={Search} label="Indexed" value={String(readyCount)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded border border-line px-2 py-1.5 text-sm text-ink">
                <UserRound className="h-4 w-4 text-muted" aria-hidden="true" />
                {activeUser ? (
                  <>
                    {activeUser.email}
                    <span className="text-xs text-muted">
                      {activeUser.roles.join("+")} · {activeUser.department}
                    </span>
                  </>
                ) : (
                  "…"
                )}
              </span>
              {isAdmin ? (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 rounded border border-line px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-accent"
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  Admin
                </Link>
              ) : null}
              <button
                type="button"
                onClick={signOut}
                className="flex items-center gap-1.5 rounded border border-line px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-accent"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className="space-y-5">
          <div className="rounded border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-base font-semibold text-ink">Conversations</h2>
              <button
                type="button"
                onClick={startNewChat}
                className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New chat
              </button>
            </div>
            <div className="max-h-[220px] overflow-y-auto p-2">
              {conversations.length === 0 ? (
                <p className="rounded border border-dashed border-line p-3 text-xs text-muted">
                  No conversations yet — your chats are saved per user.
                </p>
              ) : (
                <ul className="space-y-1">
                  {conversations.map((conversation) => (
                    <li key={conversation.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void openConversation(conversation.id)}
                        className={clsx(
                          "min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm",
                          conversation.id === activeConversationId
                            ? "bg-ink text-white"
                            : "text-ink hover:bg-paper"
                        )}
                        title={conversation.title}
                      >
                        {conversation.title}
                        <span
                          className={clsx(
                            "ml-2 text-xs",
                            conversation.id === activeConversationId ? "text-white/70" : "text-muted"
                          )}
                        >
                          {conversation.messageCount}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeConversation(conversation.id)}
                        className="invisible grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:text-red-600 group-hover:visible"
                        title="Delete conversation"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

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
                Drop a file into the chat to ask about it — it stays private to you. Only admins
                can publish documents for the whole company.
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
                disabled={uploading || !session}
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
            <div className="max-h-[300px] overflow-y-auto p-3">
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

        <section
          className="relative flex min-h-[680px] flex-col rounded border border-line bg-white shadow-panel"
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) {
              setDragActive(false);
            }
          }}
          onDrop={onDrop}
        >
          {dragActive ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded border-2 border-dashed border-accent bg-accent/5">
              <div className="flex items-center gap-2 rounded bg-white px-4 py-3 text-sm font-semibold text-accent shadow-panel">
                <FileUp className="h-5 w-5" aria-hidden="true" />
                Drop to upload — private to you, ask about it immediately
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-accent" aria-hidden="true" />
              <h2 className="text-base font-semibold text-ink">Assistant</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex w-fit rounded border border-line p-1">
                {(["huggingface", "openai"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => selectProvider(item)}
                    className={clsx(
                      "rounded px-3 py-1.5 text-sm font-medium capitalize",
                      provider === item ? "bg-ink text-white" : "text-muted hover:text-ink"
                    )}
                    title={
                      item === "openai" ? "Runs with your own OpenAI API key" : "Default model"
                    }
                  >
                    {item === "openai" ? "OpenAI" : "Hugging Face"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setKeyError(null);
                  setKeyPanelOpen((open) => !open);
                }}
                className={clsx(
                  "grid h-9 w-9 place-items-center rounded border border-line hover:border-accent hover:text-accent",
                  provider === "openai" ? "text-accent" : "text-muted"
                )}
                title="OpenAI API key"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {keyPanelOpen ? (
            <div className="border-b border-line bg-paper px-4 py-3">
              <p className="mb-2 text-xs text-muted">
                OpenAI runs with <span className="font-semibold text-ink">your own API key</span>.
                It is checked with a test call, kept only in this browser, sent with your
                questions, and never stored on the server.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveOpenAiKey();
                    }
                  }}
                  placeholder={getOpenAiKey() ? "Key saved — paste a new key to replace" : "sk-…"}
                  className="min-w-[260px] flex-1 rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void saveOpenAiKey()}
                  disabled={keySaving}
                  className="flex items-center gap-1.5 rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {keySaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {keySaving ? "Checking…" : "Save & use OpenAI"}
                </button>
                {getOpenAiKey() ? (
                  <button
                    type="button"
                    onClick={disconnectOpenAi}
                    className="rounded border border-line px-3 py-2 text-sm font-medium text-red-700 hover:border-red-400"
                  >
                    Remove key
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setKeyPanelOpen(false);
                      setRetryQuestion(null);
                    }}
                    className="rounded border border-line px-3 py-2 text-sm font-medium text-muted hover:border-accent hover:text-accent"
                  >
                    Keep Hugging Face
                  </button>
                )}
              </div>
              {keyError ? (
                <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {keyError}
                </p>
              ) : null}
            </div>
          ) : null}

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
                {message.role === "upload" ? (
                  <div className="flex items-center gap-2 rounded border border-dashed border-accent/50 bg-accent/5 px-4 py-2 text-sm text-ink">
                    <Paperclip className="h-4 w-4 text-accent" aria-hidden="true" />
                    {message.content}
                  </div>
                ) : (
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
                )}
              </div>
            ))}
            {answering ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Retrieving context
              </div>
            ) : null}

            {isEmptyChat && suggestions.length > 0 ? (
              <div className="rounded border border-dashed border-line p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <Lightbulb className="h-3.5 w-3.5 text-signal" aria-hidden="true" />
                  {suggestions.some((item) => item.source === "popular")
                    ? "Popular in your department"
                    : "Try asking"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.question}
                      type="button"
                      onClick={() => void ask(suggestion.question)}
                      className="rounded-full border border-line px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
                    >
                      {suggestion.question}
                    </button>
                  ))}
                </div>
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
              <input
                ref={chatFileRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.csv,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void onChatUpload(file);
                  }
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => chatFileRef.current?.click()}
                disabled={chatUploading || !session}
                className="grid h-12 w-12 shrink-0 place-items-center rounded border border-line text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                title="Attach a document (private to you)"
              >
                {chatUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                placeholder={
                  activeConversationId
                    ? "Ask a follow-up — the conversation remembers context"
                    : "What is our refund policy?"
                }
                className="min-h-12 flex-1 resize-none rounded border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={answering || !question.trim() || !session}
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

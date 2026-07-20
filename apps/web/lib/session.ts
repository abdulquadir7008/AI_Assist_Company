export type Role = "ADMIN" | "HR" | "LEGAL" | "MANAGER" | "EMPLOYEE" | "CONTRACTOR";
export type DepartmentName =
  | "GENERAL"
  | "ENGINEERING"
  | "HR"
  | "LEGAL"
  | "SALES"
  | "SUPPORT"
  | "LEADERSHIP";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
  department: DepartmentName;
  companyId: string;
  mustChangePassword: boolean;
};

export type AuthSession = { token: string; user: SessionUser };
export type RootSession = { token: string; email: string };

const SESSION_KEY = "company-rag-session-v1";
const ROOT_SESSION_KEY = "company-rag-root-session-v1";

function read<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export const getSession = () => read<AuthSession>(SESSION_KEY);
export const setSession = (session: AuthSession) =>
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
export const clearSession = () => window.localStorage.removeItem(SESSION_KEY);

export const getRootSession = () => read<RootSession>(ROOT_SESSION_KEY);
export const setRootSession = (session: RootSession) =>
  window.localStorage.setItem(ROOT_SESSION_KEY, JSON.stringify(session));
export const clearRootSession = () => window.localStorage.removeItem(ROOT_SESSION_KEY);

// The user's own OpenAI key: kept in THIS browser only, sent per request,
// never persisted server-side.
const OPENAI_KEY_KEY = "company-rag-openai-key-v1";

export const getOpenAiKey = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(OPENAI_KEY_KEY);
export const setOpenAiKey = (key: string) => window.localStorage.setItem(OPENAI_KEY_KEY, key);
export const clearOpenAiKey = () => window.localStorage.removeItem(OPENAI_KEY_KEY);

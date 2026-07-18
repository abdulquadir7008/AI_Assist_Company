import type { DepartmentName, Role, SessionUser } from "./session";

export type { DepartmentName, Role, SessionUser };

export type CompanyUser = {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
  department: DepartmentName;
  emailVerifiedAt?: string | null;
  mustChangePassword?: boolean;
};

export type CompanyDocument = {
  id: string;
  title: string;
  originalName: string;
  category: string;
  status: string;
  failureReason?: string | null;
  allowedRoles: Role[];
  allowedDepartments: DepartmentName[];
  createdAt: string;
  _count?: { chunks: number };
};

export type Source = {
  id: number;
  documentId: string;
  chunkId: string;
  document: string;
  section: string | null;
  page: number | null;
  page_end: number | null;
  last_updated: string | null;
  category: string;
};

export type AdminDocument = {
  id: string;
  title: string;
  originalName: string;
  category: string;
  status: string;
  allowedRoles: Role[];
  allowedDepartments: DepartmentName[];
  unclassified: boolean;
  classifiedAt: string | null;
  legacyVisibilityHint: string;
  chunkCount: number;
  overriddenChunks: {
    id: string;
    index: number;
    section: string | null;
    overrideRoles: Role[];
    overrideDepartments: DepartmentName[];
  }[];
  createdAt: string;
};

export type AccessMatrix = {
  roles: Role[];
  departments: DepartmentName[];
  documents: {
    id: string;
    title: string;
    unclassified: boolean;
    access: Record<Role, boolean>;
    departmentAccess: Record<DepartmentName, boolean>;
  }[];
};

export type AuditEntry = {
  id: string;
  userId: string | null;
  rolesSnapshot: Role[];
  department: DepartmentName | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type RootCompany = {
  id: string;
  name: string;
  slug: string;
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
  userCount: number;
  documentCount: number;
  createdAt: string;
};

export type RootCompanyUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function parseOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? fallbackMessage, body?.code);
  }
  return body as T;
}

// ---- Onboarding / session ----

export async function register(payload: {
  companyName: string;
  userName: string;
  email: string;
  password: string;
}) {
  const response = await fetch(`${apiUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ ok: true; email: string; message: string; devVerificationCode?: string }>(
    response,
    "Registration failed."
  );
}

export async function verifyEmail(payload: { email: string; code: string }) {
  const response = await fetch(`${apiUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ ok: true }>(response, "Verification failed.");
}

export async function resendCode(email: string) {
  const response = await fetch(`${apiUrl}/api/auth/resend-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  return parseOrThrow<{ ok: true; devVerificationCode?: string }>(response, "Could not resend code.");
}

export async function login(payload: { email: string; password: string }) {
  const response = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ token: string; user: SessionUser }>(response, "Sign-in failed.");
}

export async function me(token: string) {
  const response = await fetch(`${apiUrl}/api/auth/me`, { headers: bearer(token) });
  return parseOrThrow<{ user: SessionUser }>(response, "Session expired.");
}

export async function changePassword(
  token: string,
  payload: { currentPassword: string; newPassword: string }
) {
  const response = await fetch(`${apiUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(token) },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ ok: true }>(response, "Could not change password.");
}

export async function setupDemo() {
  const response = await fetch(`${apiUrl}/api/setup/demo`, { method: "POST" });
  return parseOrThrow<{ companyId: string; password: string; users: CompanyUser[] }>(
    response,
    "Demo setup is not available."
  );
}

// ---- Tenant features ----

export async function listDocuments(token: string) {
  const response = await fetch(`${apiUrl}/api/documents`, { headers: bearer(token) });
  return parseOrThrow<{ documents: CompanyDocument[] }>(response, "Could not load documents.");
}

export async function uploadDocument(token: string, formData: FormData) {
  const response = await fetch(`${apiUrl}/api/documents`, {
    method: "POST",
    headers: bearer(token),
    body: formData
  });
  return parseOrThrow<{ document: CompanyDocument }>(response, "Upload failed.");
}

export async function askQuestion(
  token: string,
  payload: { question: string; provider: "openai" | "huggingface" }
) {
  const response = await fetch(`${apiUrl}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(token) },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ answer: string; sources: Source[]; grounded: boolean; questionId: string }>(
    response,
    "Question failed."
  );
}

export async function downloadDocument(token: string, documentId: string, filename: string) {
  // Auth travels in headers, so a plain <a href> download won't work.
  const response = await fetch(`${apiUrl}/api/documents/${documentId}/file`, {
    headers: bearer(token)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.error ?? "Could not download document.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---- Company admin ----

function jsonHeaders(token: string) {
  return { "content-type": "application/json", ...bearer(token) };
}

export async function adminListUsers(token: string) {
  const response = await fetch(`${apiUrl}/api/admin/users`, { headers: bearer(token) });
  return parseOrThrow<{ users: CompanyUser[] }>(response, "Could not load users.");
}

export async function adminCreateUser(
  token: string,
  payload: {
    email: string;
    name: string;
    roles: Role[];
    department: DepartmentName;
    tempPassword?: string;
  }
) {
  const response = await fetch(`${apiUrl}/api/admin/users`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ user: CompanyUser; tempPassword: string }>(response, "Could not create user.");
}

export async function adminUpdateUser(
  token: string,
  userId: string,
  payload: { roles?: Role[]; department?: DepartmentName }
) {
  const response = await fetch(`${apiUrl}/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: jsonHeaders(token),
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ user: CompanyUser }>(response, "Could not update user.");
}

export async function adminListDocuments(token: string) {
  const response = await fetch(`${apiUrl}/api/admin/documents`, { headers: bearer(token) });
  return parseOrThrow<{ documents: AdminDocument[] }>(response, "Could not load documents.");
}

export async function adminUpdateDocumentAccess(
  token: string,
  documentId: string,
  payload: { allowedRoles: Role[]; allowedDepartments: DepartmentName[] }
) {
  const response = await fetch(`${apiUrl}/api/admin/documents/${documentId}/access`, {
    method: "PATCH",
    headers: jsonHeaders(token),
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ ok: true }>(response, "Could not update document access.");
}

export async function adminBulkAccess(
  token: string,
  payload: {
    documentIds?: string[];
    category?: string;
    allowedRoles: Role[];
    allowedDepartments: DepartmentName[];
  }
) {
  const response = await fetch(`${apiUrl}/api/admin/documents/bulk-access`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ ok: true; updated: number }>(response, "Bulk update failed.");
}

export async function adminAccessMatrix(token: string) {
  const response = await fetch(`${apiUrl}/api/admin/access-matrix`, { headers: bearer(token) });
  return parseOrThrow<AccessMatrix>(response, "Could not load access matrix.");
}

export async function adminAudit(token: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`${apiUrl}/api/admin/audit${query}`, { headers: bearer(token) });
  return parseOrThrow<{ entries: AuditEntry[]; nextCursor: string | null }>(
    response,
    "Could not load audit log."
  );
}

// ---- Root admin (platform ops — separate token scope) ----

export async function rootLogin(payload: { email: string; password: string }) {
  const response = await fetch(`${apiUrl}/api/root/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ token: string; rootAdmin: { id: string; email: string } }>(
    response,
    "Root sign-in failed."
  );
}

export async function rootListCompanies(token: string) {
  const response = await fetch(`${apiUrl}/api/root/companies`, { headers: bearer(token) });
  return parseOrThrow<{ companies: RootCompany[] }>(response, "Could not load companies.");
}

export async function rootListCompanyUsers(token: string, companyId: string) {
  const response = await fetch(`${apiUrl}/api/root/companies/${companyId}/users`, {
    headers: bearer(token)
  });
  return parseOrThrow<{ users: RootCompanyUser[] }>(response, "Could not load users.");
}

export async function rootSetCompanyStatus(
  token: string,
  companyId: string,
  status: "ACTIVE" | "SUSPENDED"
) {
  const response = await fetch(`${apiUrl}/api/root/companies/${companyId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...bearer(token) },
    body: JSON.stringify({ status })
  });
  return parseOrThrow<{ ok: true }>(response, "Could not update company.");
}

export async function rootVerifyUser(token: string, userId: string) {
  const response = await fetch(`${apiUrl}/api/root/users/${userId}/verify`, {
    method: "PATCH",
    headers: bearer(token)
  });
  return parseOrThrow<{ ok: true }>(response, "Could not verify user.");
}

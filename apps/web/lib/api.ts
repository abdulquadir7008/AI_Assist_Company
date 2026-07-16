export type Role = "ADMIN" | "HR" | "LEGAL" | "MANAGER" | "EMPLOYEE" | "CONTRACTOR";
export type DepartmentName =
  | "GENERAL"
  | "ENGINEERING"
  | "HR"
  | "LEGAL"
  | "SALES"
  | "SUPPORT"
  | "LEADERSHIP";

export type DemoUser = {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
  department: DepartmentName;
};

export type TenantContext = {
  companyId: string;
  userId?: string;
  users: DemoUser[];
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function headers(context?: TenantContext) {
  return {
    ...(context?.companyId ? { "x-company-id": context.companyId } : {}),
    ...(context?.userId ? { "x-user-id": context.userId } : {})
  };
}

async function parseOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? fallbackMessage);
  }
  return body as T;
}

export async function setupDemo(): Promise<TenantContext> {
  const response = await fetch(`${apiUrl}/api/setup/demo`, { method: "POST" });
  const body = await parseOrThrow<{ companyId: string; users: DemoUser[] }>(
    response,
    "Could not create demo workspace."
  );
  return { ...body, userId: body.users[0]?.id };
}

export async function listDocuments(context: TenantContext) {
  const response = await fetch(`${apiUrl}/api/documents`, { headers: headers(context) });
  return parseOrThrow<{ documents: CompanyDocument[] }>(response, "Could not load documents.");
}

export async function uploadDocument(context: TenantContext, formData: FormData) {
  const response = await fetch(`${apiUrl}/api/documents`, {
    method: "POST",
    headers: headers(context),
    body: formData
  });
  return parseOrThrow<{ document: CompanyDocument }>(response, "Upload failed.");
}

export async function askQuestion(
  context: TenantContext,
  payload: { question: string; provider: "openai" | "huggingface" }
) {
  const response = await fetch(`${apiUrl}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers(context) },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ answer: string; sources: Source[]; grounded: boolean; questionId: string }>(
    response,
    "Question failed."
  );
}

export async function downloadDocument(
  context: TenantContext,
  documentId: string,
  filename: string
) {
  // Tenant auth travels in headers, so a plain <a href> download won't work.
  const response = await fetch(`${apiUrl}/api/documents/${documentId}/file`, {
    headers: headers(context)
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

// ---- Admin API ----

function jsonHeaders(context: TenantContext) {
  return { "content-type": "application/json", ...headers(context) };
}

export async function adminListUsers(context: TenantContext) {
  const response = await fetch(`${apiUrl}/api/admin/users`, { headers: headers(context) });
  return parseOrThrow<{ users: DemoUser[] }>(response, "Could not load users.");
}

export async function adminUpdateUser(
  context: TenantContext,
  userId: string,
  payload: { roles?: Role[]; department?: DepartmentName }
) {
  const response = await fetch(`${apiUrl}/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: jsonHeaders(context),
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ user: DemoUser }>(response, "Could not update user.");
}

export async function adminListDocuments(context: TenantContext) {
  const response = await fetch(`${apiUrl}/api/admin/documents`, { headers: headers(context) });
  return parseOrThrow<{ documents: AdminDocument[] }>(response, "Could not load documents.");
}

export async function adminUpdateDocumentAccess(
  context: TenantContext,
  documentId: string,
  payload: { allowedRoles: Role[]; allowedDepartments: DepartmentName[] }
) {
  const response = await fetch(`${apiUrl}/api/admin/documents/${documentId}/access`, {
    method: "PATCH",
    headers: jsonHeaders(context),
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ ok: true }>(response, "Could not update document access.");
}

export async function adminBulkAccess(
  context: TenantContext,
  payload: {
    documentIds?: string[];
    category?: string;
    allowedRoles: Role[];
    allowedDepartments: DepartmentName[];
  }
) {
  const response = await fetch(`${apiUrl}/api/admin/documents/bulk-access`, {
    method: "POST",
    headers: jsonHeaders(context),
    body: JSON.stringify(payload)
  });
  return parseOrThrow<{ ok: true; updated: number }>(response, "Bulk update failed.");
}

export async function adminAccessMatrix(context: TenantContext) {
  const response = await fetch(`${apiUrl}/api/admin/access-matrix`, { headers: headers(context) });
  return parseOrThrow<AccessMatrix>(response, "Could not load access matrix.");
}

export async function adminAudit(context: TenantContext, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`${apiUrl}/api/admin/audit${query}`, { headers: headers(context) });
  return parseOrThrow<{ entries: AuditEntry[]; nextCursor: string | null }>(
    response,
    "Could not load audit log."
  );
}

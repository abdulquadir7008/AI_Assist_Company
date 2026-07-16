export type TenantContext = {
  companyId: string;
  userId?: string;
};

export type CompanyDocument = {
  id: string;
  title: string;
  originalName: string;
  category: string;
  visibility: string;
  status: string;
  failureReason?: string | null;
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

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function headers(context?: TenantContext) {
  return {
    ...(context?.companyId ? { "x-company-id": context.companyId } : {}),
    ...(context?.userId ? { "x-user-id": context.userId } : {})
  };
}

export async function setupDemo() {
  const response = await fetch(`${apiUrl}/api/setup/demo`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Could not create demo workspace.");
  }
  return response.json() as Promise<TenantContext>;
}

export async function listDocuments(context: TenantContext) {
  const response = await fetch(`${apiUrl}/api/documents`, { headers: headers(context) });
  if (!response.ok) {
    throw new Error("Could not load documents.");
  }
  return response.json() as Promise<{ documents: CompanyDocument[] }>;
}

export async function uploadDocument(context: TenantContext, formData: FormData) {
  const response = await fetch(`${apiUrl}/api/documents`, {
    method: "POST",
    headers: headers(context),
    body: formData
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Upload failed.");
  }
  return body as Promise<{ document: CompanyDocument }>;
}

export async function askQuestion(
  context: TenantContext,
  payload: { question: string; provider: "openai" | "huggingface" }
) {
  const response = await fetch(`${apiUrl}/api/ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers(context)
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Question failed.");
  }
  return body as Promise<{
    answer: string;
    sources: Source[];
    grounded: boolean;
    questionId: string;
  }>;
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
    throw new Error(body?.error ?? "Could not download document.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

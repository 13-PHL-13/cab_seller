export type CompanyRole = "owner" | "admin" | "lead" | "employee";
export interface WorkspaceMember {
  userId: string; email: string; role: CompanyRole; sections: string[]; storeAccess: "all" | string[];
  canSeeFinance: boolean; canEditCogs: boolean; canApprovePrices: boolean; canIssueTasks: boolean;
  tokenLimit: number | null; createdAt: string;
}
export interface WorkspaceInvitation {
  id: string; email: string; role: Exclude<CompanyRole, "owner">; sections: string[]; expiresAt: string; createdAt: string;
}
export interface Workspace {
  companies: Array<{ id: string; name: string; role: CompanyRole }>;
  activeCompanyId: string; currentUserId: string; role: CompanyRole; members: WorkspaceMember[]; invitations: WorkspaceInvitation[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "include", headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers,
    } });
  } catch { throw new Error("Не удалось связаться с сервером."); }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload && typeof payload.error === "string" ? payload.error : `Ошибка сервера (${response.status}).`);
  return payload as T;
}

export const getWorkspace = () => request<Workspace>("/api/workspace");
export const createCompany = (name: string) => request<{ company: Workspace["companies"][number] }>("/api/workspace/companies", { method: "POST", body: JSON.stringify({ name }) });
export const switchCompany = (companyId: string) => request<{ activeCompanyId: string }>("/api/workspace/active", { method: "POST", body: JSON.stringify({ companyId }) });
export const inviteMember = (input: { email: string; role: Exclude<CompanyRole, "owner">; permissions: Record<string, unknown> }) => request<{ id: string; email: string; role: string; expiresAt: string; link: string }>("/api/workspace/invitations", { method: "POST", body: JSON.stringify(input) });
export const revokeInvitation = (id: string) => request<void>(`/api/workspace/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
export const removeMember = (id: string) => request<void>(`/api/workspace/members/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getInvitation = (token: string) => request<{ companyName: string; email: string; role: string }>(`/api/workspace/invitations/${encodeURIComponent(token)}`);
export const acceptInvitation = (token: string) => request<{ accepted: boolean }>(`/api/workspace/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });

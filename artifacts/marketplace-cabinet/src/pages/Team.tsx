import { useEffect, useState, type FormEvent } from "react";
import { Building2, Copy, Plus, RefreshCw, Send, Trash2, UserPlus, Users } from "lucide-react";
import { acceptInvitation, createCompany, getInvitation, getWorkspace, inviteMember, removeMember, revokeInvitation, switchCompany } from "@/lib/workspace-api";
import type { CompanyRole, Workspace } from "@/lib/workspace-api";
import { getMarketplaceStores } from "@/lib/marketplace-api";

const ROLE_LABEL: Record<CompanyRole, string> = { owner: "Владелец", admin: "Администратор", lead: "Руководитель", employee: "Сотрудник" };
const SECTION_LABELS: Record<string, string> = { dashboard: "Дашборд", marketplaces: "Маркетплейсы", funnel: "Воронка", analytics: "Аналитика", finance: "Финансы", products: "Товары", tasks: "Задачи", settings: "Настройки" };

export default function TeamPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<CompanyRole, "owner">>("employee");
  const [sections, setSections] = useState(["dashboard", "marketplaces", "funnel", "analytics", "products"]);
  const [storeOptions, setStoreOptions] = useState<Array<{ id: number; storeName: string; marketplace: string }>>([]);
  const [storeAccessAll, setStoreAccessAll] = useState(true); const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [finance, setFinance] = useState(false); const [editCogs, setEditCogs] = useState(false); const [prices, setPrices] = useState(false); const [tasks, setTasks] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [inviteLink, setInviteLink] = useState("");
  const [invitation, setInvitation] = useState<{ companyName: string; email: string; role: string } | null>(null);
  const invitationToken = new URLSearchParams(window.location.search).get("token");

  async function refresh() { setError(""); try { setWorkspace(await getWorkspace()); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить компанию."); return; } try { setStoreOptions((await getMarketplaceStores()).stores); } catch { setStoreOptions([]); } }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (invitationToken) void getInvitation(invitationToken).then(setInvitation).catch((err) => setError(err instanceof Error ? err.message : "Приглашение недействительно.")); }, [invitationToken]);

  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await createCompany(name); window.location.reload(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось создать компанию."); } finally { setBusy(false); } }
  async function chooseCompany(id: string) { setBusy(true); setError(""); try { await switchCompany(id); window.location.reload(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сменить компанию."); } finally { setBusy(false); } }
  async function sendInvite(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); setMessage(""); setInviteLink(""); try {
    const result = await inviteMember({ email, role, permissions: { sections, storeAccess: storeAccessAll ? "all" : selectedStores, canSeeFinance: finance, canEditCogs: editCogs, canApprovePrices: prices, canIssueTasks: tasks } });
    setInviteLink(result.link); setMessage(`Приглашение отправлено на ${result.email}.`); setEmail(""); await refresh();
  } catch (err) { setError(err instanceof Error ? err.message : "Не удалось отправить приглашение."); } finally { setBusy(false); } }

  async function accept() { if (!invitationToken) return; setBusy(true); setError(""); try { await acceptInvitation(invitationToken); window.history.replaceState({}, "", "/team"); window.location.reload(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось принять приглашение."); } finally { setBusy(false); } }
  async function copyLink() { if (!inviteLink) return; await navigator.clipboard.writeText(inviteLink); setMessage("Ссылка скопирована."); }
  async function revoke(id: string) { setBusy(true); setError(""); try { await revokeInvitation(id); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось отозвать приглашение."); } finally { setBusy(false); } }
  async function remove(id: string) { if (!window.confirm("Удалить участника из компании?")) return; setBusy(true); setError(""); try { await removeMember(id); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось удалить участника."); } finally { setBusy(false); } }

  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  return <div className="page">
    <header className="page-header"><div><h1>Компания и команда</h1><p>Общие магазины, товары и отчёты с настраиваемыми правами доступа</p></div><button className="btn" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} /> Обновить</button></header>
    {error && <div className="alert alert-error" role="alert">{error}</div>}{message && <div className="alert alert-success" role="status">{message}</div>}
    {invitation && <section className="card" style={{ marginBottom: 20 }}><h2>Приглашение в компанию</h2><p>Компания «{invitation.companyName}» приглашает {invitation.email} с ролью «{ROLE_LABEL[invitation.role as CompanyRole] ?? invitation.role}».</p><button className="btn btn-primary" disabled={busy} onClick={() => void accept()}>Принять приглашение</button></section>}
    <section className="card" style={{ marginBottom: 20 }}><h2><Building2 size={19} /> Мои компании</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <select value={workspace?.activeCompanyId ?? ""} onChange={(e) => void chooseCompany(e.target.value)} disabled={!workspace || busy} aria-label="Активная компания">
          {workspace?.companies.map((company) => <option key={company.id} value={company.id}>{company.name} · {ROLE_LABEL[company.role]}</option>)}
        </select>
        <form onSubmit={create} style={{ display: "flex", gap: 8 }}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название новой компании" maxLength={120} required /><button className="btn" disabled={busy}><Plus size={16} /> Создать</button></form>
      </div>
    </section>
    {canManage && <section className="card" style={{ marginBottom: 20 }}><h2><UserPlus size={19} /> Пригласить сотрудника</h2>
      <form onSubmit={sendInvite} style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(180px, 240px) auto", gap: 10 }}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" required /><select value={role} onChange={(e) => setRole(e.target.value as Exclude<CompanyRole, "owner">)}><option value="employee">Сотрудник</option><option value="lead">Руководитель</option>{workspace?.role === "owner" && <option value="admin">Администратор</option>}</select><button className="btn btn-primary" disabled={busy}><Send size={16} /> Отправить</button></div>
        <div><b>Доступ к разделам</b><div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>{Object.entries(SECTION_LABELS).map(([id, label]) => <label key={id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={sections.includes(id)} onChange={(e) => setSections((current) => e.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}</div></div>
        <div><b>Доступ к магазинам</b><div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}><label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={storeAccessAll} onChange={(e) => setStoreAccessAll(e.target.checked)} />Все магазины</label>{!storeAccessAll && storeOptions.map((store) => <label key={store.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={selectedStores.includes(String(store.id))} onChange={(e) => setSelectedStores((current) => e.target.checked ? [...current, String(store.id)] : current.filter((id) => id !== String(store.id)))} />{store.storeName} · {store.marketplace}</label>)}{!storeOptions.length && <small>Сначала подключите магазины в настройках API.</small>}</div></div>
        <div><b>Дополнительные права</b><div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={finance} onChange={(e) => setFinance(e.target.checked)} />Видеть финансы</label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={editCogs} onChange={(e) => setEditCogs(e.target.checked)} />Изменять себестоимость</label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} />Утверждать цены</label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} />Ставить задачи</label>
        </div></div>
      </form>
      {inviteLink && <div style={{ display: "flex", gap: 8, marginTop: 12 }}><input readOnly value={inviteLink} aria-label="Ссылка приглашения" /><button type="button" className="btn" onClick={() => void copyLink()}><Copy size={16} /> Скопировать ссылку</button></div>}
    </section>}
    <section className="card" style={{ marginBottom: 20 }}><h2><Users size={19} /> Участники ({workspace?.members.length ?? 0})</h2>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Участник</th><th>Роль</th><th>Разделы</th><th>Права</th><th></th></tr></thead><tbody>{workspace?.members.map((member) => <tr key={member.userId}><td>{member.email}{member.userId === workspace.currentUserId ? " (вы)" : ""}</td><td>{ROLE_LABEL[member.role]}</td><td>{member.sections.map((section) => SECTION_LABELS[section] ?? section).join(", ")}</td><td>{[member.canSeeFinance && "Финансы", member.canEditCogs && "Себестоимость", member.canApprovePrices && "Цены", member.canIssueTasks && "Задачи"].filter(Boolean).join(", ") || "—"}</td><td>{canManage && member.role !== "owner" && member.userId !== workspace.currentUserId && <button className="btn" title="Удалить участника" disabled={busy} onClick={() => void remove(member.userId)}><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div>
    </section>
    {canManage && <section className="card"><h2>Ожидают принятия ({workspace?.invitations.length ?? 0})</h2><div style={{ overflowX: "auto" }}><table><thead><tr><th>Email</th><th>Роль</th><th>Срок</th><th></th></tr></thead><tbody>{workspace?.invitations.map((item) => <tr key={item.id}><td>{item.email}</td><td>{ROLE_LABEL[item.role]}</td><td>{new Date(item.expiresAt).toLocaleDateString("ru-RU")}</td><td><button className="btn" title="Отозвать приглашение" disabled={busy} onClick={() => void revoke(item.id)}><Trash2 size={15} /> Отозвать</button></td></tr>)}</tbody></table></div></section>}
  </div>;
}

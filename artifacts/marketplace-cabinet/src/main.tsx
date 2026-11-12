import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "@/components/error-boundary";
import "./index.css";

type User = { id: string; email: string };
type AuthMode = "login" | "register" | "forgot";

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const endpoint = mode === "forgot" ? "forgot-password" : mode;
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось выполнить запрос.");
      if (mode === "login") onAuthenticated(payload.user);
      else setMessage(payload.message ?? "Проверьте почту.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка соединения с сервером.");
    } finally { setBusy(false); }
  }

  return <div className="empty-state" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
    <form onSubmit={submit} style={{ width: "min(100%, 420px)", padding: 32, borderRadius: 16, background: "var(--card, #fff)", boxShadow: "0 12px 40px #00000012", display: "grid", gap: 16 }}>
      <div><h1 style={{ marginBottom: 8 }}>Навигатор продаж</h1><p>Личный кабинет продавца</p></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className={mode === "login" ? "btn btn-primary" : "btn"} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Войти</button>
        <button type="button" className={mode === "register" ? "btn btn-primary" : "btn"} onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Регистрация</button>
      </div>
      <label style={{ display: "grid", gap: 6 }}>Электронная почта<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      {mode !== "forgot" && <label style={{ display: "grid", gap: 6 }}>Пароль<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></label>}
      {mode === "register" && <small>Не менее 12 символов. После регистрации потребуется подтвердить email.</small>}
      {mode === "forgot" && <small>Если аккаунт существует, мы отправим ссылку для восстановления пароля.</small>}
      {mode === "login" && <button type="button" className="btn" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Забыли пароль?</button>}
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#067647" }}>{message}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти в кабинет" : mode === "forgot" ? "Отправить инструкцию" : "Создать аккаунт"}</button>
    </form>
  </div>;
}


function ResetPasswordScreen() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось изменить пароль.");
      setMessage(payload.message ?? "Пароль изменён.");
      window.history.replaceState({}, "", "/");
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка соединения."); }
    finally { setBusy(false); }
  }
  return <div className="empty-state" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
    <form onSubmit={submit} style={{ width: "min(100%, 420px)", padding: 32, borderRadius: 16, background: "var(--card, #fff)", display: "grid", gap: 16 }}>
      <h1>Новый пароль</h1>
      <label style={{ display: "grid", gap: 6 }}>Пароль (не менее 12 символов)<input type="password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button className="btn btn-primary" disabled={busy || !token}>{busy ? "Сохранение…" : "Сохранить пароль"}</button>
      <a href="/">Вернуться ко входу</a>
    </form>
  </div>;
}

function Root() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifyError, setVerifyError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (window.location.pathname === "/verify-email" && token) {
      fetch("/api/auth/verify-email", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Не удалось подтвердить email.");
        setVerifyMessage(payload.message ?? "Email подтверждён. Теперь войдите.");
        window.history.replaceState({}, "", "/");
      }).catch(err => setVerifyError(err instanceof Error ? err.message : "Ошибка подтверждения."))
        .finally(() => setLoading(false));
      return;
    }
    fetch("/api/auth/me", { credentials: "include" })
      .then(async response => response.ok ? (await response.json()).user as User : null)
      .then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }

  if (loading) return <div className="empty-state">Загрузка личного кабинета…</div>;
  if (window.location.pathname === "/reset-password") return <ResetPasswordScreen />;
  if (!user) return <><AuthScreen onAuthenticated={setUser} />{(verifyMessage || verifyError) && <div role="status" style={{ position: "fixed", bottom: 20, left: 20, right: 20, textAlign: "center" }}>{verifyError || verifyMessage}</div>}</>;
  return <>
    <div style={{ position: "fixed", top: 12, right: 20, zIndex: 100, display: "flex", gap: 12, alignItems: "center", background: "var(--card, #fff)", padding: 8, borderRadius: 10 }}>
      <span>{user.email}</span><button className="btn" onClick={logout}>Выйти</button>
    </div>
    <ErrorBoundary><App /></ErrorBoundary>
  </>;
}

createRoot(document.getElementById("root")!, {
  onCaughtError: (error, errorInfo) => console.error(error, errorInfo.componentStack),
}).render(<Root />);

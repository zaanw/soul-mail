"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  ShieldAlert,
  Trash2,
  Settings,
  Plus,
  Search,
  Menu,
  X,
  ArrowLeft,
  ArrowUpRight,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  Forward,
  Paperclip,
  LoaderCircle,
  LogOut,
  Check,
  ChevronDown,
  Shield,
  RefreshCw,
  Sun,
  Moon,
  Download,
} from "lucide-react";
import Link from "next/link";
import { api, post } from "@/lib/client";
type User = {
  hasAvatar: boolean;
  avatarVersion?: number;
  id: string;
  name: string;
  email: string;
  sendAddress: string;
  handle: string;
  role: string;
  theme: string;
  signature: string;
  notifications: boolean;
  recoveryEmail: string | null;
  verified: boolean;
};
type FileInfo = { id: string; name: string; size: number; type: string };
type Entry = {
  id: string;
  folder: string;
  read: boolean;
  starred: boolean;
  message: {
    id: string;
    sender: string;
    senderName: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    createdAt: string;
    attachments: FileInfo[];
    deliveries: { recipient: string; status: string; code: string | null }[];
  };
};
type Draft = {
  id?: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachments: FileInfo[];
};
const nav = [
  ["inbox", "Входящие", Inbox],
  ["starred", "Избранное", Star],
  ["sent", "Отправленные", Send],
  ["drafts", "Черновики", FileText],
  ["archive", "Архив", Archive],
  ["spam", "Спам", ShieldAlert],
  ["trash", "Корзина", Trash2],
] as const;
const emptyDraft = (signature = ""): Draft => ({
  to: "",
  cc: "",
  subject: "",
  body: signature ? `\n\n${signature}` : "",
  attachments: [],
});
function UserAvatar({ user, large = false }: { user: User; large?: boolean }) {
  return (
    <span className={`avatar ${large ? "large" : ""}`}>
      {user.hasAvatar ? (
        <img
          src={`/api/me/avatar?v=${user.avatarVersion || 0}`}
          alt={user.name}
        />
      ) : (
        user.name[0].toUpperCase()
      )}
    </span>
  );
}
const date = (value: string) =>
  new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" }).format(
    new Date(value),
  );
function applyTheme(theme: string) {
  localStorage.setItem("soul-theme", theme);
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;
}
export function MailApp() {
  const [user, setUser] = useState<User | null>(null),
    [folder, setFolder] = useState("inbox"),
    [entries, setEntries] = useState<Entry[]>([]),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [selected, setSelected] = useState<Entry | null>(null),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("newest"),
    [unread, setUnread] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mobileNav, setMobileNav] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [smtp, setSmtp] = useState(false);
  const refreshSeq = useRef(0);
  const refresh = useCallback(async () => {
    if (["settings", "admin"].includes(folder)) return;
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const r = await api<{
        entries: Entry[];
        counts: { folder: string; _count: number }[];
      }>(
        `messages?${new URLSearchParams({ folder, q: query, sort, unread: String(unread) })}`,
      );
      if (seq !== refreshSeq.current) return;
      setEntries(r.entries);
      setCounts(Object.fromEntries(r.counts.map((c) => [c.folder, c._count])));
    } catch (e) {
      if (seq === refreshSeq.current) setError((e as Error).message);
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, [folder, query, sort, unread]);
  useEffect(() => {
    api<{ user: User; externalMail: boolean }>("me")
      .then((r) => {
        setUser(r.user);
        setSmtp(r.externalMail);
        applyTheme(r.user.theme);
      })
      .catch(() => location.replace("/login"));
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(refresh, 200);
    return () => clearTimeout(timer);
  }, [refresh, user]);
  useEffect(() => {
    if (!user || !user.notifications) return;
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [user, refresh]);
  useEffect(() => {
    if (!draft) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draft]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "n" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !draft &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement)?.tagName,
        )
      ) {
        e.preventDefault();
        setDraft(emptyDraft(user?.signature));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [draft, user]);
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(f: string) {
    setFolder(f);
    setSelected(null);
    setMobileNav(false);
    setError("");
  }
  async function open(e: Entry) {
    await action(async () => {
      const r = await api<{ entry: Entry }>(`messages/${e.id}`);
      if (e.folder === "drafts") {
        const m = r.entry.message;
        setDraft({
          id: e.id,
          to: m.to.join(", "),
          cc: m.cc.join(", "),
          subject: m.subject,
          body: m.body,
          attachments: m.attachments,
        });
      } else {
        const opened = r.entry.read
          ? r
          : await api<{ entry: Entry }>(`messages/${e.id}`, {
              method: "PATCH",
              body: JSON.stringify({ read: true }),
            });
        setSelected(opened.entry);
      }
      await refresh();
    });
  }
  async function change(e: Entry, data: Record<string, unknown>) {
    await action(async () => {
      const r = await api<{ entry: Entry }>(`messages/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      setSelected((s) => (s?.id === e.id ? r.entry : s));
      if (data.folder) setSelected(null);
      await refresh();
    });
  }
  async function remove(e: Entry) {
    if (
      !confirm(
        e.folder === "drafts"
          ? "Удалить черновик безвозвратно?"
          : "Удалить письмо безвозвратно?",
      )
    )
      return;
    await action(async () => {
      await api(`messages/${e.id}`, { method: "DELETE" });
      setSelected(null);
      await refresh();
    });
  }
  function reply(kind: "reply" | "all" | "forward") {
    if (!selected || !user) return;
    const m = selected.message;
    const me = new Set([user.email, user.sendAddress]);
    const recipients = [
      ...new Set([m.sender, ...(kind === "all" ? [...m.to, ...m.cc] : [])]),
    ].filter((a) => !me.has(a));
    setDraft({
      ...emptyDraft(user.signature),
      to: kind === "forward" ? "" : recipients.join(", "),
      subject: `${kind === "forward" ? "Fwd" : "Re"}: ${m.subject}`,
      body: `${user.signature ? "\n\n" + user.signature : ""}\n\n— ${m.sender}, ${date(m.createdAt)} —\n${m.body
        .split("\n")
        .map((l) => "> " + l)
        .join("\n")}`,
    });
  }
  if (!user)
    return (
      <div className="loading-screen">
        <span className="wordmark">
          soul
          <span className="brand-dot" />
        </span>
        <LoaderCircle className="spin" size={20} />
      </div>
    );
  return (
    <div className="mail-app">
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Link className="wordmark" href="/">
            soul
            <span className="brand-dot" />
          </Link>
          <span className="mini-label">MAIL</span>
          <button
            className="icon-button mobile-only"
            aria-label="Закрыть меню"
            onClick={() => setMobileNav(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="button compose-button"
          onClick={() => {
            setDraft(emptyDraft(user.signature));
            setMobileNav(false);
          }}
        >
          <Plus size={18} /> Новое письмо <span>N</span>
        </button>
        <div className="nav-caption">YOUR SPACE</div>
        <nav className="folder-nav">
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={folder === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {!!counts[key] && <small>{counts[key]}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection ${smtp ? "" : "muted"}`}>
            <span className="status-dot" />
            {smtp ? "Провайдер подключён" : "Внутренняя почта"}
            <span
              title={
                smtp
                  ? "Внешние письма передаются почтовому провайдеру"
                  : "Внешний SMTP не настроен"
              }
            >
              ↗
            </span>
          </div>
          <button
            className={`settings-link ${folder === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={17} /> Настройки
          </button>
          {user.role === "ADMIN" && (
            <button className="settings-link" onClick={() => navigate("admin")}>
              <Shield size={17} /> Администрирование
            </button>
          )}
          <button className="account-chip" onClick={() => navigate("settings")}>
            <UserAvatar user={user} />
            <span>
              <strong>{user.name}</strong>
              <small>{user.sendAddress}</small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="menu-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="mail-workspace">
        <header className="app-header">
          <button
            className="icon-button mobile-only"
            aria-label="Открыть меню"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={20} />
          </button>
          <span className="breadcrumb">
            your space <span>/</span>{" "}
            <strong>
              {folder === "settings"
                ? "Настройки"
                : folder === "admin"
                  ? "Администрирование"
                  : nav.find((n) => n[0] === folder)?.[1]}
            </strong>
          </span>
          <span className="app-header-right">
            <span className="mini-label">JUST YOU AND YOUR INBOX.</span>
            <button
              className="icon-button"
              aria-label="Переключить тему"
              onClick={() =>
                action(async () => {
                  const theme = user.theme === "light" ? "dark" : "light";
                  await api("me", {
                    method: "PATCH",
                    body: JSON.stringify({ theme }),
                  });
                  setUser({ ...user, theme });
                  applyTheme(theme);
                })
              }
            >
              {user.theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </span>
        </header>
        {(error || notice) && (
          <div
            className={`global-alert ${error ? "error" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error || notice}
            <button
              aria-label="Закрыть уведомление"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {folder === "settings" ? (
          <SettingsPanel
            user={user}
            setUser={setUser}
            smtp={smtp}
            onError={setError}
            onNotice={setNotice}
          />
        ) : folder === "admin" ? (
          <AdminPanel onError={setError} />
        ) : (
          <div className={`mail-columns ${selected ? "has-selection" : ""}`}>
            <section className="message-list">
              <div className="list-heading">
                <div>
                  <h1>{nav.find((n) => n[0] === folder)?.[1]}</h1>
                  <span>
                    {entries.length}
                    {entries.length === 100 ? "+" : ""} писем
                  </span>
                </div>
                <button
                  className="icon-button"
                  aria-label="Обновить письма"
                  disabled={loading}
                  onClick={refresh}
                >
                  <RefreshCw size={16} className={loading ? "spin" : ""} />
                </button>
              </div>
              <div className="search-box">
                <Search size={16} />
                <input
                  aria-label="Поиск писем"
                  placeholder="Найти письмо…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="Очистить поиск"
                    onClick={() => setQuery("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="list-filters">
                <button
                  className={unread ? "active" : ""}
                  onClick={() => setUnread(!unread)}
                >
                  {unread ? "Непрочитанные" : "Все письма"}
                  <ChevronDown size={12} />
                </button>
                <select
                  aria-label="Сортировка"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="newest">Сначала новые</option>
                  <option value="oldest">Сначала старые</option>
                </select>
              </div>
              <div className="mail-rows">
                {loading && entries.length === 0 ? (
                  <div className="list-state">
                    <LoaderCircle size={20} className="spin" />
                    <p>Загружаем письма…</p>
                  </div>
                ) : entries.length === 0 ? (
                  <div className="list-state">
                    <Inbox size={30} strokeWidth={1} />
                    <h3>{query ? "Ничего не найдено" : "Здесь пока тихо."}</h3>
                    <p>
                      {query
                        ? "Попробуйте другой запрос."
                        : folder === "drafts"
                          ? "Сохранённые черновики появятся здесь."
                          : "Самое время написать первым."}
                    </p>
                    {!query && (
                      <button
                        className="text-link"
                        onClick={() => setDraft(emptyDraft(user.signature))}
                      >
                        Написать письмо <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                ) : (
                  entries.map((e) => (
                    <article
                      key={e.id}
                      className={`message-row ${!e.read ? "unread" : ""} ${selected?.id === e.id ? "selected" : ""}`}
                    >
                      <button className="message-open" onClick={() => open(e)}>
                        <div className="row-top">
                          <span className="row-sender">
                            {["sent", "drafts"].includes(e.folder)
                              ? e.message.to.join(", ") || "Без получателя"
                              : e.message.senderName}
                          </span>
                          <time>{date(e.message.createdAt)}</time>
                        </div>
                        <div className="row-subject">
                          {!e.read && <span className="unread-dot" />}
                          {e.message.subject || "Без темы"}
                          {e.message.attachments.length > 0 && (
                            <Paperclip size={12} />
                          )}
                        </div>
                        <p>{e.message.body.trim() || "Пустое письмо"}</p>
                      </button>
                      {e.folder !== "drafts" && (
                        <button
                          className={`row-star ${e.starred ? "is-starred" : ""}`}
                          aria-label={
                            e.starred ? "Убрать из избранного" : "В избранное"
                          }
                          onClick={() => change(e, { starred: !e.starred })}
                        >
                          <Star
                            size={15}
                            fill={e.starred ? "currentColor" : "none"}
                          />
                        </button>
                      )}
                    </article>
                  ))
                )}
              </div>
              <div className="list-footer">
                <span className="status-dot" />{" "}
                {smtp
                  ? "Внешний провайдер подключён"
                  : "Внешняя почта не подключена"}
              </div>
            </section>
            <section className="reading-pane">
              {selected ? (
                <>
                  <div className="reading-toolbar">
                    <button
                      className="icon-button"
                      aria-label="Назад к письмам"
                      onClick={() => setSelected(null)}
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <div className="toolbar-actions">
                      <button
                        className="icon-button"
                        aria-label="Архивировать"
                        disabled={busy}
                        onClick={() => change(selected, { folder: "archive" })}
                      >
                        <Archive size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="В спам"
                        disabled={busy}
                        onClick={() => change(selected, { folder: "spam" })}
                      >
                        <ShieldAlert size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={
                          selected.read
                            ? "Пометить непрочитанным"
                            : "Пометить прочитанным"
                        }
                        disabled={busy}
                        onClick={() =>
                          change(selected, { read: !selected.read })
                        }
                      >
                        {selected.read ? (
                          <Mail size={17} />
                        ) : (
                          <MailOpen size={17} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Удалить"
                        disabled={busy}
                        onClick={() =>
                          selected.folder === "trash"
                            ? remove(selected)
                            : change(selected, { folder: "trash" })
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="reading-content">
                    <span className="mini-label">
                      {new Date(selected.message.createdAt).toLocaleString(
                        "ru",
                      )}
                    </span>
                    <h2>{selected.message.subject}</h2>
                    <div className="sender-block">
                      <span className="avatar">
                        {selected.message.senderName[0]?.toUpperCase()}
                      </span>
                      <div>
                        <strong>{selected.message.senderName}</strong>
                        <small>{selected.message.sender}</small>
                        <small>
                          Кому: {selected.message.to.join(", ")}
                          {selected.message.cc.length > 0
                            ? ` · Копия: ${selected.message.cc.join(", ")}`
                            : ""}
                        </small>
                      </div>
                      <button
                        className={`icon-button ${selected.starred ? "is-starred" : ""}`}
                        aria-label="Избранное"
                        onClick={() =>
                          change(selected, { starred: !selected.starred })
                        }
                      >
                        <Star
                          size={17}
                          fill={selected.starred ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                    <div className="message-body">{selected.message.body}</div>
                    {selected.message.attachments.length > 0 && (
                      <div className="attachment-list">
                        {selected.message.attachments.map((f) => (
                          <a
                            key={f.id}
                            href={`/api/attachments/${f.id}`}
                            className="attachment"
                          >
                            <Paperclip size={15} />
                            <span>
                              {f.name}
                              <small>{Math.ceil(f.size / 1024)} КБ</small>
                            </span>
                            <Download size={14} />
                          </a>
                        ))}
                      </div>
                    )}
                    {selected.folder === "sent" && (
                      <div className="delivery-list">
                        {selected.message.deliveries.map((d) => (
                          <p key={d.recipient}>
                            <span
                              className={`status-dot ${d.status === "failed" ? "failed" : ""}`}
                            />
                            {d.recipient} —{" "}
                            {(
                              {
                                delivered: "Доставлено внутри soul",
                                accepted:
                                  "Принято провайдером; доставка не подтверждена",
                                pending:
                                  "Ожидает передачи; результат неизвестен",
                                failed: "Ошибка внешней отправки",
                              } as Record<string, string>
                            )[d.status] || d.status}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="reply-actions">
                      <button className="button" onClick={() => reply("reply")}>
                        <Reply size={16} /> Ответить
                      </button>
                      <button className="button" onClick={() => reply("all")}>
                        <ReplyAll size={16} /> Всем
                      </button>
                      <button
                        className="button"
                        onClick={() => reply("forward")}
                      >
                        <Forward size={16} /> Переслать
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="reading-empty">
                  <div className="empty-symbol">
                    s<span>·</span>
                  </div>
                  <h2>A little room to breathe.</h2>
                  <p>Выберите письмо или начните новую историю.</p>
                  <button
                    className="text-link"
                    onClick={() => setDraft(emptyDraft(user.signature))}
                  >
                    Новое письмо <ArrowUpRight size={14} />
                  </button>
                  <span className="mini-label">MAIL WITH A SOUL.</span>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      <button
        className="mobile-compose"
        aria-label="Новое письмо"
        onClick={() => setDraft(emptyDraft(user.signature))}
      >
        <Plus size={24} />
      </button>
      {draft && (
        <Composer
          initial={draft}
          user={user}
          smtp={smtp}
          onClose={() => setDraft(null)}
          onDone={async (message) => {
            setDraft(null);
            setNotice(message);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
function Composer({
  initial,
  user,
  smtp,
  onClose,
  onDone,
}: {
  initial: Draft;
  user: User;
  smtp: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [d, setD] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const update = (key: keyof Draft, value: unknown) => {
    setD((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };
  const payload = () => ({
    ...d,
    to: d.to
      .split(/[,;]+/)
      .map((a) => a.trim())
      .filter(Boolean),
    cc: d.cc
      .split(/[,;]+/)
      .map((a) => a.trim())
      .filter(Boolean),
    attachments: d.attachments.map((f) => f.id),
  });
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await run(async () => {
      const r = await post("drafts", payload());
      setD((v) => ({ ...v, id: (r.entry as Entry).id }));
      setDirty(false);
      await onDone("Черновик сохранён.");
    });
  }
  async function send() {
    await run(async () => {
      const r = await post("send", payload());
      const deliveries = r.deliveries as { status: string }[];
      await onDone(
        deliveries.some((x) => x.status === "failed")
          ? "Внутренние адресаты получили письмо; внешняя отправка завершилась ошибкой. Подробности — в «Отправленных»."
          : deliveries.some((x) => x.status === "accepted")
            ? "Письмо передано почтовому провайдеру. Окончательная доставка не подтверждена."
            : "Письмо доставлено внутри soul.",
      );
    });
  }
  return (
    <div className="modal-scrim">
      <section
        className="composer"
        role="dialog"
        aria-modal="true"
        aria-label="Новое письмо"
      >
        <header>
          <span>
            <span className="status-dot" /> {d.id ? "Черновик" : "Новое письмо"}
          </span>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="Закрыть редактор"
            onClick={() => {
              if (
                !dirty ||
                confirm("Несохранённые изменения будут потеряны. Закрыть?")
              )
                onClose();
            }}
          >
            <X size={19} />
          </button>
        </header>
        <div className="compose-from">
          От{" "}
          <span>
            {user.name} &lt;{user.sendAddress}&gt;
          </span>
        </div>
        <label className="compose-field">
          <span>Кому</span>
          <input
            autoFocus
            aria-label="Кому"
            value={d.to}
            onChange={(e) => update("to", e.target.value)}
            placeholder="Адреса через запятую"
          />
        </label>
        <label className="compose-field">
          <span>Копия</span>
          <input
            aria-label="Копия"
            value={d.cc}
            onChange={(e) => update("cc", e.target.value)}
          />
        </label>
        <label className="compose-field subject-field">
          <input
            aria-label="Тема"
            placeholder="Тема письма"
            maxLength={200}
            value={d.subject}
            onChange={(e) => update("subject", e.target.value)}
          />
        </label>
        <textarea
          aria-label="Текст письма"
          placeholder="Скажите что-нибудь настоящее…"
          maxLength={50000}
          value={d.body}
          onChange={(e) => update("body", e.target.value)}
        />
        {d.attachments.length > 0 && (
          <div className="compose-files">
            {d.attachments.map((f) => (
              <span key={f.id}>
                <Paperclip size={13} />
                {f.name}
                <button
                  aria-label={`Убрать ${f.name}`}
                  disabled={busy}
                  onClick={() =>
                    update(
                      "attachments",
                      d.attachments.filter((x) => x.id !== f.id),
                    )
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        {!smtp && (
          <p className="compose-notice">
            Внешняя почта не подключена. Доступна переписка с пользователями
            soul.
          </p>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <button className="button primary" disabled={busy} onClick={send}>
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Send size={15} />
            )}{" "}
            Отправить
          </button>
          <input
            type="file"
            ref={upload}
            hidden
            accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              run(async () => {
                if (d.attachments.length >= 5)
                  throw new Error("До пяти вложений.");
                if (file.size > 5 * 1024 * 1024)
                  throw new Error("Файл должен быть не больше 5 МБ.");
                if (
                  d.attachments.reduce((n, a) => n + a.size, 0) + file.size >
                  10 * 1024 * 1024
                )
                  throw new Error("Общий размер — до 10 МБ.");
                const r = await api<{ file: FileInfo }>("attachments", {
                  method: "POST",
                  headers: {
                    "Content-Type": file.type,
                    "X-File-Name": encodeURIComponent(file.name),
                  },
                  body: file,
                });
                update("attachments", [...d.attachments, r.file]);
              });
              e.target.value = "";
            }}
          />
          <button
            className="icon-button"
            aria-label="Прикрепить файл"
            disabled={busy}
            onClick={() => upload.current?.click()}
          >
            <Paperclip size={18} />
          </button>
          <button className="button save-draft" disabled={busy} onClick={save}>
            Сохранить черновик
          </button>
          {d.id && (
            <button
              className="icon-button"
              aria-label="Удалить черновик"
              disabled={busy}
              onClick={() => {
                if (confirm("Удалить черновик безвозвратно?"))
                  run(async () => {
                    await api(`messages/${d.id}`, { method: "DELETE" });
                    await onDone("Черновик удалён.");
                  });
              }}
            >
              <Trash2 size={17} />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
type Domain = {
  id: string;
  name: string;
  token: string;
  verifiedAt: string | null;
};
type Sessions = {
  sessions: {
    id: string;
    agent: string;
    createdAt: string;
    expiresAt: string;
  }[];
  current: string;
};
function SettingsPanel({
  user,
  setUser,
  smtp,
  onError,
  onNotice,
}: {
  user: User;
  setUser: (u: User) => void;
  smtp: boolean;
  onError: (s: string) => void;
  onNotice: (s: string) => void;
}) {
  const [tab, setTab] = useState("profile"),
    [busy, setBusy] = useState(false),
    [sessions, setSessions] = useState<Sessions | null>(null),
    [domains, setDomains] = useState<Domain[]>([]),
    [dns, setDns] = useState<Record<string, string | null>>({});
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    onError("");
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const loadDomains = useCallback(
    () =>
      api<{ domains: Domain[]; dns: Record<string, string | null> }>(
        "domains",
      ).then((r) => {
        setDomains(r.domains);
        setDns(r.dns);
      }),
    [],
  );
  useEffect(() => {
    if (tab === "sessions")
      api<Sessions>("sessions")
        .then(setSessions)
        .catch((e) => onError(e.message));
    if (tab === "domains") loadDomains().catch((e) => onError(e.message));
  }, [tab, loadDomains, onError]);
  return (
    <section className="settings-panel">
      <div className="settings-heading">
        <span className="mini-label">MAKE IT YOURS.</span>
        <h1>Настройки</h1>
        <p>Небольшие детали. Ваше пространство.</p>
      </div>
      <div className="settings-tabs">
        {[
          ["profile", "Профиль"],
          ["security", "Безопасность"],
          ["sessions", "Сессии"],
          ["domains", "Домены"],
          ["help", "Обратная связь"],
        ].map(([k, label]) => (
          <button
            className={tab === k ? "active" : ""}
            key={k}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "profile" && (
        <form
          className="settings-form"
          key={user.id}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(async () => {
              const data = {
                name: fd.get("name"),
                theme: fd.get("theme"),
                signature: fd.get("signature"),
                notifications: fd.get("notifications") === "on",
              };
              await api("me", { method: "PATCH", body: JSON.stringify(data) });
              setUser({ ...user, ...data } as User);
              applyTheme(String(data.theme));
              onNotice("Настройки сохранены.");
            });
          }}
        >
          <div className="profile-avatar">
            <UserAvatar user={user} large />
            <label className="button file-label">
              Загрузить аватар
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    run(async () => {
                      if (f.size > 1024 * 1024)
                        throw new Error("Аватар — до 1 МБ.");
                      await api("me/avatar", {
                        method: "POST",
                        headers: { "Content-Type": f.type },
                        body: f,
                      });
                      setUser({
                        ...user,
                        hasAvatar: true,
                        avatarVersion: Date.now(),
                      });
                      onNotice("Аватар сохранён.");
                    });
                }}
              />
            </label>
            <a
              className="text-link"
              href="/api/me/avatar"
              target="_blank"
              rel="noreferrer"
            >
              Посмотреть
            </a>
          </div>
          <label>
            Имя
            <input
              name="name"
              defaultValue={user.name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Ваш адрес
            <input value={user.sendAddress} readOnly />
          </label>
          <label>
            Тема
            <select name="theme" defaultValue={user.theme}>
              <option value="dark">Тёмная</option>
              <option value="light">Светлая</option>
              <option value="system">Как в системе</option>
            </select>
          </label>
          <label>
            Подпись
            <textarea
              name="signature"
              defaultValue={user.signature}
              maxLength={1000}
              rows={4}
              placeholder="Несколько слов в конце письма"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="notifications"
              defaultChecked={user.notifications}
            />
            Автоматически обновлять ящик каждые 30 секунд
          </label>
          <p className="muted small-text">
            Настройка обновления сохраняется для аккаунта. Push-уведомления пока
            не поддерживаются.
          </p>
          <button className="button primary" disabled={busy}>
            <Check size={15} />
            Сохранить изменения
          </button>
        </form>
      )}
      {tab === "security" && (
        <div className="settings-form">
          <h3>Изменить пароль</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              run(async () => {
                await post(
                  "me/password",
                  Object.fromEntries(new FormData(form)),
                );
                form.reset();
                onNotice("Пароль изменён. Остальные сессии завершены.");
              });
            }}
          >
            <label>
              Текущий пароль
              <input
                name="current"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              Новый пароль
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <button className="button" disabled={busy}>
              Изменить пароль
            </button>
          </form>
          <div className="settings-divider" />
          <h3>Восстановление доступа</h3>
          <p className="muted">
            {user.recoveryEmail
              ? `${user.recoveryEmail} · ${user.verified ? "подтверждён" : "не подтверждён"}`
              : "Адрес восстановления не указан при регистрации."}
          </p>
          {user.recoveryEmail && !user.verified && (
            <button
              className="button"
              disabled={!smtp || busy}
              onClick={() =>
                run(async () => {
                  await post("me/verification", {});
                  onNotice(
                    "Письмо подтверждения передано почтовому провайдеру.",
                  );
                })
              }
            >
              Подтвердить адрес
            </button>
          )}
          {!smtp && (
            <div className="alert">
              Подтверждение и восстановление недоступны, пока владелец сервиса
              не настроит почтового провайдера.
            </div>
          )}
          <div className="settings-divider" />
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await post("auth/logout", {});
                location.href = "/login";
              })
            }
          >
            <LogOut size={15} /> Выйти из аккаунта
          </button>
        </div>
      )}
      {tab === "sessions" && (
        <div className="settings-form">
          <h3>Активные устройства</h3>
          <p className="muted">
            Сессии истекают через 30 дней. Можно завершить любую из них.
          </p>
          {!sessions ? (
            <LoaderCircle className="spin" size={20} />
          ) : (
            sessions.sessions.map((s) => (
              <div className="session-item" key={s.id}>
                <div>
                  <strong>
                    {s.id === sessions.current
                      ? "Это устройство"
                      : "Другая сессия"}
                  </strong>
                  <p>{s.agent}</p>
                  <small>С {new Date(s.createdAt).toLocaleString("ru")}</small>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`sessions/${s.id}`, { method: "DELETE" });
                      if (s.id === sessions.current) location.href = "/login";
                      else setSessions(await api<Sessions>("sessions"));
                    })
                  }
                >
                  Завершить
                </button>
              </div>
            ))
          )}
          <button
            className="button danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Выйти на всех устройствах, включая это?"))
                run(async () => {
                  await api("sessions", { method: "DELETE" });
                  location.href = "/login";
                });
            }}
          >
            Выйти на всех устройствах
          </button>
        </div>
      )}
      {tab === "domains" && (
        <div className="settings-form wide">
          <h3>Свой домен. Ваш голос.</h3>
          <p className="muted">
            Подтвердите владение через DNS. Первый подтверждённый домен будет
            использоваться для адреса {user.handle}@ваш-домен. Для внешней почты
            отдельно нужны провайдер и DNS-записи.
          </p>
          <form
            className="domain-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              run(async () => {
                await post("domains", Object.fromEntries(new FormData(form)));
                form.reset();
                await loadDomains();
              });
            }}
          >
            <input
              name="name"
              aria-label="Имя домена"
              placeholder="your-domain.com"
              required
            />
            <button className="button" disabled={busy}>
              <Plus size={15} />
              Добавить
            </button>
          </form>
          {domains.map((d) => (
            <div className="domain-item" key={d.id}>
              <div className="domain-head">
                <strong>{d.name}</strong>
                <span className="mini-label">
                  {d.verifiedAt ? "ПОДТВЕРЖДЁН" : "ОЖИДАЕТ ПРОВЕРКИ"}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Удалить домен ${d.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Отключить ${d.name}?`))
                      run(async () => {
                        await api(`domains/${d.id}`, { method: "DELETE" });
                        await loadDomains();
                        const r = await api<{ user: User }>("me");
                        setUser(r.user);
                      });
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <p>Создайте TXT-запись:</p>
              <code>_soul.{d.name}</code>
              <code>soul-verification={d.token}</code>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await post(`domains/${d.id}/verify`, {});
                    await loadDomains();
                    const r = await api<{ user: User }>("me");
                    setUser(r.user);
                    onNotice("Владение доменом подтверждено.");
                  })
                }
              >
                <RefreshCw size={14} />
                Проверить DNS
              </button>
            </div>
          ))}
          <h3>Внешняя почта</h3>
          <div className="alert">
            {smtp
              ? "Внешний провайдер настроен. Принятие письма провайдером не подтверждает доставку в конечный ящик."
              : "Почтовый провайдер не подключён. Внешняя отправка недоступна; внутренняя почта работает."}
          </div>
          <div className="dns-table">
            {[
              ["MX", dns.mx],
              ["SPF (TXT)", dns.spf],
              ["DKIM selector", dns.dkimSelector],
              ["DKIM (TXT)", dns.dkim],
              ["DMARC (TXT)", dns.dmarc],
            ].map(([name, value]) => (
              <div key={name}>
                <span>{name}</span>
                <code>{value || "Не задано владельцем сервиса"}</code>
              </div>
            ))}
          </div>
          <p className="muted small-text">
            Получите точные значения у своего провайдера. Подтверждение владения
            не проверяет MX и доставляемость. Входящие сообщения принимает
            серверный webhook; инструкции находятся в README проекта.
          </p>
        </div>
      )}
      {tab === "help" && (
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            run(async () => {
              await post("reports", Object.fromEntries(new FormData(form)));
              form.reset();
              onNotice("Обращение сохранено и доступно администратору.");
            });
          }}
        >
          <h3>Мы слушаем.</h3>
          <p className="muted">
            Сообщите об ошибке доставки, спаме или проблеме. Не отправляйте
            пароли и содержимое личной переписки.
          </p>
          <label>
            Тема обращения
            <select name="category">
              <option value="delivery">Доставка писем</option>
              <option value="spam">Спам</option>
              <option value="abuse">Злоупотребление</option>
              <option value="other">Другое</option>
            </select>
          </label>
          <label>
            Что случилось?
            <textarea
              required
              name="detail"
              minLength={10}
              maxLength={2000}
              rows={6}
            />
          </label>
          <button className="button primary" disabled={busy}>
            Отправить обращение
            <ArrowUpRight size={15} />
          </button>
        </form>
      )}
    </section>
  );
}
type AdminData = {
  userCount: number;
  messageCount: number;
  users: {
    id: string;
    name: string;
    email: string;
    disabled: boolean;
    role: string;
    createdAt: string;
  }[];
  failures: {
    id: string;
    status: string;
    code: string | null;
    updatedAt: string;
  }[];
  reports: {
    id: string;
    category: string;
    detail: string;
    status: string;
    createdAt: string;
  }[];
  server: { uptime: number | null; memoryMB: number | null; database: string };
};
function AdminPanel({ onError }: { onError: (s: string) => void }) {
  const [data, setData] = useState<AdminData | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<AdminData>("admin")
        .then(setData)
        .catch((e) => onError(e.message)),
    [onError],
  );
  useEffect(() => {
    load();
  }, [load]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-panel">
      <span className="mini-label">SERVICE CONTROL</span>
      <h1>Администрирование</h1>
      <p className="muted">
        Состояние сервиса без доступа к содержимому переписки.
      </p>
      {!data ? (
        <LoaderCircle className="spin" />
      ) : (
        <>
          <div className="admin-metrics">
            <div>
              <span>Пользователи</span>
              <strong>{data.userCount}</strong>
            </div>
            <div>
              <span>Письма</span>
              <strong>{data.messageCount}</strong>
            </div>
            <div>
              <span>База данных</span>
              <strong>{data.server.database}</strong>
            </div>
            <div>
              <span>Память / uptime</span>
              <strong>
                {data.server.memoryMB ?? "—"} МБ / {data.server.uptime ?? "—"} с
              </strong>
            </div>
          </div>
          <button className="button" onClick={load}>
            <RefreshCw size={14} />
            Обновить
          </button>
          <h3>Аккаунты · последние 100</h3>
          <div className="admin-table">
            {data.users.map((u) => (
              <div key={u.id}>
                <span>
                  <strong>{u.name}</strong>
                  <small>
                    {u.email} · {u.role}
                  </small>
                </span>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `${u.disabled ? "Включить" : "Отключить"} ${u.email}?`,
                      )
                    )
                      run(() =>
                        api(`admin/users/${u.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ disabled: !u.disabled }),
                        }),
                      );
                  }}
                >
                  {u.disabled ? "Включить" : "Отключить"}
                </button>
              </div>
            ))}
          </div>
          <h3>Ошибки / ожидающие отправки</h3>
          {data.failures.length ? (
            data.failures.map((f) => (
              <div className="admin-event" key={f.id}>
                <code>{f.id}</code>
                <span>
                  {f.status} · {f.code || "Нет подтверждения"} ·{" "}
                  {date(f.updatedAt)}
                </span>
              </div>
            ))
          ) : (
            <p className="muted">Ошибок не зарегистрировано.</p>
          )}
          <h3>Обращения</h3>
          {data.reports.length ? (
            data.reports.map((r) => (
              <div className="report-item" key={r.id}>
                <span className="mini-label">
                  {r.category} · {r.status}
                </span>
                <p>{r.detail}</p>
                {r.status === "OPEN" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        api(`admin/reports/${r.id}`, {
                          method: "PATCH",
                          body: "{}",
                        }),
                      )
                    }
                  >
                    Закрыть обращение
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="muted">Обращений пока нет.</p>
          )}
        </>
      )}
    </section>
  );
}

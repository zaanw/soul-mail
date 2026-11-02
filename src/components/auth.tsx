"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowLeft, LoaderCircle } from "lucide-react";
import { api, post } from "@/lib/client";
export function Auth({
  mode,
}: {
  mode: "login" | "register" | "reset" | "verify";
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [token, setToken] = useState(""),
    [recover, setRecover] = useState(false),
    [cap, setCap] = useState<{
      domain: string;
      externalMail: boolean;
      recovery: boolean;
      verificationRequired: boolean;
    } | null>(null);
  useEffect(() => {
    setToken(new URLSearchParams(location.search).get("token") || "");
    api<typeof cap>("capabilities")
      .then(setCap)
      .catch((e) => setError(e.message));
  }, []);
  const signup = mode === "register";
  const title =
    mode === "verify"
      ? "One last step."
      : mode === "reset"
        ? "A fresh start."
        : recover
          ? "Find your way back."
          : signup
            ? "Find your soul."
            : "Welcome back.";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (recover) {
        const r = await post("auth/recover", data);
        setNotice(String(r.message));
      } else if (mode === "reset" || mode === "verify") {
        await post(`auth/${mode}`, { ...data, token });
        setNotice(
          mode === "reset"
            ? "Пароль изменён. Войдите с новым паролем."
            : "Адрес подтверждён. Теперь можно войти.",
        );
      } else {
        const r = await post(`auth/${mode}`, data);
        if (r.needsVerification)
          setNotice("Подтвердите адрес по ссылке в письме, затем войдите.");
        else location.href = "/mail";
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <Link href="/" className="wordmark">
          soul
          <span className="brand-dot" />
        </Link>
        <div>
          <span className="mini-label">YOUR WORDS BELONG SOMEWHERE.</span>
          <h1>
            A little less noise.
            <br />A little more <em>soul.</em>
          </h1>
          <p>Почта, в которой есть место для вас.</p>
        </div>
        <span className="mini-label">
          MAIL WITH A SOUL. / JUST YOU AND YOUR INBOX.
        </span>
      </aside>
      <section className="auth-form-wrap">
        <Link className="back-link" href="/">
          <ArrowLeft size={15} /> На главную
        </Link>
        <form ref={formRef} onSubmit={submit} className="auth-form">
          <span className="mini-label">
            {signup ? "MAKE YOURSELF AT HOME." : "YOUR SPACE IS WAITING."}
          </span>
          <h2>{title}</h2>
          <p className="muted">
            {mode === "verify"
              ? "Подтвердите адрес восстановления."
              : mode === "reset"
                ? "Задайте новый пароль для аккаунта."
                : recover
                  ? "Введите подтверждённый адрес восстановления."
                  : signup
                    ? "Создайте свой почтовый ящик."
                    : "Войдите в свой почтовый ящик."}
          </p>
          {signup && (
            <>
              <label>
                Ваше имя
                <input
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Как вас называть?"
                />
              </label>
              <label>
                Адрес soul
                <div className="input-suffix">
                  <input
                    name="handle"
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-z][a-z0-9._\-]{2,31}"
                    autoComplete="username"
                    placeholder="your.name"
                  />
                  <span>@{cap?.domain || "…"}</span>
                </div>
                <small>3–32 символа: латиница, цифры, . _ -</small>
              </label>
            </>
          )}
          {(mode === "login" || recover) && (
            <label>
              {recover ? "Адрес восстановления" : "Адрес или имя soul"}
              <input
                name="email"
                type={recover ? "email" : "text"}
                required
                autoComplete="username"
                placeholder={recover ? "you@example.com" : "your.name"}
              />
            </label>
          )}
          {signup && (
            <label>
              Адрес восстановления{" "}
              {cap?.verificationRequired ? "" : "(необязательно)"}
              <input
                name="recoveryEmail"
                type="email"
                required={cap?.verificationRequired}
                autoComplete="email"
                placeholder="Другой ваш email"
              />
              <small>
                Для восстановления адрес нужно подтвердить в настройках.{" "}
                {cap && !cap.recovery ? "SMTP пока не подключён." : ""}
              </small>
            </label>
          )}
          {!recover && mode !== "verify" && (
            <label>
              {mode === "reset" ? "Новый пароль" : "Пароль"}
              <input
                name="password"
                type="password"
                required
                minLength={signup || mode === "reset" ? 12 : 1}
                maxLength={128}
                autoComplete={
                  signup || mode === "reset"
                    ? "new-password"
                    : "current-password"
                }
                placeholder={signup ? "Не менее 12 символов" : "Ваш пароль"}
              />
            </label>
          )}
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="alert">
              {notice}
            </div>
          )}
          <button
            className="button primary full"
            disabled={
              busy ||
              !cap ||
              (mode === "verify" && !token) ||
              (mode === "reset" && !token)
            }
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : null}
            {recover
              ? "Отправить ссылку"
              : signup
                ? "Создать аккаунт"
                : mode === "reset"
                  ? "Изменить пароль"
                  : mode === "verify"
                    ? "Подтвердить адрес"
                    : "Войти"}
            <ArrowUpRight size={16} />
          </button>
          {mode === "login" && (
            <button
              type="button"
              className="text-link auth-recover"
              onClick={() => {
                setRecover(!recover);
                setError("");
                setNotice("");
              }}
            >
              {recover ? "Вернуться ко входу" : "Забыли пароль?"}
            </button>
          )}
          {mode === "login" && !recover && cap?.recovery && (
            <button
              type="button"
              className="text-link auth-recover"
              disabled={busy}
              onClick={async () => {
                if (!formRef.current?.reportValidity()) return;
                setBusy(true);
                setError("");
                try {
                  const result = await post(
                    "auth/resend",
                    Object.fromEntries(new FormData(formRef.current)),
                  );
                  setNotice(String(result.message));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Отправить подтверждение повторно
            </button>
          )}
          <div className="auth-switch">
            {signup ? "Уже есть аккаунт? " : "Нет аккаунта? "}
            <Link href={signup ? "/login" : "/register"}>
              {signup ? "Войти" : "Присоединиться"}
            </Link>
            {(mode === "reset" || mode === "verify") && (
              <>
                {" "}
                · <Link href="/login">Войти</Link>
              </>
            )}
          </div>
          <p className="auth-fine">
            Ваши письма хранятся на сервере soul. Сквозное шифрование не
            используется.
          </p>
        </form>
      </section>
    </main>
  );
}

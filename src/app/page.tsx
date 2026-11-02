import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  MoveDown,
  Command,
  Inbox,
  Star,
  Send,
  Archive,
  Search,
  Plus,
  Paperclip,
  CornerUpLeft,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
} from "lucide-react";
import { config } from "@/lib/config";
export const dynamic = "force-dynamic";
export default function Home() {
  const domain = config().domain;
  return (
    <div className="landing">
      <header className="site-nav">
        <Link href="/" className="wordmark">
          soul
          <span className="brand-dot" />
        </Link>
        <nav>
          <a href="#experience">the experience</a>
          <a href="#principles">our principles</a>
        </nav>
        <Link href="/login" className="nav-login">
          open your mail <ArrowUpRight size={15} />
        </Link>
      </header>
      <main>
        <section className="hero">
          <div className="hero-index">
            <span>INDEPENDENT MAIL SOFTWARE</span>
            <span>01 — LESS, BUT BETTER</span>
          </div>
          <div className="hero-main">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="status-dot" /> A LITTLE MORE HUMAN.
              </div>
              <h1>
                mail with
                <br />a <span className="soul-type">soul.</span>
                <span className="hero-asterisk">✳</span>
              </h1>
              <p className="hero-sub">just you and your inbox.</p>
              <p className="hero-description">
                Меньше шума. Больше смысла.
                <br />
                Личное пространство для ваших слов.
              </p>
              <div className="hero-actions">
                <Link className="button primary" href="/register">
                  get started <ArrowUpRight size={16} />
                </Link>
                <a className="text-link" href="#experience">
                  explore soul <ArrowRight size={15} />
                </a>
              </div>
              <div className="hero-note">
                <span>YOUR WORDS. YOUR SPACE.</span>
                <span>NO DISTRACTIONS.</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbital orbital-one" />
              <div className="orbital orbital-two" />
              <div className="soul-glyph">
                s<span>o</span>ul
              </div>
              <span className="art-coordinate top">S / 001</span>
              <span className="art-coordinate bottom">
                A SIGNAL IN THE NOISE.
              </span>
              <span className="art-cross">+</span>
            </div>
          </div>
          <a href="#experience" className="scroll-cue">
            <MoveDown size={14} /> SCROLL TO FEEL IT{" "}
            <span>DESIGNED FOR EVERYDAY.</span>
          </a>
        </section>
        <section id="experience" className="experience">
          <div className="section-label">
            <span>01 / THE EXPERIENCE</span>
            <span>A QUIETER KIND OF INBOX.</span>
          </div>
          <div className="section-heading">
            <h2>
              Room to think.
              <br />
              <span>Space to write.</span>
            </h2>
            <p>
              Всё нужное на своём месте.
              <br />
              Ничего, что отвлекает от главного.
            </p>
          </div>
          <div className="mail-preview">
            <aside>
              <div className="preview-logo">
                soul <small>mail</small>
              </div>
              <div className="preview-compose">
                <Plus size={15} /> compose
              </div>
              {[
                [Inbox, "inbox", "3"],
                [Star, "starred", ""],
                [Send, "sent", ""],
                [Archive, "archive", ""],
              ].map(([Icon, label, count]) => {
                const I = Icon as typeof Inbox;
                return (
                  <div
                    className={`preview-folder ${label === "inbox" ? "active" : ""}`}
                    key={String(label)}
                  >
                    <I size={14} />
                    {String(label)}
                    <span>{String(count)}</span>
                  </div>
                );
              })}
              <div className="preview-user">
                <span className="avatar">Y</span>
                <span>
                  your space<small>you@{domain}</small>
                </span>
              </div>
            </aside>
            <div className="preview-list">
              <div className="preview-toolbar">
                inbox{" "}
                <span>
                  <Search size={14} />
                  <SlidersHorizontal size={14} />
                </span>
              </div>
              <div className="preview-caption">
                A GLIMPSE INSIDE · ILLUSTRATION
              </div>
              {[
                [
                  "M",
                  "Mira",
                  "a thought worth keeping",
                  "Some things are better said in a letter.",
                  "now",
                ],
                [
                  "S",
                  "Studio notes",
                  "less noise, more signal",
                  "A few things we made this week.",
                  "11:24",
                ],
                [
                  "J",
                  "Jules",
                  "see you on the other side",
                  "Same place. No rush.",
                  "yesterday",
                ],
              ].map(([a, n, s, b, d], i) => (
                <div
                  className={`preview-row ${i === 0 ? "selected" : ""}`}
                  key={n}
                >
                  <span className="avatar">{a}</span>
                  <div>
                    <div className="preview-sender">
                      {n}
                      <time>{d}</time>
                    </div>
                    <strong>{s}</strong>
                    <p>{b}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="preview-letter">
              <span className="mini-label">MIRA → YOU</span>
              <h3>a thought worth keeping</h3>
              <div className="letter-line" />
              <p>Hey you,</p>
              <p>
                Not everything needs to happen at the speed of a notification.
              </p>
              <p>
                Here’s to slower mornings,
                <br />
                and messages that mean something.
              </p>
              <p className="letter-sign">M.</p>
              <div className="preview-reply">
                <CornerUpLeft size={14} /> reply <Paperclip size={14} />
              </div>
            </div>
          </div>
          <div className="preview-foot">
            <span>INTENTIONALLY SIMPLE. DISTINCTLY YOURS.</span>
            <span>
              <Command size={12} /> BUILT FOR THE WAY YOU THINK.
            </span>
          </div>
        </section>
        <section id="principles" className="principles">
          <div className="section-label">
            <span>02 / WHAT MATTERS</span>
            <span>LESS FRICTION. MORE FEELING.</span>
          </div>
          <div className="feature-grid">
            {[
              [
                Inbox,
                "01",
                "An inbox. Not a feed.",
                "Папки, поиск, черновики и избранное. Почта остаётся почтой, а ваше внимание — вашим.",
              ],
              [
                ShieldCheck,
                "02",
                "Private by intention.",
                "Защищённые серверные сессии и хеширование паролей Argon2id. Без заявлений о сквозном шифровании.",
              ],
              [
                Smartphone,
                "03",
                "Goes where you go.",
                "Компактный интерфейс на телефоне. Добавьте soul на экран «Домой» и пишите откуда угодно.",
              ],
            ].map(([Icon, n, title, body]) => {
              const I = Icon as typeof Inbox;
              return (
                <article key={String(n)}>
                  <div className="feature-number">
                    <I size={20} />
                    <span>{String(n)}</span>
                  </div>
                  <h3>{String(title)}</h3>
                  <p>{String(body)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="mobile-section">
          <div className="mobile-copy">
            <span className="mini-label">03 / ALWAYS WITH YOU</span>
            <h2>
              Your pocket.
              <br />
              Your little universe.
            </h2>
            <p>
              Один ящик. Любой экран. Пишите с телефона так же удобно, как с
              компьютера — с полноэкранным редактором и быстрым переходом между
              папками.
            </p>
            <Link href="/register" className="text-link">
              make yourself at home <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="phone-art">
            <div className="phone-top">
              9:41 <span>••• ▰</span>
            </div>
            <div className="phone-brand">
              soul
              <span className="brand-dot" />
            </div>
            <div className="phone-heading">
              inbox <Plus size={22} />
            </div>
            <span className="mini-label">A SMALL PREVIEW</span>
            {[
              "a thought worth keeping",
              "less noise, more signal",
              "see you on the other side",
            ].map((s, i) => (
              <div className="phone-row" key={s}>
                <span className="avatar">{["M", "S", "J"][i]}</span>
                <div>
                  <strong>{["Mira", "Studio notes", "Jules"][i]}</strong>
                  <p>{s}</p>
                </div>
                <span className="status-dot" />
              </div>
            ))}
            <div className="phone-bottom">mail with a soul.</div>
          </div>
        </section>
        <section className="faq">
          <div>
            <span className="mini-label">04 / A FEW ANSWERS</span>
            <h2>Good questions.</h2>
          </div>
          <div>
            {[
              [
                "Как работает почта?",
                "Пользователи soul могут обмениваться письмами внутри сервиса. Для внешней почты владелец сервиса должен подключить SMTP и входящего провайдера. Состояние подключения видно в приложении.",
              ],
              [
                "Можно подключить свой домен?",
                "Да. Добавьте домен в настройках, подтвердите владение TXT-записью и настройте MX, SPF, DKIM и DMARC по данным своего провайдера.",
              ],
              [
                "Есть ли сквозное шифрование?",
                "Нет. Пароли хешируются, а доступ к письмам проверяет сервер. Содержимое хранится в базе данных сервиса. Для безопасного развёртывания нужен HTTPS.",
              ],
              [
                "Работает ли soul на iPhone?",
                "Да. Интерфейс адаптирован для телефона и поддерживает установку на экран «Домой». Для работы с письмами требуется интернет.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={16} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="closing">
          <span className="mini-label">A FRESH START, EVERY DAY.</span>
          <h2>
            Make room
            <br />
            for something <em>real.</em>
          </h2>
          <Link className="button primary" href="/register">
            find your soul <ArrowUpRight size={16} />
          </Link>
        </section>
      </main>
      <footer>
        <Link href="/" className="wordmark">
          soul
          <span className="brand-dot" />
        </Link>
        <span>mail with a soul.</span>
        <a href="#principles">
          privacy, plainly explained <ArrowUpRight size={13} />
        </a>
        <span>© {new Date().getFullYear()} soul</span>
      </footer>
    </div>
  );
}

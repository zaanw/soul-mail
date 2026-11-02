# soul mail

**mail with a soul. / just you and your inbox.**

Разработка: `npm ci` → `node scripts/dev-db.mjs` → `npm run db:generate` → `npm run db:migrate` → `npm run dev`. Нужны Node.js 24 и PostgreSQL 17 (локальный помощник использует Docker). Все домены задаются в `.env`. Внутренняя почта работает без провайдера; внешняя отправка, подтверждение адреса и восстановление требуют SMTP. Секреты вводятся только в приватной конфигурации сервера.

Cloudflare Workers: [инструкция и подготовленные команды](CLOUDFLARE.md).

Next.js 16, React 19, TypeScript, Tailwind 4, Lucide, Node 24, PostgreSQL 17 and Prisma 7. A real account and internal mail application, with a configurable SMTP adapter and normalized inbound webhook. No seeded accounts or public passwords.

## Start locally

Requires Node 24 and PostgreSQL 17. Docker is optional if PostgreSQL is already available.

```sh
npm ci
# Optional: creates a random local-only password in ignored .env,
# starts PostgreSQL in Docker, and preserves data in soul-postgres-data.
node scripts/dev-db.mjs
# Otherwise copy .env.example to .env and configure your own database.
npm run db:generate
npm run db:migrate
npm run dev
```

Open the application on port 3000 on your own machine. Register an account. To test internal delivery, register a second account in a separate browser profile and send to its exact soul address. No external provider is needed for internal delivery. `MAIL_DOMAIN=localhost` is supported for local accounts; production must use a real controlled domain. Login accepts a soul address or handle. Recovery email is a separate existing mailbox.

For managed cloud tasks use the existing `/workspace/soul-mail` checkout. Each task is isolated; do not create Git worktrees unless explicitly requested. Docker data is in a named volume: back it up independently; do not assume a filesystem snapshot includes Docker volumes. Processes must be restarted in new tasks. Run `scripts/dev-db.mjs`, migrations and the dev server again as appropriate. Never reset the database to solve a connection error.

`db:generate` and `db:migrate` use the official pinned Prisma JavaScript generator with Node/Workers conditional exports and WASM schema engine from integrity-checked npm packages. They do not need a native engine download. This also avoids a CLI bootstrap download in restricted cloud environments. The helper uses Prisma migration history and the committed SQL files; it does not replace PostgreSQL with an in-memory database. Prisma internal APIs and the WASM build are pinned together; upgrade them as a tested group. `skipDownload` is used only for client generation that requires no native engines; no checksum or TLS checks are disabled.

The optional native `npm run db:dev` command needs HTTPS access to `binaries.prisma.sh` to create future migrations. npm needs `registry.npmjs.org`, and Docker needs the official Docker Hub registry and blob CDN. Preserve certificate and checksum verification. Frozen installations use `npm ci`. The generated client is stored in node_modules and must be regenerated after dependency installation.

## Checks

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Or use an already installed browser:
# PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Playwright starts a development server if needed. Integration tests create uniquely named accounts and real database rows, then exercise registration, sessions, delivery, access control, attachments, folders, drafts and unavailable external transport. Run against a development database, never production. Tests intentionally retain accounts/messages for diagnosis; remove them only in a disposable development database. Browser screenshots are written into ignored `test-results`. Additional integration fixtures test administrator authorization, one-time verification/reset tokens and concurrent draft promotion; token fixtures do not test actual SMTP delivery. To exercise the authenticated inbound gateway test, set a private random `INBOUND_TOKEN` in `.env`; without it that one check is explicitly skipped. These tests do not prove internet deliverability or DNS ownership.

## Configuration

All deployment addresses are environment settings, not fixed source strings:

| Variable                                                                          | Purpose                                                                                                                                   |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                    | PostgreSQL connection URL. URL-encode credentials. Use TLS with your provider's CA in production.                                         |
| `APP_URL`                                                                         | Canonical app origin, used for CSRF checks and recovery links. Must match the browser origin exactly. HTTPS in production.                |
| `MAIL_DOMAIN`                                                                     | Default account and message-ID domain, lower case. Set before creating accounts; existing addresses are stored, not silently rewritten.   |
| `ADMIN_EMAILS`                                                                    | Comma-separated exact soul addresses granted admin role **at registration only**. Keep empty except during controlled admin provisioning. |
| `REQUIRE_EMAIL_VERIFICATION`                                                      | `true` requires an existing recovery address and configured SMTP for new registrations.                                                   |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`                                           | SMTP transport; 465 uses `true`, 587 uses `false` and requires STARTTLS.                                                                  |
| `SMTP_USER`, `SMTP_PASSWORD`                                                      | SMTP credentials (secret manager / private runtime environment only).                                                                     |
| `SMTP_FROM`                                                                       | Verified service sender for account verification and recovery.                                                                            |
| `INBOUND_TOKEN`                                                                   | Long random server-side bearer secret for a trusted inbound adapter.                                                                      |
| `MAIL_MX_HOST`, `MAIL_SPF`, `MAIL_DKIM_SELECTOR`, `MAIL_DKIM_VALUE`, `MAIL_DMARC` | Provider-issued public DNS instructions displayed in settings.                                                                            |

No secrets are committed. `.env.example` contains placeholders, not usable credentials. The local helper generates a random password and writes it to `.env` with mode 0600, never to logs. It does not overwrite an existing `.env`. If a container with the same name already exists, it reuses it; use the same credentials as its data volume. `db:migrate` verifies the actual connection afterwards.

## SMTP and delivery semantics

Without SMTP, external recipients produce HTTP 503 **before** a message is sent. Internal recipients receive PostgreSQL-backed mailbox entries atomically. Unknown local addresses produce an error. External sends go through Nodemailer using plain text, never unsanitized user HTML. Subject and addresses are validated; SMTP MIME construction is handled by Nodemailer.

Statuses:

- `delivered`: internal mailbox transaction committed.
- `accepted`: external SMTP accepted the recipient. This is **not** confirmation of final delivery.
- `failed`: SMTP error or explicit rejection. No automatic retry, to avoid accidental duplicate mail.
- `pending`: result unavailable, for example if the server stops during transport. An operator must investigate before resending.

Messages saved to Sent remain available on external failure. A failed mixed send may already have delivered to internal recipients. The interface reports this distinction. Logs contain an event code and message ID, never subject/body/passwords. No promise of durable background SMTP jobs or bounce tracking is made. Production at scale should add a transactional outbox worker, signed provider delivery/bounce events and a queue before offering delivery SLAs. SMTP submission on Node.js and HTTPS submission on Workers are synchronous. Worker deployment uses Resend; see CLOUDFLARE.md.

In restricted cloud environments, raw SMTP also requires TCP egress permission to the configured host and port (usually 465 or 587). An HTTP-domain allowlist entry alone does not grant SMTP connectivity. SMTP passwords must be actual private runtime credentials; HTTPS proxy-injection placeholders cannot authenticate a raw SMTP connection. This onboarding environment has no external SMTP provider or TCP grant configured.

## Incoming external mail

This application is not an SMTP/MX server. Connect a provider such as an inbound email gateway and write a small trusted adapter that verifies the provider's signed webhook, converts MIME to plain text and calls:

```http
POST /api/mail/inbound
Authorization: Bearer <INBOUND_TOKEN>
Content-Type: application/json

{
  "eventId": "provider-unique-event-id",
  "from": "sender@example.net",
  "name": "Sender",
  "to": ["your-handle@your-domain.test"],
  "subject": "Hello",
  "text": "A plain-text message."
}
```

`eventId` is unique and deduplicated transactionally. The webhook authenticates the gateway, not the identity in `from`; verify sender policy and spam at the gateway. HTML-only MIME must be converted by the gateway. Raw HTML is never rendered. Inbound attachments are intentionally not supported by this normalized endpoint; do not silently advertise them. Configure size limits and spam/virus screening upstream. Do not expose this token in client-side code or configure the provider directly with a public token query string. No provider is bundled or falsely marked connected.

## Custom domains

1. Configure the app itself on a domain you own via `APP_URL` and `MAIL_DOMAIN`.
2. In Settings → Domains, add a domain. Create `_soul.<domain>` TXT with the exact generated `soul-verification=…` value. Verify it. DNS resolution must be available to the Node server.
3. The first verified custom domain becomes the account's sending alias: `<handle>@<domain>`. The original soul address remains valid for login and internal delivery. Domains are unique across users, up to three per account. A domain belongs to one account in this version; it is not a multi-user domain organization feature.
4. Set the provider's **exact** MX records at the DNS host. Set the provider's SPF, DKIM selector/public key and DMARC TXT records. Do not invent values. A conservative initial DMARC policy is commonly used for observation before enforcement; choose it with your provider.
5. Authorize every sending domain in the SMTP provider. Configure inbound routing to the adapter above. Publish the public instructions through `MAIL_*` settings.
6. Test external delivery in both directions and inspect received authentication headers. A TXT ownership check alone does not prove MX/SPF/DKIM/DMARC correctness.

The proposed `soul.page.dev` is not assumed to exist or belong to this project. The actual host must be controlled by the operator. A static hosting site cannot run this application, PostgreSQL, SMTP or inbound delivery. Cloudflare Pages static export alone is not a deployment target. The project now includes a tested Cloudflare Workers/OpenNext adaptation with PostgreSQL through Hyperdrive; see CLOUDFLARE.md.

## Production deployment

1. Provision a persistent Node 24 service and PostgreSQL 17, with backups and a tested restore procedure. Use an unprivileged OS account. Restrict DB ingress to the app.
2. Set private environment configuration. Use a managed secret store for database and SMTP credentials and the inbound key. Never share development `.env` or database volume.
3. `npm ci && npm run db:generate && npm run db:migrate && npm run build`.
4. Run `npm start` behind a reverse proxy with a valid TLS certificate. Set `APP_URL` to the precise HTTPS origin. Forward to port 3000. Configure body size <= 6 MB and suitable SMTP request timeouts. Ensure the proxy does not cache `/api/*`, `/mail`, or auth pages. `GET /api/health` checks the database.
5. Keep `MAIL_DOMAIN` stable after registration. Provision an admin with `ADMIN_EMAILS`, then clear that variable. There is no default admin or role assignment endpoint.
6. Set registration policy and rate limits for your deployment. Rate limits are stored atomically in PostgreSQL and work across app replicas. Auth uses per-account plus shared global limits; no untrusted forwarded-IP header is used as an identity. This deliberately conservative limiter is not a replacement for an edge abuse defense.
7. Configure and test SMTP and inbound services as described. External tests require real credentials, DNS and actual provider access.
8. Schedule cleanup of expired sessions, expired action tokens, expired rate buckets, old unattached uploads, and inbound idempotency records according to your retention policy. Unattached uploads count against the 100 MB quota until removed by an operator.

## Security and limits

- Portable Argon2id via @noble/hashes (64 MiB, 3 iterations, 1 lane), with legacy native PHC compatibility and bounded hashing concurrency; opaque random session cookies stored only as SHA-256 hashes in PostgreSQL; HttpOnly, SameSite=Strict, Secure on HTTPS; 30-day expiry. Password change terminates other sessions; all-device logout is available.
- Exact canonical-origin checks on every cookie-authenticated mutation. The inbound gateway uses a separate bearer secret. Missing Origin is rejected on browser mutations. Database access uses Prisma/parameterized SQL; every message/file action checks account ownership.
- Plain-text messages use React text nodes; no `dangerouslySetInnerHTML`. HTML is not accepted/rendered as trusted markup. CSP blocks frames/objects and external resources; Next hydration currently requires inline scripts, so CSP is defense-in-depth, not a claim of complete XSS protection.
- Outbound attachments: 5 files, 5 MB each, 10 MB per message, 100 MB per account. Allowed types: PNG/JPEG/WebP/PDF/UTF-8 TXT with signature checks. Downloads require a mailbox entry or uploader ownership and use attachment disposition and `nosniff`. Signature checking is not malware scanning: add an antivirus/quarantine pipeline for public production.
- Avatars: PNG/JPEG/WebP up to 1 MB, stored in the DB. No SVG or remote avatar fetches. Images are authenticated and private.
- No end-to-end encryption. Server operators and database administrators can technically access stored mail. Application administrators see service/account metadata and user-submitted reports, not a message-reading interface.
- PWA manifest and icons support home-screen installation on supported browsers. No private mail/API/HTML responses are cached by the service worker. Internet is required. Notification preference controls active-tab polling only; push is not implemented.
- First release intentionally has no IMAP/POP3, HTML rich-text editor, automatic SMTP retry, billing, push delivery or self-service recovery-address replacement. Recovery requires the verified address supplied at registration and a working SMTP provider. No feature is simulated.

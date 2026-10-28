# Before launching with real users

The prototype is intentionally local-only: no accounts, no servers, no paid services. That is acceptable for an early pilot where users are told their data lives in their browser (StockPilot does this during onboarding and in Settings). Before a public launch with real users and real business data, complete the following.

## Accounts & authentication
- [ ] Sign-up/sign-in with a managed auth provider (email magic link or passkeys, plus Sign in with Apple/Google for iPhone users).
- [ ] Session handling with secure, HTTP-only cookies; sign-out on all devices.
- [ ] Account deletion and data export (self-service) to meet privacy-law obligations.

## Private, per-user storage
- [ ] A backend database with row-level security so every query is scoped to the signed-in user (or business workspace).
- [ ] Photos in private object storage served through short-lived signed URLs.
- [ ] Implement a cloud `StorageAdapter` (`src/data/storage.ts`) and a sync/migration step that uploads an existing on-device dataset on first sign-in. Keep IndexedDB as an offline cache.
- [ ] Server-side validation that mirrors `src/data/sanitize.ts` and the domain actions — never trust the client for quantities or money.

## Backups & reliability
- [ ] Automated daily database backups with point-in-time recovery; test restores.
- [ ] Error monitoring and uptime alerts.
- [ ] Keep the user-facing JSON backup/restore feature.

## Security & privacy
- [ ] HTTPS everywhere, HSTS, a strict Content-Security-Policy.
- [ ] Rate limiting on auth and API endpoints.
- [ ] Encrypt data at rest (provider default) and in transit.
- [ ] Privacy policy and terms of service; cookie/analytics consent where required.
- [ ] Never store payment card data directly — use a payment provider if subscriptions are added.
- [ ] If AI features are added, follow `AI_INTEGRATION.md` (server-side keys, minimal data, consent).
- [ ] Dependency and secret scanning in CI.

## Product
- [ ] Multi-device sync and conflict handling.
- [ ] Optional multi-user business workspaces with roles.
- [ ] Accessibility audit (screen readers, contrast, keyboard) on real iPhones and Android devices.

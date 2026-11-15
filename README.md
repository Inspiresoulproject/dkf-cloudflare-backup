# Digital Kids Foundation — Cloudflare Full Backup v3

This repository is the Cloudflare Worker build for Digital Kids Foundation. It is designed to be tested first at `backup.digitalkidsfoundation.org`, while the current Coolify production site remains unchanged. Only after full end-to-end validation should `digitalkidsfoundation.org` be moved to the Worker.

## v3 source and scope

v3 was rebuilt from the current November 2026 DKF production package (`DKF_Google_Ads_CSP_Fixed_v2`) and replaces the October v2 static snapshot.

Included in v3:

- Current homepage and all current public pages/assets.
- `/donate-laptops/` and `/corporate-partnerships/` Google Ads landing pages.
- `/brooklyn-digital-access/`.
- `/request-a-laptop/` and `/application-status/`.
- `/laptop-admin/` UI and D1-backed laptop assistance APIs.
- Contact, Volunteer and Device Donation forms using Turnstile + Resend.
- Current direct-submit behavior (public inquiry forms no longer require email verification).
- `laptop_donation_submit`, `corporate_partner_submit`, `contact_form_submit`, and `volunteer_form_submit` frontend analytics events from the current production pages.
- GTM container `GTM-K5BLFBNP` and current Google Ads/GA4 CSP allowlist.
- Current favicon files and SEO pages.
- PayPal server verification + D1 transaction recording + optional GA4 Measurement Protocol `purchase` event.
- Donor receipt draft/preview/send/revoke/verification flow on D1. v3 uses a Worker-compatible PDF generator and preserves the server-side seal + PDF SHA-256 verification model.
- Conditional staging protection: `backup.digitalkidsfoundation.org` and `*.workers.dev` receive `X-Robots-Tag: noindex, nofollow, noarchive`, and `/robots.txt` returns `Disallow: /`. The main domain receives the normal production robots/sitemap behavior.
- Daily cleanup of old rate-limit buckets and expired laptop tokens.

## Existing Cloudflare resources preserved

- Worker: `dkf-backup`
- D1 binding: `DB`
- D1 database: `dkf-backup-db`
- Existing database ID remains unchanged in `wrangler.jsonc`.

## Required Cloudflare secrets / variables

Keep existing values and add/copy the current production values where applicable. Never commit secrets to GitHub.

Required for public forms:

- `RESEND_API_KEY`
- `MAIL_FROM` (recommended: `website@digitalkidsfoundation.org`)
- `MAIL_TO` (recommended: `help@digitalkidsfoundation.org`)
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Required for laptop admin:

- `CF_ACCESS_AUD`
- `CF_ACCESS_ISSUER` (current DKF issuer: `https://cool-glitter-cd9e.cloudflareaccess.com`)
- `DKF_ADMIN_EMAILS` (comma-separated, e.g. `help@digitalkidsfoundation.org`)
- Optional `LAPTOP_NOTIFY_EMAIL`

Required for PayPal server verification:

- `PAYPAL_MODE` (`live` or `sandbox`)
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_RECEIVER_EMAIL`
- Optional `GA4_MEASUREMENT_ID` (defaults to `G-9H2PMKKH2N`)
- Optional `GA4_API_SECRET` (required for server-side `purchase` Measurement Protocol event)

Required before issuing donor receipts:

- `DKF_RECEIPT_SIGNING_KEY` — stable secret in hex, minimum 32 bytes / 64 hex characters
- Optional `DKF_MAILING_ADDRESS`
- Optional `DKF_EIN`

Staging URL behavior:

- Leave `PUBLIC_BASE_URL` **unset** while testing `backup.digitalkidsfoundation.org` so verification/status/receipt links use the incoming staging hostname.
- At main-domain cutover, `PUBLIC_BASE_URL=https://digitalkidsfoundation.org` is optional because the Worker automatically uses the incoming hostname when the variable is unset.

Legacy `VERIFICATION_ENCRYPTION_KEY` may remain configured, but v3 public inquiry forms no longer use the old pending-verification workflow.

## D1 migration

Run `migrations/0002_v3_core.sql` against `dkf-backup-db` before testing v3 backend features. It is additive and creates the v3 laptop, PayPal, receipt, audit, and rate-limit tables with `IF NOT EXISTS`.

The old `0001_form_backend.sql` is kept for repository history. v3 does not depend on the old `pending_verifications` workflow for normal Contact, Volunteer, or Device Donation submissions.

## Safe deployment order

1. Keep Coolify production unchanged.
2. Apply `migrations/0002_v3_core.sql` to `dkf-backup-db`.
3. Configure/verify Worker secrets and D1 binding.
4. Make sure the Turnstile widget allows `backup.digitalkidsfoundation.org` (and the workers.dev preview hostname if you test there).
5. Push v3 to the GitHub repository connected to Worker `dkf-backup`.
6. Test `https://backup.digitalkidsfoundation.org/health`.
7. Test homepage, `/donate-laptops/`, `/corporate-partnerships/`, `/brooklyn-digital-access/`, `/request-a-laptop/`, `/application-status/`, and mobile views.
8. Test Contact, Volunteer, Device Donation, laptop application email verification, laptop status, and staff email notifications.
9. Test Cloudflare Access authentication for `/laptop-admin/` and the admin APIs.
10. Test donor receipt draft -> PDF preview -> send -> public verification -> revoke using test data only.
11. Test PayPal in sandbox before live verification.
12. Run Tag Assistant on homepage, Donate Laptops, and Corporate Partnerships; confirm Google Analytics/Ads tags fire with zero CSP errors.
13. Confirm GA4 Realtime receives `laptop_donation_submit` and `corporate_partner_submit` from staging tests.
14. Only after every test passes should DNS/Worker custom-domain routing for `digitalkidsfoundation.org` be changed.
15. Keep Coolify available as rollback until the Cloudflare production site has been stable and verified.

## Important data note

D1 and the current Coolify PostgreSQL database are separate systems. New laptop applications, inventory, allocations, PayPal records, and donor receipts created on the Cloudflare staging Worker are stored in `dkf-backup-db`; they are not automatically synchronized with the current Coolify database. Use test data on the backup hostname until final cutover/migration planning is complete.


## PayPal / GTM verified donation tracking (v9)
- The PayPal callback stores the transaction ID before server verification so the Thank You page can retry when PayPal reporting is delayed.
- `/donation-success/` retries server verification and pushes `paypal_donation_verified` only after a verified completed transaction.
- The dataLayer event exposes `value`, `transaction_id`, and `currency` at the top level for GTM Data Layer Variables, and also includes an ecommerce object.
- Server-side GA4 purchase reporting is opt-in via `GA4_SERVER_SIDE_PURCHASE=true` to avoid duplicate purchase events when GTM client tracking is active.


## v10 PayPal IPN fix
- PayPal IPN no longer requires REST Client ID/Secret; it verifies through PayPal's IPN validation endpoint and requires only D1 plus `PAYPAL_RECEIVER_EMAIL`.
- `/api/paypal/donation-complete` now checks D1 first, so the Thank You page can recognize an IPN-verified donation even when PayPal REST API credentials are not configured.
- Required Cloudflare variable: `PAYPAL_RECEIVER_EMAIL` must match the PayPal receiver/business email exactly.

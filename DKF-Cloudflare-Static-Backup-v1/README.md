# DKF static emergency backup (Cloudflare Workers)

This is a **separate repository** for Cloudflare, not a replacement for the production DKF/Coolify repository.

## Cloudflare Git setup
1. Create a NEW GitHub repository, e.g. `dkf-cloudflare-backup`, and upload this ZIP contents to its root. Do not push this backup package into the production `dkf` repository.
2. On the Cloudflare Workers Git deployment screen, go Back and select the NEW repository.
3. Project name: `dkf-backup`. Build command: leave blank. Deploy command: `npx wrangler deploy`. Path: `/`.
4. Do not attach `digitalkidsfoundation.org` or change production DNS until the backup is tested.
5. Verify the Workers URL, pages, images and that all forms show offline notices.

## Limitations
- STATIC emergency backup only; volunteer, donation device inquiry, and contact forms are replaced with an offline message. Email verification does not run.
- PayPal-related donation functionality and embedded external integrations must be reviewed in the live preview before treating them as functional.
- The backup has no automatic failover. Manually changing Cloudflare routing requires separate configuration and testing.
- The backup includes `X-Robots-Tag: noindex` and robots.txt disallow to discourage duplicate indexing.
- Keep content synchronized by updating this separate repository when DKF production content changes.

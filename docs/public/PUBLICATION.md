# Sanitized source snapshot

## Proposed repository metadata

- Name: `offline-shopping-list`
- Description: `Offline-capable grocery shopping PWA built with React, Fastify, PostgreSQL and TypeScript.`
- Topics: `typescript`, `react`, `fastify`, `postgresql`, `pwa`, `offline-first`, `indexeddb`, `full-stack`.

Status: **Public release authorized.** The author has authorized MIT for original first-party code, and [LICENSE](../../LICENSE) contains that grant. Third-party materials retain their own terms. The public repository uses a new Git history, independent of the original project.

## Included

The root README is based on `README.public.md`. The snapshot contains application source, seven backend and seven frontend test files, five SQL migrations and Drizzle schema metadata, generic package/workspace configuration, generic Compose/Docker configuration and reviewed public docs. The example configuration uses fictional values. There is no `.env` file.

## Excluded

Git metadata/history, operational README and AGENTS, private docs, actual environment files, real household records, backups, databases, installed dependencies, builds, logs, keys, deployment backup scripts and systemd units. Six unverified visual resources are excluded: `apps/web/assets/pwa-icon.svg`, `apps/web/assets/pwa-maskable.svg`, `apps/web/public/favicon.svg`, `apps/web/public/pwa-192.png`, `apps/web/public/pwa-512.png` and `apps/web/public/pwa-maskable-512.png`. The three manifest icon declarations and favicon link were removed only in this snapshot so they do not point to missing files. The app UI and routes remain; browsers/platforms will supply a generic fallback icon, and this snapshot has no custom browser tab icon or installed-app icon. Do not treat the icon drawings as cleared for redistribution.

## License and third parties

The author confirms ownership of the original project code and authorizes MIT for it; see [LICENSE](../../LICENSE). The six SVG/PNG icons listed above remain excluded because redistribution rights are not confirmed. They are not covered by the first-party license. Nunito Sans remains under SIL OFL-1.1 with its notice retained; dependency packages and other third-party materials keep their own licenses. See [third-party notices](THIRD_PARTY_NOTICES.md) and the [dependency license inventory](DEPENDENCY-LICENSES.csv).

The lockfile has 647 dependency references, of which 160 lacked local license metadata in the inventory. Dependency packages are not vendored here, so those references alone are not a blanket release blocker for this source snapshot. Review the actual packages/notices in any future built bundle or container distribution. PWA home-screen installation and physical-phone testing remain pending. See the [desktop capture](../screenshots/catalog-desktop.png), [mobile capture](../screenshots/shopping-offline-mobile.png) and [validation report](evidence/validation-2026-10-13/README.md).

## Validation gates

- [x] Confirm first-party code ownership and apply MIT to original code only.
- [x] Exclude icons with unresolved redistribution rights; there is no favicon or custom install icon in this snapshot.
- [x] Validate install, typecheck, 87 tests and both builds with disposable PostgreSQL and fictional data. [Evidence](evidence/validation-2026-10-13/README.md). Docker image builds and physical PWA installation remain unverified.
- [x] Capture reviewed desktop/mobile demo screenshots and browser verification. [Screenshots](../screenshots/README.md).
- [ ] Test PWA home-screen installation and behavior on a physical phone.
- [x] Owner authorized public release of this sanitized source snapshot.

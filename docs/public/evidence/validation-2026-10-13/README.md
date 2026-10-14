# Functional validation — Offline Shopping List

Date: 2026-10-13. **Verdict: fit for publication preparation (Apto para preparación de publicación).** Publication itself remains pending rights, license decisions and explicit authorization.

## Results

| Check | Result |
| --- | --- |
| Clean dependency install with frozen lockfile | Passed; 487 packages installed only in the snapshot |
| Lint | Not applicable: no lint script or configuration exists |
| Workspace typecheck | Passed, including API, web and shared workspace |
| Backend build | Passed |
| Frontend/PWA build | Passed; manifest, Service Worker and 10 precache entries generated |
| Vitest backend | 39 passed, 0 failed, 0 skipped, 7 files |
| Vitest frontend | 48 passed, 0 failed, 0 skipped, 7 files |
| Schema migrations / seed | Five migrations; five generic categories |
| Integration isolation | Dedicated PostgreSQL 17.10 cluster, fictional role/database, loopback only; no leftover test databases |
| Browser | Pairing, catalog creation/search, pending actions, offline purchase/price, offline reload, ordered sync, completion and revocation checked |

Test environment: Node.js 26.9.0, pnpm 11.19.0, PostgreSQL 17.10 and Chrome DevTools MCP. Desktop viewport 1280×900 and mobile emulation 390×844 with touch. This does not certify the oldest Node.js 22 release or a physical phone.

## Commands executed

Commands ran with a clean explicit environment. DATABASE_URL selected a new fictional `shopping_validation` database on loopback port 55439; it was checked against the dedicated cluster directory before any mutation. No real env file was loaded. API/preview used unused ports 43127/43128.

```sh
CI=true pnpm install --frozen-lockfile --store-dir node_modules/.validation-store --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
# Disposable PostgreSQL tools in a temporary snapshot directory:
<temporary-postgres-bin>/initdb -D <temporary-pgdata> -U shopping_demo --pwfile=<temporary-fictional-password-file> --auth=scram-sha-256 --locale=C.UTF-8
<temporary-postgres-bin>/pg_ctl -D <temporary-pgdata> -l <temporary-server-log> -o "-p 55439 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -w start
# After verifying that the connection reaches that new cluster:
psql -c 'CREATE DATABASE shopping_validation'
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm --filter @lista/api device:code
# Backend buildApp() was started on 127.0.0.1:43127 using compiled app.js.
API_PROXY_TARGET=http://127.0.0.1:43127 pnpm --filter @lista/web exec vite preview --host 127.0.0.1 --port 43128 --strictPort
node apps/api/dist/domains/device-auth/cli.js revoke-device <fictional-device-id>
<temporary-postgres-bin>/pg_ctl -D <temporary-pgdata> -m fast -w stop
```

Command logs: [install](install.txt), [typecheck](typecheck.txt), [build](build.txt), [tests](tests.txt), [migrations](migrations.txt), [seed](seed.txt), [pairing CLI](pairing-cli.txt), [database verification](database-check.txt), [isolation verification](database-isolation.txt), [PostgreSQL initialization](postgres-init.txt), [startup](postgres-start.txt), [shutdown](postgres-stop.txt). Pairing codes, local hostnames and user paths are redacted.

Docker and passwordless sudo were unavailable, so no existing Docker service was used. Instead, registry-integrity-verified PostgreSQL 17 binaries from [embedded-postgres](https://github.com/leinelissen/embedded-postgres) were downloaded into the temporary snapshot tools directory and removed after validation. They are validation tools, not new application dependencies or redistributed source assets. A pnpm CLI attempt without the runner's CI setting aborted its automatic dependency check; using the controlled environment and compiled CLI resolved the harness issue. One early browser navigation occurred before preview was ready; a successful health check preceded subsequent navigation. These were harness/setup issues, not app test failures.

## Browser and PWA evidence

Only `Demo device`, `Arroz demo` and `Pasta demo` were used in browser workflows. Backend tests generated their own synthetic temporary records and databases.

- A clean isolated browser context initially showed pairing. A temporary code authorized `Demo device`, and online catalog creation produced the two demo products.
- Both products were marked pending. On mobile with CDP transport disabled, `Arroz demo` was bought and assigned 25.50 MXN. IndexedDB held two pending operations (sequence 3 then 4) and integer `priceCents: 2550`.
- Offline reload of `/list` succeeded with the Service Worker controlling the page, retaining the purchase and price. The transport probe failed as expected. CDP left `navigator.onLine` true, so offline proof uses failed transport and retained outbox state, not that browser flag.
- After reconnect/reload, the queue emptied. The server showed one purchase item priced at 2550 cents: no duplicate effects. The observed POST-buy then PATCH-price order matched the queue.
- Finishing left no active purchase and retained `Pasta demo` pending. SQL confirmed one FINISHED purchase. Revocation returned the browser to pairing after reload.
- Mobile search matched Arroz and hid Pasta; desktop and mobile views had no horizontal overflow.
- Manifest and Service Worker returned 200; the worker activated and cached 10 static entries, with no API responses in precache. The recorded online requests were all 2xx and the final online console had no errors/warnings. Offline transport errors and initial unauthenticated 401s were expected.
- None of the six excluded SVG/PNG paths is referenced by the built app or precache. No missing-icon 404, build error or worker installation error was observed. The manifest intentionally contains no `icons` entry. Home-screen installation, install prompts and generated fallback icons were not exercised; cleared icons remain needed for professional installation branding.

Screenshots with fictional data:

- [Empty pairing form](pairing-empty.png)
- [Desktop catalog, 1280×900](catalog-desktop.png)
- [Mobile catalog, 390×844](catalog-mobile.png)
- [Offline purchase and price](shopping-offline-mobile.png)
- [Finished purchase, unbought product retained](purchase-finished-mobile.png)

Machine-readable evidence: [browser results](browser-results.json), [complete results](results.json), [network requests](network-online.txt), [online console](console-online.txt), [cleanup](cleanup.json).

## Corrections, cleanup and boundaries

No business code, test expectations, schema migration or lockfile needed correction during this validation. Documentation was updated to replace the previous “not run” status with these results. The excluded assets were not reintroduced, and no MIT license was applied.

The temporary API/preview process groups and PostgreSQL were stopped. Loopback ports 43127, 43128 and 55439 were confirmed closed. The disposable database cluster/password/binaries, all installed snapshot node_modules directories and generated dist outputs were deleted. Browser registrations, caches and IndexedDB for the isolated demo origin were cleared, and only the demo pages were closed. Screenshots and reviewed text logs remain here; no runtime data or package binaries are included.

The original repository was verified unchanged using SHA-256 for 110 source/documentation files and 415 Git metadata/object files, plus Git status and ignored env file metadata. Its env contents and real datasets were never opened. No command targeted the domestic deployment, and no service there was accessed or restarted. No commit, remote repository or push was created.

## Publication status after validation

After this validation, the author confirmed ownership of the original project code and authorized MIT for that code. The root [LICENSE](../../../../LICENSE) records the 2026 copyright and grant. Third-party materials retain their separate licenses and notices.

The six app/browser icon assets remain excluded because their redistribution rights are unconfirmed. The validated source snapshot has no custom favicon or install icon. Home-screen installation and testing on a physical phone remain pending; Docker image reproducibility and the minimum supported Node runtime also remain unverified. The 160 dependency lockfile entries without local license metadata do not automatically block this source-only snapshot; reassess them if package contents or build artifacts are distributed.

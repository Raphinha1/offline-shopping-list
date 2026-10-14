# Third-party dependency and asset review

Reviewed on 2026-10-13 from the current lockfile and locally installed package metadata. This is an inventory, not a replacement for upstream license texts or a completed distribution clearance.

## First-party code

The author confirms that the original first-party project code is authored by Hiram Rafael Pérez Ibarra and authorizes MIT for that code. The grant and copyright notice are in the root [LICENSE](../../LICENSE). This does not cover the six excluded rights-pending icons, Nunito Sans, dependency packages or other third-party materials. Their own licenses and notices remain applicable.

## Direct dependencies

| Package/group | Observed license |
| --- | --- |
| React, React DOM, Fastify, Zod, Vite, Tailwind, Vitest, Testing Library, Workbox and supporting direct tools | MIT |
| Drizzle ORM, TypeScript and fake-indexeddb | Apache-2.0 |
| dotenv | BSD-2-Clause |
| postgres (Postgres.js) | Unlicense |
| Nunito Sans via `@fontsource-variable/nunito-sans` | SIL OFL-1.1 |

Versions and per-package inspection status are in [DEPENDENCY-LICENSES.csv](DEPENDENCY-LICENSES.csv). Of 647 package entries in the lockfile, 487 have matching locally installed license metadata; 160 are UNCONFIRMED. Installed metadata is preliminary evidence: inspect the corresponding upstream LICENSE/NOTICE for the exact distribution, including entries without a packaged license text and optional platform packages not installed on this host.

## Obligations requiring attention

- Nunito Sans is bundled by the frontend build. Preserve the upstream font copyright/license when distributing font files. A byte-identical copy of the installed package's license is included at [licenses/Nunito-Sans-OFL.txt](licenses/Nunito-Sans-OFL.txt). See [official OFL guidance](https://openfontlicense.org/how-to-use-ofl-fonts/).
- Lightning CSS and its observed native packages declare MPL-2.0. They are build-tool dependencies; assess what is actually distributed before claiming obligations on application code. For MPL-covered binaries/sources that are distributed, preserve notices and applicable source availability. See [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
- `caniuse-lite` declares CC-BY-4.0. Preserve attribution/license information when redistributing its data; do not confuse this tooling dataset with user data.
- Other observed transitive licenses include ISC, BSD-3-Clause, BlueOak-1.0.0, MIT-0 and MIT/CC0 alternatives. They must not be blanket-labelled MIT.
- Docker base images and anything in a future built artifact need a separate distribution inventory. Listing direct JavaScript packages does not cover an entire container image.

No dependency installation, update or vulnerability scan was performed. A deprecation notice in lockfile metadata is not itself a validated application vulnerability.

## Icons and other materials

The six tracked SVG/PNG icon files from the original source are excluded from this snapshot because their author and redistribution rights are unconfirmed. Their removal and interface consequences are documented in [PUBLICATION.md](PUBLICATION.md). No external photos or household dataset are included.

## Snapshot distribution scope

No dependency package contents, generated bundles, Docker images, font files or third-party icons are included. The lockfile and package manifests only reference dependencies. The 160 entries without locally verified license metadata are a follow-up for any future artifact containing them, not a blanket blocker for this source-only copy. The Nunito Sans notice is retained, though its font binaries are absent. Review exact bundled/image contents and preserve applicable notices before distributing artifacts. The six excluded app icons remain rights-pending and their removal is documented in `PUBLICATION.md`.

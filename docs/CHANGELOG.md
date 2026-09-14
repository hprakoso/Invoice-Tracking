# Changelog

Two sections, per `CLAUDE.md` convention:
- **Code Changes Made** — running log of what changed and why, newest first. Add an entry here for every task before committing.
- **Commit Log** — the project's git history, grouped by phase for readability. Reconstructed retrospectively on 2026-07-15 since `docs/` did not exist before this file.

---

## Code Changes Made

### 2026-09-14 — Feedback PM #1: comment dan aktivitas invoice muncul di "Riwayat & PIC"

**Akar masalah: datanya sudah tersimpan, tidak pernah dibaca.** `PATCH /api/invoices/[id]`
menulis comment PIC ke `audit_logs.metadata.comment` sejak awal, tetapi `GET /api/invoices/[id]`
hanya mengembalikan `stageHistory` dan komponen timeline hanya merender itu — sehingga perubahan
status, penugasan PIC dan comment tidak pernah punya jalan ke layar.

**Perubahan.** GET kini juga mengembalikan `activity`: baris `audit_logs` milik invoice tersebut,
di-scope `(entity_type, entity_id)` — keduanya literal, tidak pernah dari client — dan dijalankan
**setelah** pengecekan kepemilikan vendor yang sudah ada, sehingga otorisasinya persis mengikuti
otorisasi invoice itu sendiri. Tidak ada aturan akses baru yang dibuat: siapa pun yang boleh membaca
invoice boleh membaca aktivitasnya, sama seperti `stageHistory`, `items` dan `documents` selama ini.
`invoice.stage_changed` dikecualikan untuk semua role karena `invoice_stage_history` sudah memuat
setiap perpindahan — memasukkan keduanya akan menampilkan satu perpindahan dua kali.

Satu lubang pencatatan ikut ditutup: `comment` yang dikirim bersama edit non-status dulu dibuang
diam-diam (hanya cabang `filtered.status` yang menyimpannya).

**Tanpa file baru dan tanpa migrasi.** Penggabungan dua sumber riwayat dilakukan langsung di
halaman detail, bukan di modul util baru — `CLAUDE.md` meminta memakai util yang sudah ada lebih
dulu, dan tidak ada abstraksi timeline yang bisa dipakai ulang. Index `@@index([entityType, entityId])`
yang dibutuhkan query ini sudah dideklarasikan di schema. Penugasan PIC dirender dari
`metadata.fields` yang memang sudah ditulis rute, jadi bentuk metadata tidak diubah dan baris
historis tetap terbaca.

### 2026-09-11 (revisi) — Target hosting UAT diubah ke Render + Supabase, sepenuhnya gratis

Maintainer meminta opsi gratis, menyebut Netlify, Render atau Cloudflare. Rekomendasi berbayar
(Railway) diganti; konfigurasi containernya tidak berubah sama sekali karena image-nya sama.

**Dua dari tiga tidak muat secara arsitektural, bukan soal harga.** Netlify menjalankan Next.js sebagai
serverless function: batas payload ~6 MB mematikan unggahan 10 MB × 10 file yang diizinkan
`uploadLimits.ts`, dan batas durasi function memutus stream SSE rute OCR yang dirancang jalan 60 detik+.
Cloudflare Workers bukan runtime Node penuh — Prisma 7 di sana masih kena bug Wasm codegen terbuka, dan
D1 adalah SQLite sementara skema ini `provider = "postgresql"` dengan 15 migrasi. **Render** satu-satunya
yang menjalankan container Docker dengan proses Node hidup terus, jadi Dockerfile yang sudah ada jalan
apa adanya.

**Database dan storage sengaja tidak di Render.** Postgres gratis Render **kedaluwarsa 30 hari setelah
dibuat** lalu dihapus permanen setelah 14 hari grace — UAT tidak boleh mati di tengah jalan. Free tier
juga tidak punya disk persisten. Keduanya diambil dari satu project Supabase gratis: `fileService.ts`
sudah memilih Supabase Storage begitu `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` terisi, jadi **nol
perubahan kode** untuk keduanya.

**`render.yaml` baru.** Web service Docker, plan free, region Singapura, healthcheck ke `/api/health`
yang sudah ada. `NEXTAUTH_SECRET` dan `CRON_SECRET` memakai `generateValue: true` sehingga dibangkitkan
Render dan tidak pernah menyentuh git; seluruh rahasia lain `sync: false`, diminta lewat dashboard saat
deploy pertama. Terkonfirmasi dari dokumentasi Render: **setiap env var service otomatis diterjemahkan
menjadi Docker build arg**, sehingga `ARG NEXT_PUBLIC_*` di stage `builder` menerima nilainya tanpa
konfigurasi tambahan — syarat mutlak karena `NEXT_PUBLIC_*` disulih saat build, bukan runtime.

**Batas yang diterima sadar:** 512 MB RAM / 0.1 CPU, dan tidur setelah ~15 menit idle (cold start
~50 detik). Risiko nyata yang dicatat, bukan disembunyikan: `exceljs` menyusun XLSX di memori, jadi
export daftar panjang bisa OOM. `railway.json` **sengaja dipertahankan** sebagai jalan keluar
terdokumentasi untuk kasus itu — image-nya sama, jadi pindah tidak butuh perubahan kode.

`docs/DEPLOY_RAILWAY.md` → `docs/DEPLOY_UAT.md`, ditulis ulang dengan Render sebagai jalur utama dan
Railway sebagai upgrade berbayar di §6.

### 2026-09-11 — Hosting UAT: image container, dan tombol demo yang bertahan di build produksi

Tujuan maintainer: aplikasi online secepatnya untuk dicoba beberapa penguji, dengan perubahan
seminimal mungkin. Didahului audit enam dimensi (runtime, environment, build, database/storage,
auth, higiene rahasia) plus riset lima platform secara paralel.

**Kondisi awal ternyata sudah sehat.** `tsc --noEmit` bersih, 125/125 tes lulus, `next build`
berhasil, dan **ke-29 rute terkompilasi dinamis** — tidak ada halaman yang menyentuh Prisma saat
build, jadi build Docker tidak membutuhkan database hidup. Yang kurang murni lapisan hosting.

**Platform: Railway.** Dipilih dari enam kandidat. Alasan yang menentukan: region Singapura
(~25–40 ms dari Jakarta), tidak ada plafon timeout request sehingga SSE OCR yang bisa jalan 60 detik+
tidak perlu dipikirkan, dan volume yang membuat jalur fallback disk di `fileService.ts` menjadi
persisten **tanpa perubahan kode**. DigitalOcean App Platform dicoret karena timeout 100 detik yang
tidak bisa diubah dan tidak adanya volume persisten; Cloudflare Workers karena Prisma 7 di sana masih
kena bug terbuka; Fly.io karena Managed Postgres mulai $38/bln; Render karena RAM mentok 512 MB di
Starter, realistis OOM untuk `exceljs` + `react-pdf` + SDK Gemini. Perbandingan lengkap dan urutan
perintahnya ada di [`DEPLOY_RAILWAY.md`](./DEPLOY_RAILWAY.md).

**`output: "standalone"` di `next.config.ts`**, sehingga stage runtime image tidak perlu
`node_modules`. Diabaikan `next dev`/`next start`, jadi alur kerja lokal tidak berubah. `Dockerfile`
sengaja Dockerfile biasa dan bukan buildpack Railway: image yang sama jalan di Render, Fly, Cloud Run
atau VM mana pun, supaya pilihan UAT tidak mengunci pilihan produksi. Stage runner menyalin `public/`
dan `.next/static` secara manual — `output: standalone` memang tidak menyertakan keduanya, dan tanpa
salinan itu semua aset statis 404.

**Tombol login sekali-klik butuh perubahan kode, bukan variabel.** `login/page.tsx` memagari blok
tombol dengan `process.env.NODE_ENV === 'development'`. Next.js menyulih nilai itu saat **build**, jadi
pada build produksi ekspresinya terlipat menjadi `false` dan markup-nya dibuang dead-code elimination
— diverifikasi terhadap build produksi repo ini sendiri: `.next/static/` tidak memuat `gastaff@sip.id`
maupun `demo1234` sama sekali. Tidak ada variabel runtime yang bisa menghidupkannya kembali. Gerbangnya
kini menerima `NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true'` sebagai alternatif, dan label "Dev" menjadi
"Demo" karena sekarang memang bisa tampil di luar `next dev`. **Perilaku produksi tidak berubah selama
variabel itu tidak diset.** Mekanisme login, provider, hash password dan middleware tidak disentuh.

Konsekuensi yang mudah terlewat: `NEXT_PUBLIC_*` disulih saat build, jadi di host container ia harus
jadi **build argument**. Docker mengisolasi build dari environment host, sehingga variabel service
Railway hanya masuk kalau dideklarasikan `ARG` di stage yang memakainya — keduanya sudah dideklarasikan
di stage `builder`. Menyetelnya hanya sebagai variabel runtime tidak melakukan apa-apa, tanpa error.

**Satu jebakan lama ikut diperbaiki di `.env.example`.** Baris `AUTH_TRUST_HOST=` (kosong) lebih buruk
daripada tidak ada: NextAuth menghitung `!!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== "production")`,
dan `??` hanya melompati `null`/`undefined`. String kosong bukan keduanya, jadi rantainya berhenti di
situ dan menghasilkan `false` — mematikan `trustHost` bahkan di development, di mana nilai yang tidak
diset justru menyalakannya. Placeholder-nya kini `AUTH_TRUST_HOST=true`.

**Data touched:** tidak ada. Tidak ada perubahan skema, migrasi, maupun rute API. `railway.json`
mengarahkan healthcheck ke `/api/health` yang sudah ada.

**Sengaja tidak dikerjakan:** cron harian (cron Railway menjalankan perintah, bukan URL — rute ini
dipicu manual selama UAT); migrasi otomatis saat deploy (butuh CLI Prisma di image runtime);
memindahkan `bcryptjs` dari `devDependencies` (salah tempat, tapi build ini aman karena `npm ci`
memasang dev deps dan output tracing menelusuri impor sungguhan). Ketiganya tercatat di §6
`DEPLOY_RAILWAY.md`.

**Verified:** `tsc --noEmit` bersih, 125/125 tes lulus, `eslint` bersih kecuali satu peringatan lama di
`src/app/api/notifications/route.ts` yang tidak disentuh perubahan ini.

### 2026-09-10 — Document-first upload, AI document classification, and vendor credential lockdown

Branch `feat/document-first-upload`, cut fresh from `main` at the maintainer's instruction. Preceded by an analysis pass over the FE, API, schema, migrations, auth and OCR pipeline (7 parallel readers → 4 decision agents), which surfaced four business decisions the maintainer confirmed before any code was written, plus six implementation defaults they reviewed and adjusted.

**The four confirmed decisions.** (1) Vendor identity comes from the session for `VENDOR`, but `ADMIN`/`GA_STAFF`/`GA_MANAGER` keep the vendor picker — they have no vendor on their session (`users.vendor_id` is forced null for non-vendors), and removing it would delete the documented hardcopy-intake path with no replacement. (2) The OCR-detected company is a **pre-fill, not authoritative** — it stays correctable on the confirmation step, the only option that survives an OCR failure and keeps the every-invoice-has-a-company invariant. (3) An admin password reset issues a **temporary** password and re-arms the forced change, so no admin ever holds a vendor's live credential. (4) A PO number stays **mandatory**; only the moment it is enforced moves.

**Upload became document-first.** Step 1 previously hard-blocked on company, vendor and PO before the file picker was even reachable (`upload/page.tsx:148-161`). It now takes documents only: several files staged in the browser and uploaded as one submission — invoice, faktur pajak, BAST, supporting files together. Type, size and the per-submission cap are checked client-side against the same `src/lib/uploadLimits.ts` the route enforces, so the browser can't promise what the server will refuse. The wizard is four steps: upload → AI processing → review & confirm → submit.

**Classification already existed and was reused, not rebuilt.** `classifyDocument()` and `normalizeClassification()` (with `CLASSIFICATION_CONFIDENCE_FLOOR = 70` demoting anything less certain to `OTHER`) were already in place and already implemented the "never force a category" rule the requirement asked for. The change is *when* they run: every file is now classified at upload, including the first. The `primary=true` form field is gone — it used to skip classification because the extraction call that immediately followed classified that file for free, and extraction no longer follows immediately.

**No arbitrary extraction source.** The first design extracted from the first-uploaded file when nothing classified as `INVOICE`; the maintainer rejected that as too arbitrary — it risks reading a company and PO out of a BAST or a faktur pajak. So extraction reads **only** a document classified `INVOICE`, preferring a human-assigned type over any AI guess. When nothing qualifies, `GET …/ocr` emits `needs_invoice_selection` and extracts **nothing**; the confirmation step says the invoice document has not been identified, the user marks which file it is, and extraction re-runs against exactly that document via `?documentId=`. A related trap closed in the same place: extraction used to overwrite the document's type unconditionally, which would have demoted the file the user had just marked as the invoice and left the next run with nothing to read again — a loop. It now skips that write when `classification_confidence IS NULL`, the marker for a human decision.

**Company resolution from the bill-to block.** The extraction schema had **no** company field at all, so "company from OCR" was not expressible before this. It gains `company_name` and `company_npwp`, with prompt text spelling out the sender/bill-to distinction (an Indonesian invoice names two companies, and confusing them routes the invoice to the wrong PT) and instructing the model to return null rather than guess which role a lone company plays. New `src/lib/companyMatch.ts` resolves that to a `companies` row: NPWP first, then a normalized name (case, punctuation, whitespace and legal-form prefix stripped). **Exact matching only** — no fuzzy, no substring. Two or more hits report `AMBIGUOUS` and resolve to nothing rather than picking, because `companies.name` carries no unique constraint. Substring matching was considered and rejected against real data: the seeded companies already collide on it, with "Gemilang" appearing in both `PT Nusantara Gemilang Sejahtera` and `UD Karya Gemilang`.

**PO number was never extracted at all.** `EXTRACTION_SCHEMA` had no `po_number` and the SSE field list never emitted one, so the wizard's `FIELD_DEFS.po_number` entry only ever rendered on the OCR-failed fallback path — a dead field. It is now extracted and pre-filled.

**Draft rows and the go-live gate.** The row must exist before any upload (every upload is addressed by invoice id), but the PO and company aren't known then. `createInvoiceSchema` now allows `poNumber` to be omitted **only** for `isDraft: true`, and the route writes `DRAFT_PO_PLACEHOLDER` (`'PENDING-OCR'`) into the `NOT NULL` column. Deliberately not `'N/A'` — migration `20260901000000` backfilled genuine pre-PO rows with that string, and reusing it would make real history indistinguishable from an unfinished draft. New `validateReadyToGoLive()` then refuses the `is_draft` true→false transition while the PO is still a placeholder or the company is null. Neither placeholder is inert if it leaks: `po_number` is a `contains` filter shared by the dashboard and the invoice list and is written verbatim into the Excel export, so a shared token would return whole batches; a null `company_id` still lists but is unreachable from every company filter, KPI breakdown, export and chatbot answer, with nothing flagging that it needs one. Both were already mandatory — the old wizard hard-blocked on them — so this moves the rule from the browser to the server, which it has to be now that neither is collected up front. The gate is scoped to the **transition**, not to every PATCH carrying `isDraft: false`, so editing a legacy live invoice that predates the company requirement isn't blocked by it.

**A dead control fixed.** The review step rendered the document type picker and remove button for every role, but both routes were `requireRole(['ADMIN','GA_STAFF','GA_MANAGER'])` — so a vendor's click always 403'd, silently, as a toast. Since the confirmation step's whole safety story is a human checking the AI's classification, and the uploader is usually the vendor, `VENDOR` is now accepted for its **own invoice while `is_draft` is true** (`canMutateDocuments()`). Live-invoice reclassification stays staff-only.

**Upload spend was unmetered.** Classification runs inside `POST …/upload`, which had no rate limit at all — the only metered AI paths were chat and OCR, so an authenticated user could drive unbounded Gemini spend by uploading files. It now shares a limiter sized against the document cap, and the per-invoice document count is bounded where it previously wasn't. `MAX_DOCUMENTS_PER_INVOICE` (10) lives in `src/lib/uploadLimits.ts` as the single knob, per the maintainer's instruction not to scatter the number — it is an initial technical limit, not a business rule.

**Vendor credentials.** A vendor sets its own password exactly once, at first login; afterwards it can change neither its password nor its login email, and both refusals are enforced server-side rather than by hiding a field.

- `canChangeOwnPassword()`: `PATCH /api/users/me/password` 403s a `VENDOR` whose `must_change_password` is already false. Read **from the database, not the session** — a stateless JWT can lag an admin reset by the token's lifetime.
- The forced change now applies to the API. `middleware.ts` enforced it as a page-route redirect only while letting every `/api/*` request straight through, so a vendor still on the admin-issued password could drive the entire application from `curl` without ever changing it. Closed for all routes at once in the one place that already made this decision, exempting only NextAuth's routes and the password route that clears the flag, and scoped to `VENDOR` so no other role's access changes. Tested for exactly that bypass, including a path (`/api/users/me/passwordx`) that only looks like the exempt route.
- `users.email` was read-only by accident — no route wrote it for anyone. That made the requirement free but the escape hatch nonexistent, so `PATCH /api/users/[id]` (ADMIN-only) gains `email` and `password`. A password set there always re-arms `must_change_password`, for every role, so it is a handover secret and never a live credential. Email collisions report 409 instead of surfacing a Prisma `P2002` as a 500.
- Credential changes get their own audit actions (`user.email_changed`, `user.password_reset`, `user.active_changed`). Previously a password reset would have been logged as `user.role_updated`. The password itself is never logged.
- `vendors.contact_email` stays vendor-editable: it is profile/master data, not the authentication identity (notifications go to `users.email`), and locking it would remove a working feature and make the profile's own required-field check unsatisfiable for any vendor whose value is blank. The vendor profile page now shows the login email read-only and states where both credentials are managed.

**The re-arm migration was verified before being written, not assumed.** The maintainer explicitly refused a blanket `UPDATE users SET must_change_password = true WHERE role = 'VENDOR'` without evidence that no vendor had genuinely completed a first-login change. There is a reliable discriminator: `PATCH /api/users/me/password` is the only route that has ever written `users.password_hash` for a signed-in user, and it has written a `user.password_changed` audit row **since the commit that introduced it** (`a067057` — verified by reading that commit's version of the file, not inferred), so no self-service change has ever left no trace. Audit rows are never pruned — the only statement that deletes them is `seed.ts`, which drops `users` in the same run, so a user cannot outlive its own audit history. Migration `20260910000000_vendor_initial_password_rearm` therefore skips any vendor holding that audit row. The migration is needed at all because `seed.ts` writes `false` for every account it creates, including both demo vendors, which would otherwise be frozen on a shared seeded password with no way to set a private one.

**Data touched:** no schema change. `invoices.po_number` gains the `'PENDING-OCR'` placeholder value on draft rows; `invoices.company_id` is now genuinely null while a draft is in progress; `invoice_documents` rows are created per uploaded file as before, with `type`/`classification_confidence` now always AI-populated at upload. `users.must_change_password` is flipped to true by the migration for vendors with no recorded password change. Two new audit actions (`user.email_changed`, `user.password_reset`, `user.active_changed`, `user.updated`) join the existing set.

**Deliberately unchanged:** `overall_confidence` keeps its existing `CORE_FIELDS` formula — the three new extraction fields are not in it, so the accuracy figure means what it always did. `Invoice.vendorId` remains absent from `updateInvoiceSchema`, so no role including ADMIN can move an invoice between vendors. The dashboard, reminders, chat, invoice list and detail pages, and the status/stage workflow were not touched.

**Adversarial review of this branch.** 4 reviewers over authorization, flow, data integrity and the AI contract produced 26 findings; each was handed to an independent verifier told to refute it. **24 were refuted**, almost all as pre-existing behaviour on `main` that this change did not introduce or worsen (`buildOcrUpdate` byte-identical, the unconditional line-item replace, the `case`-sensitive login email lookup, the OCR route's early-return/`finally` double-close, the `vendorId` null-forcing expression). Two survived, both genuinely introduced by turning one upload into a batch, and both fixed in `3db6049`:

- **A thrown `fetch` escaped the per-file loop.** Offline, a reset connection or a restarted server aborted every file after it while the ones already stored stayed on the draft. Retrying re-uploaded everything, and since the route has no idempotency key the invoice ended up with duplicate document rows — which `setDocs(uploaded)` then hid, because the list was built from one attempt's responses. Invisible rows cannot be relabelled or removed, so they only surfaced after submit. Each file now has its own `try`, only failures stay staged so a retry uploads exactly what is missing, and the list is read back from `GET /api/invoices/[id]`. The staging cap also counts documents already stored rather than only staged ones, matching what the route enforces.
- **A live invoice with no documents.** `validateReadyToGoLive` checked only the PO and company. That state was unreachable before — a file had to exist before the row was created — but the review step can delete documents, so an invoice could go live with none: nothing for GA to verify, a null `file_path`, and figures extracted from a file that no longer exists. Now a server-side precondition, with the confirm button disabled to match.

**Verified:** `tsc --noEmit` clean, `eslint src` clean apart from one pre-existing warning in `src/app/api/notifications/route.ts` (an unused `req` param, untouched by this change), `next build` compiles all 29 routes, and 125/125 unit tests pass — 107 pre-existing plus 18 new across `companyMatch` (14), `validateReadyToGoLive`/`isPlaceholderPoNumber`, the draft PO exemption, and the three authorization predicates including the forced-password-change API bypass the maintainer asked to be covered.

### 2026-09-08 — Demo account set: admin, GA staff, vendor A and vendor B

Requested by the maintainer: a clear four-account demo set rather than an ad-hoc list.

`prisma/seed.ts` now splits the accounts it creates into `DEMO_ACCOUNTS` — `admin@sip.id`, `gastaff@sip.id`, `vendor@sip.id` (Vendor **A**, PT Maju Jaya Abadi) and `vendor2@sip.id` (Vendor **B**, CV Teknologi Nusantara) — and `EXTRA_UAT_ACCOUNTS`, the three that exist only to give a specific scenario a starting row (GA_MANAGER, an inactive account, and one with `mustChangePassword`). All seven share `DEMO_PASSWORD`, so one credential covers the whole walkthrough.

**The new piece is the demo ADMIN.** There was no admin on the demo password at all — the only ADMIN was the bootstrap `admin@vista.id`, which carries `ADMIN_PASSWORD`, a different and much longer secret. The login page's dev buttons offered exactly that account, so the button most likely to be clicked first filled in an email whose password nobody running the demo had. Those buttons now offer the four demo accounts (`admin`, `ga_staff`, `vendor A`, `vendor B`) and the bootstrap admin is kept out of them.

Vendor A and B stay on **different vendors** deliberately: that pair is the only way to exercise cross-tenant isolation — open A's invoice id while signed in as B and confirm the 403.

**One-click sign-in restored on the dev buttons.** They filled the email only, so a demo still meant typing a password four times. They now call `signIn` directly with `NEXT_PUBLIC_DEMO_PASSWORD` (default `demo1234`), and the panel is relabelled "Dev — login sebagai". The password literal does ship in the client bundle — that is the whole reason the bootstrap admin is excluded from this list: `admin@vista.id` carries a real credential and must never appear in client code, whereas `demo1234` is a throwaway seed value behind a `NODE_ENV === 'development'` gate. **Verified empirically, not assumed:** `npm run build` then `grep -r demo1234 .next/static` returns nothing — the dev-only branch is dead-code-eliminated out of the production bundle. If the database is seeded with a different `DEMO_PASSWORD`, set `NEXT_PUBLIC_DEMO_PASSWORD` to match or the buttons stop working; both variables are now documented in `.env.example`, where neither appeared before.

**Data touched:** `users` gains one row (`admin@sip.id`, role ADMIN, password from `DEMO_PASSWORD`). No schema change. The seed's closing summary now prints the three groups separately with their password source.

**Verified:** `tsc` clean, `eslint` clean, 93/93 unit tests, 22/22 end-to-end checks, and the reseeded database confirmed to hold all 8 accounts with the right roles, vendor links, `is_active` and `must_change_password` values. The four dev buttons were checked against the stored hashes with `bcrypt.compare` — all four authenticate, none is inactive or flagged `mustChangePassword`, and the bootstrap admin does **not** accept the demo password.

### 2026-09-07 — UAT data coverage and a production cutover runbook

Follow-up to the Phase 24 remediation, driven by four parallel readiness audits (deploy surface, env-var matrix, migration readiness, UAT data coverage). The maintainer confirmed the admin password and the demo data are not production concerns yet, and asked for the data to be made UAT-ready plus a scenario for continuing to production.

**The seed produced exactly one account.** Only an ADMIN existed, so no role-gated screen could be exercised at all: the vendor portal, the GA queue, the audit page, and — most importantly — cross-tenant isolation, which is the highest-severity thing in this release. Worse, every notification trigger resolved to an empty recipient set (due_soon/overdue/stage_assigned target GA_STAFF/GA_MANAGER; status_changed targets the vendor's users), so the entire notification system was silently untestable. The seed now creates six: GA_STAFF, GA_MANAGER, **two VENDOR accounts on different vendors** (so a tester can open one vendor's invoice while logged in as the other), plus an inactive account and one with `mustChangePassword` — the two auth states that had no starting row. Passwords come from `DEMO_PASSWORD`. This is safe to keep in the tracked seed because the script is destructive by construction.

**`prisma/seed.ts`'s production guard never fired.** It checked `NODE_ENV === 'production'`, but the script runs as `npx tsx prisma/seed.ts` and nothing in that path sets `NODE_ENV` — so the guard was dead code, and `npm run db:seed` with a production `DATABASE_URL` would have deleted every invoice, user, vendor and company. Replaced with a host check on the resolved connection string: non-local targets are refused unless `SEED_ALLOW_REMOTE=yes-i-know` is set. Verified both ways — a Supabase-shaped host is refused, localhost still seeds.

**Seeded invoices could be created in the future.** The current-month bucket picks a day between 1 and 28 regardless of today's date, so seeding on the 7th produced invoices "created" on the 8th and the 20th — and once settled, invoices marked PAID on a date that has not happened yet. Two rows had a future `paid_date`. `createdAt` is now capped at now, which fixes the whole cascade (invoice date, due date, paid date). Settled due dates are also capped at today. Invoices *due* in the future while PAID remain, correctly — paying early is normal.

**Four of seventeen statuses never appeared** (RETURNED_TO_VENDOR, WAITING_USER_CONFIRMATION, WAITING_TAX_DOCUMENT, VENDOR_BANK_ISSUE — half the exception family), so their badges, filter entries and pipeline chips rendered zero rows and a bug in any of them stayed invisible. All 17 now appear, with `picStageFor` extended to place the new ones sensibly.

**Five explicit boundary invoices** (`UAT-*`), because the random mix never lands on the edges this remediation was about: due exactly today, due tomorrow, one day overdue, no due date at all, and a draft. All belong to `vendor@sip.id` so the vendor login sees them. A side effect worth noting: the seeded `due_soon` reminder (daysBefore 3) previously matched **zero** invoices — the closest open due date was 4 days out — so that trigger could never be observed firing.

**Three more UAT blockers fixed:** every `picId` pointed at the ADMIN while the PIC dropdown is fed from `/api/users?role=GA_STAFF`, so filtering by any selectable PIC always returned nothing; every invoice was created by the ADMIN while GA write permissions hinge on `createdById === caller`, so the wider GA field set was unreachable; and no inactive vendor or company existed, leaving the `isActive` toggles and the dashboard's `includeInactive=true` fetch with nothing to act on.

**New `docs/UAT_AND_CUTOVER.md`** — an operational runbook, distinct from `PRODUCTION_PLAN.md` (a roadmap that is now partly historical). It carries the env-var matrix with what actually breaks when each is missing, the two live wrong-environment traps, the UAT account and boundary-data inventory, eight required UAT scenarios mapped to the fixes, and the cutover: pre-flight SQL, backup/pre-image, two apply options, rollback, and smoke tests.

**Three production hazards documented, one corrected in place.** `PRODUCTION_PLAN.md`'s env checklist named `GEMINI_API_KEY` and `EMAIL_FROM` — **the code reads neither**. Provisioning from that list yields a deployment whose OCR and chat throw at runtime and whose every reminder email is sent from the resend.dev sandbox address, which only delivers to the account owner. Corrected to `GOOGLE_API_KEY`/`RESEND_FROM_EMAIL` with a note pointing at `.env.example` as the source of truth. The other two are documented in the runbook: `AUTH_TRUST_HOST` is unset and undocumented, which on any non-Vercel host means every auth request fails `UntrustedHost` — a total login outage on first boot, invisible on Vercel because Vercel injects `VERCEL=1` itself; and `NEXTAUTH_URL` is the one true fail-open, silently defaulting to `http://localhost:3000` and baking that into the CTA link of every notification email.

**Also:** `.env.example` gained `AUTH_TRUST_HOST` and `DATABASE_SSL_REJECT_UNAUTHORIZED` (used but undocumented) and warnings on `DIRECT_URL` and the Supabase pair; `build` became `prisma generate && next build`, since generate previously lived only in `vercel.json`'s buildCommand and any non-Vercel build shipped a stale or missing client; `prisma.ts`'s fallback port corrected from 5434 (nothing listens there) to 5433; and `InvoiceDocument` gained the `@@index([invoiceId])` it already has in the database — real schema drift, which the next `migrate dev` would have resolved by generating a DROP for an index the app needs.

**Data touched:** no schema change. `invoices.is_draft` and all date columns are written by the seed as before; `users` gains four rows; one vendor and one company are flipped to `isActive: false`. The local demo database was reseeded (non-destructive to production — the new host guard now prevents that class of accident).

**Verified:** `tsc --noEmit` clean, `eslint` clean, **93/93 unit tests**, **22/22 end-to-end checks** still passing against the reseeded data, and `npm run build` succeeds with the new build script. Against the database: 17/17 statuses present, 0 invoices with a future `paid_date` (was 2), 1 draft, 1 null-due-date row, 2 invoices inside the due-soon window (was 0), 42 invoices with a GA_STAFF as PIC (was 0), creators spread 37/34/34 across three accounts, and one inactive vendor, company and user each.

### 2026-09-07 — Review remediation 6/6: remaining defects, duplication, and end-to-end verification

The tail of the review's 32 findings, plus the behavioural verification covering all six batches.

**`POST /api/invoices` returns 409 on a duplicate invoice number** instead of an opaque 500. The partial unique index was the only thing preventing two live invoices with the same number, and POST had neither a pre-check nor a P2002 handler. Unlike PATCH there is no auto-reject here — a brand-new row rejected on arrival is noise, so the caller is told to fix the number.

**Deleting a document clears the legacy `Invoice.filePath`/`fileType` mirror.** A primary upload dual-writes the path onto the invoice, and three read paths still go through that mirror (the `/file` endpoint, the detail page's fallback preview, the OCR route). Deleting only the `invoice_documents` row left all three serving a document that no longer existed, and OCR's classification `updateMany` — matched by `file_path` — silently updating zero rows. The route's own comment claiming "the row is what every read path goes through" was factually wrong and has been corrected.

**The dashboard no longer sticks on its skeleton forever.** `fetchDashboard` had no `try`/`finally`, so a rejected fetch (network blip, server restart, JSON parse failure) skipped `setLoading(false)` and the page stayed on its loading state until the user happened to change a filter — the only other re-trigger.

**`GET /api/audit?page=abc` no longer 500s.** `parseInt` produced `NaN`, and `?page=0`/`-1` a negative `skip`; both reached Prisma and threw an unhandled validation error. Clamped to a sane page, the same treatment the amount filters already gave junk input.

**The company filter can now select the companies the chart shows.** The "by company" panel aggregates every invoice including deactivated companies, while the dropdown was fed by `/api/companies` without `includeInactive` — so a user could see a number they had no way to drill into.

**Two already-diverged duplications collapsed.** `MIME_MAP` was byte-identical in three API routes and had drifted (the OCR route defaulted to `application/pdf`, the file routes to `application/octet-stream`); it now lives as `mimeTypeFor()` in `fileService.ts`, which already owned the extension logic. And `KPICard` had its own Rupiah abbreviator using `toFixed`, so the KPI strip rendered **"Rp 2.5M"** while the chart axes directly below rendered **"Rp 2,5M"** for the same amount — in id-ID a dot is the *thousands* separator, so the strip's version read as a different number entirely. It now calls `formatAxisIDR`. The existing KPICard test had encoded the wrong output and was updated.

**Data touched:** `invoices.file_path`/`file_type` set to NULL when the matching primary document is deleted (previously left dangling). No other data or schema changes in this batch.

**Deliberately not changed:** the notification bell still fetches up to 50 full rows every 60s to render a badge count — the new `notifications(user_id, is_read)` index removes the scan cost, and a dedicated count endpoint would change the API contract for a cosmetic payload saving. `GET /api/invoices` still has no pagination; dropping the `items` include (batch 1) removed the bulk of it, but real pagination needs the list UI changed too. `companyId` remains client-side-required only. All three are follow-ups, not regressions.

---

#### End-to-end verification of all six batches

Run against the reseeded local database (`localhost:5433/invoice_demo`, 100 invoices), deliberately weighted toward **negative paths** — every check below asserts something the old code allowed now fails. Constraint probes run inside transactions that always roll back; the two boundary invoices are created and deleted. Confirmed afterwards: 100 invoices, 0 leftover rows.

**22 checks, 22 passed.**

*Writes the database now refuses:* `due_date` before `invoice_date` (the originally reported bug) → `invoices_due_date_after_invoice_date`; negative `total_amount` and negative `paid_amount` → `invoices_amounts_non_negative`; negative line-item total → `invoice_items_total_non_negative`. *Still accepted:* due > invoice, due = invoice, a null due date, and a genuine zero tax amount.

*The due-day boundary, constructed rather than hoped for* — the seed happens to contain no invoice due exactly today, which would have made the check vacuous. Adding one due **today** and one due **yesterday** moved the Overdue KPI from 22 to **23**, not 24: the due-today invoice is not overdue. `isOverdue()` drew the same line, the due-today amount landed in "Belum jatuh tempo" (+Rp 7.000.000) rather than an overdue bucket, and the reminder cron picked it up in its **due-soon** window — where it used to fall straight through to the "sudah melewati jatuh tempo" email on its own due date.

*Numbers that used to contradict each other on one screen:* aging buckets now sum to Total Payable exactly (Rp 11.917.100.000 = Rp 11.917.100.000 — previously impossible, with an unbounded first bucket and null-due-date invoices in no bucket at all); the aging panel's overdue total matches the Overdue KPI (Rp 3.790.350.000 / 22 invoices, against 22 actual); and all 22 rows the dashboard calls overdue are also tagged overdue by the list/detail predicate.

*The PAID-filter contradiction:* filtering the dashboard to `status=PAID` now reports 0 overdue and Rp 0 payable. An invalid `?status=paid` is ignored instead of reaching the driver as a 500.

*Tenant isolation:* an unlinked VENDOR cannot produce an unscoped filter (it throws rather than silently returning every vendor's data); a linked VENDOR is scoped to its own `vendorId`.

*Drafts:* a draft carrying a Rp 999.000.000 total and a month-old due date changed neither Total Payable nor the invoice count, and generated no overdue reminder.

*Money parsing:* `'1.500.000'` → 1500000 (not 1.5), `'12.500.000'` → 12500000, `'N/A'` → null (not NaN), `'0'` → 0 (not null).

**Suite:** `tsc --noEmit` clean, `eslint` clean, **93/93 unit tests** (37 added across the six batches).

### 2026-09-07 — Review remediation 5/5: payment lifecycle and the status graph

All in `PATCH /api/invoices/[id]`, whose payment block had five ways to produce a record that contradicted itself.

**Auto-rejecting a duplicate no longer bypasses the transition graph.** The duplicate check wrote `status: 'REJECTED'` directly into the update, while the graph guard above it only ran when the *caller* supplied a status — which it doesn't when only `invoiceNumber` is patched. So PATCHing the invoice number of an already-**PAID** invoice into a collision forced it to REJECTED, a transition PAID does not have (its only edge is CLOSED), and left `paidDate`/`paidAmount`/`paidById` sitting on a rejected row while the vendor was notified their paid invoice had been rejected. The auto-rejection is now validated like any other transition and returns 409 when it isn't legal.

**`PAID → PAID` no longer rewrites who paid and when.** `isValidStatusTransition` returns true for `from === to`, and the payment block keyed off `filtered.status === 'PAID'` — so re-sending the same status re-ran it: `paidDate` reset to today, `paidAmount` re-defaulted to the full total, and `paidById` reassigned to whoever sent the second request. The block now keys off `isBecomingPaid` (`status === 'PAID' && current.status !== 'PAID'`).

**Payment records are correctable, and cleared when they stop applying.** `paidDate`/`paidAmount` were only ever written *inside* the PAID transition, so a PATCH carrying them alone returned 200 having persisted nothing — while still writing an audit row claiming those fields had changed. They can now be written outside the transition. In the other direction, an ADMIN moving an invoice off PAID (ADMIN bypasses the graph, which is how a mistaken PAID gets corrected) now clears all three fields; previously the invoice kept rendering its Payment panel — the detail page shows it whenever `paidDate` is truthy — and `geminiChat`'s unfiltered `sumPaidAmount` kept counting money no longer considered paid.

**Partial payments are refused.** `paidAmount` was validated only as `nonnegative()`, with the `> 0` check living in the client. Since PAID is excluded from every payable KPI, marking a Rp 100jt invoice paid for Rp 40jt silently dropped Rp 60jt out of Total Payable, Overdue and aging, and nothing anywhere computed an outstanding balance. The server now requires `paidAmount` to equal `totalAmount` (±1 rupiah) and returns 400 with both figures; the detail page checks the same rule first so the user gets an explanation rather than a bare 400. **Decided with the maintainer** over the two alternatives (keep partial payments open and count the remainder; treat them as settled and surface an `outstanding` column).

**Vendors can no longer edit verified invoices.** `VENDOR_EDITABLE_STATUSES` — RECEIVED, REGISTERED, DOC_INCOMPLETE, RETURNED_TO_VENDOR, WAITING_TAX_DOCUMENT — replaces the old "not CLOSED/REJECTED" rule, which left a vendor able to rewrite `invoiceNumber`, `totalAmount` and `dueDate` on invoices in FINANCE_VERIFICATION, READY_FOR_PAYMENT, PAYMENT_SCHEDULED, and even PAID, so the approved amount and the stored one could diverge with only an `invoice.updated` audit row as trace. The cutoff is "the ball is still in the vendor's court". **Decided with the maintainer** over a looser cutoff (up to READY_FOR_PAYMENT) and a stricter one (no vendor edits at all).

**GA can no longer edit settled invoices.** `allowedFields`' GA fallback branch never consulted the `editable` (non-terminal) check that gates the VENDOR branch, so GA roles could still write `deliveredDate`/`picId`/`sendDate` on CLOSED and REJECTED invoices. Both branches are gated now.

**`currency` is writable through PATCH.** `applyUpdate` had no `currency` key at all — even for ADMIN, whose allow-list is the whole payload — so a bad value written by the old unvalidated OCR path could never be corrected through the API.

**Data touched:** `invoices.paid_date`, `paid_amount`, `paid_by` — now written on the transition into PAID (as before), on a correcting PATCH that carries them (new), and set to NULL when status leaves PAID (new). `invoices.currency` now writable via PATCH. `paid_date` defaults to `jakartaDayStart()` rather than `Date.now()`, and the detail page's date input defaults to the Jakarta calendar date instead of the UTC one — before 07:00 WIB it was pre-filling, and recording, the previous day.

**Verified:** `tsc --noEmit` clean, `eslint` clean, **93/93 tests** (4 new). `canVendorEdit` was extracted into `invoiceStatus.ts` specifically so the rule is testable without exporting non-handler symbols from a route file: the tests assert every vendor-court status allows edits and that all ten verification/payment/terminal statuses refuse them. Two set-composition tests guard the split that batch 2 introduced — main-flow ∪ exception equals the full status list with no overlap, and open ∪ settled likewise, with `PAYMENT_HOLD` confirmed still open.

### 2026-09-07 — Review remediation 4/5: database constraints, indexes, and the draft flag

Migration `20260907000000_invoice_integrity_constraints`, hand-written because `prisma migrate dev` needs a shadow database the local container refuses to create (template1 collation mismatch) and because CHECK constraints have no schema-diff equivalent.

**⚠️ `prisma.config.ts` points migrate/seed at PRODUCTION.** Found while running this migration: [prisma.config.ts:17](prisma.config.ts#L17) resolves `DIRECT_URL ?? DATABASE_URL`, and `.env.local:19` sets `DIRECT_URL` to the live Supabase pooler. `DATABASE_URL` on line 1 is the local container, so the app talks to local while **every `prisma migrate` / `db:seed` talks to production**. The first `migrate dev` attempt reported the Supabase host and offered to reset its schema. Nothing was applied. Every command in this batch was run with both variables explicitly overridden to `localhost:5433` and guarded by a shell check that aborts if the URL isn't local. **This is a live footgun and should be fixed at the source** — either drop `DIRECT_URL` from `.env.local` or make `prisma.config.ts` prefer `DATABASE_URL`.

**`due_date >= invoice_date` is now enforced at three layers**, having previously existed at none: a zod refine on both invoice schemas (payloads carrying both dates), a route-level check in PATCH against the stored value (when only one is sent — the shape the schema can't see), and the `invoices_due_date_after_invoice_date` CHECK constraint for every other write path including OCR, the seed, and anything added later. The migration deliberately does **not** repair violating rows: it fails loudly instead, because silently rewriting wrong financial data hides the problem. The comment in the migration says how to inspect them.

**The 9 impossible rows came from `prisma/seed.ts` itself.** Its due-date targets were measured from `now` while `invoiceDate` was `createdAt`, so a recently-created invoice could be given a due date weeks before its own invoice date (gaps ran 2–47 days). Now clamped to `max(target, createdAt + 1 day)`. The generator also produced *timestamps* rather than dates — 80 of 102 rows carried the seed run's exact time-of-day — so all date-valued columns now go through a `dayOnly()` helper. **Decided with the maintainer**: fix the seed and reseed, rather than repairing the rows in the migration.

**Existing rows normalised to calendar dates.** `invoice_date`, `due_date`, `send_date`, `delivered_date`, `paid_date` are `date_trunc('day', …)`-ed. These columns hold dates, not instants: a due date stored as `2026-09-07T18:44` was excluded by a `due_date <= '2026-09-07'` range filter, so the invoice vanished from the dashboard and the export on its own due day while the unfiltered list still showed it. `isoDateString` now normalises to `YYYY-MM-DD` on the way in, so new writes can't reintroduce it, and rejects years outside 2000…now+10 (OCR misreads like `'0202'`/`'2205'` park an invoice in the wrong aging bucket permanently).

**Non-negative amounts** are enforced by `invoices_amounts_non_negative` and `invoice_items_total_non_negative`. Both columns are `Decimal(15,2)` with no lower bound, so the old unvalidated OCR path could store `-500000` and quietly subtract from every dashboard `SUM`.

**`invoices.is_draft`** (new column, default false). The upload wizard must create the row before OCR runs — the file attaches to its id — so abandoning the wizard left a fully live `RECEIVED` invoice: counted in every KPI, listed like a real invoice, and emailed about daily by the cron once OCR had written a past due date onto it. The wizard now POSTs `isDraft: true` and the review step's PATCH sets it false. Drafts are excluded in `buildDashboardFilter` (which covers the dashboard, the export **and** the invoice list, since batch 1 consolidated them) and in both reminder queries; they stay reachable by id, which is where the wizard navigates. The migration back-fills `is_draft = true` for existing `DRAFT-%` rows. **Decided with the maintainer** over the two alternatives (restructure the wizard to defer creation; filter on the `DRAFT-` name prefix).

**Nine indexes added.** The schema declared no `@@index` at all and Postgres does not index foreign keys automatically, so every dashboard aggregate, list filter, notification poll and cron sweep was a sequential scan: `invoices(status, due_date)`, `invoices(vendor_id)`, `invoices(company_id)`, `invoices(created_at)`, `invoice_stage_history(invoice_id, changed_at)`, `audit_logs(entity_type, entity_id)`, `audit_logs(created_at)`, `notifications(user_id, is_read)`, `notifications(type, created_at)`.

**Also:** `invoiceNumber`/`poNumber` are `.trim()`ed — `' INV-001 '` and `'INV-001'` are the same document, but both the case-insensitive duplicate check and the `lower()` unique index treated the padded string as distinct, so two live invoices could exist for one document. And `totalAmount = subtotal + taxAmount` (±1) is enforced on **create only**; PATCH deliberately doesn't block it, since a user correcting one misread field mid-review would otherwise be locked out until they fixed every other one.

**Data touched:** `invoices` gains `is_draft` (boolean, default false; written by POST `/api/invoices` from `createInvoiceSchema.isDraft`, and by PATCH from `updateInvoiceSchema.isDraft`). All five date columns rewritten in place to date-only. The local demo database was **reset and reseeded with explicit consent** — 100 invoices regenerated.

**Verified against the reseeded database:** 100 invoices, **0 impossible date pairs** (was 9), **0 dates carrying a time component** (was 101), 0 drafts, and all three CHECK constraints plus all nine indexes confirmed present via `pg_constraint`/`pg_indexes`. The constraint was live *during* seeding, so a still-buggy generator would have failed the insert rather than passing silently. `tsc --noEmit` clean, `eslint` clean, **89/89 tests** (9 new): due-before-invoice rejected on create and update, equal dates accepted, either-date-missing passes, a `+07:00` timestamp normalised to `2026-09-07`, years `0202`/`2205` rejected, padded invoice numbers trimmed, and the subtotal+tax identity enforced on create.

### 2026-09-07 — Review remediation 3/5: money parsing and the OCR write path

**Typing an ordinary Indonesian amount stored one millionth of it.** The OCR review screen parsed edited amounts with `parseFloat(raw.replace(/[^0-9.]/g, ''))`. That regex *keeps* the dots, and in id-ID a dot groups thousands — so correcting a total to `1.500.000` made `parseFloat` stop at the second dot and persist **1.5**. Zod only checked `min(0)`, so it sailed through and the invoice entered the payment workflow at Rp 1,50. The same expression handled `tax_amount` and `subtotal`. New `parseAmountID()` in `src/lib/format.ts` reads the Indonesian convention (`.` groups, `,` decimals) and still handles plain and US-grouped input; the wizard now uses it. The wizard's `|| null` became `?? null` at the same time — `parseFloat('0') || null` turned a genuine zero (a tax-exempt invoice) into NULL "unknown", which the Excel export then rendered as an empty cell.

**The OCR route no longer writes unvalidated model output to the database.** It called `prisma.invoice.update` directly with `parseFloat(...)` and `new Date(model_string)`, bypassing every zod rule the PATCH path enforces. Four ways that produced impossible data:

- `'N/A'` → `parseFloat` → `NaN` → the update **throws**, the route's `catch` turns it into one SSE `error`, and *every* extracted field is silently discarded;
- `'12.500.000'` → `12.5`, and `'-500000'` stored negative (there are no CHECK constraints), poisoning every dashboard `_sum`;
- `currency` took whatever string the model produced (`'US$'`, `'Rupiah'`) — and since PATCH's `applyUpdate` has no `currency` branch, a bad value could never be corrected through the API;
- a due date earlier than the invoice date was written unchallenged, and a *missed* extraction NULLed a due date that was already correct.

New `buildOcrUpdate(extracted, current)` in `geminiExtraction.ts` is a pure function that validates the extraction into a Prisma update: amounts via `parseAmountID` with negatives rejected, currency constrained to `/^[A-Z]{3}$/` and upper-cased, dates required to be parseable **and** plausible (year 2000 → now+10, which catches `'0202'`/`'2205'` misreads that otherwise park an invoice in the wrong aging bucket forever), and **`dueDate >= invoiceDate` enforced against the stored invoice date when the model doesn't return one**. A field that fails validation keeps its current value instead of being nulled, and its key is reported in `rejected`, emitted as a new SSE `warning` event so the UI can tell the user which fields need typing by hand.

**Data touched:** `invoices.invoice_date`, `due_date`, `currency`, `subtotal`, `tax_amount`, `total_amount`, `ocr_confidence` — same columns as before, but now only written when the extracted value validates (previously written unconditionally, including nulls). No schema change. Also replaced the wizard's hand-rolled `Rp {toLocaleString('id-ID')}` on line-item totals with `formatIDR`.

**Verified:** `tsc --noEmit` clean, **80/80 tests** (19 new). The parser suite covers `1.500.000` → 1500000, `1.500.000,50` → 1500000.5, `Rp 1.500.000`, US-grouped `1,500,000`, a genuine `0` distinguished from absent, and `N/A`/`-`/prose → null. The `buildOcrUpdate` suite is deliberately mostly negative paths: due-before-invoice rejected (both when the model supplies the invoice date and when it's read from the stored row), equal dates accepted, implausible years rejected, an existing due date left alone when extraction returns nothing, negatives rejected, `'N/A'` rejected **while the other fields still survive** (the old failure discarded all of them), a genuine zero kept, and `'US$'`/`'Rupiah'` rejected while `'usd'` normalises to `USD`.

### 2026-09-07 — Review remediation 2/5: one definition of "overdue" and "open"

The dashboard could report overdue invoices while the invoice list showed none — the case that started this review. Root cause was not one bug but **four different definitions of "overdue" and two of "open"**, each written out separately and already drifted apart.

**Due dates are calendar dates, so overdue is now a calendar-day comparison in Jakarta.** `invoices.due_date` stores UTC midnight of a date, but every check compared it against `new Date()` — an instant. An invoice due today was therefore "overdue" from 00:00 UTC = **07:00 WIB on its own due day**: the KPI counted it, `format.ts` painted the list row red, and the cron emailed "sudah melewati jatuh tempo", all while it was still due. New `jakartaDayStart(now?)` in `src/lib/format.ts` returns the UTC-midnight instant of the current Jakarta calendar date (WIB is UTC+7 with no DST), and `dashboardStats`, `reminderScheduler`, `geminiChat` and `isOverdue()` all measure against it. The reminder scheduler's due-soon window had the mirror-image bug — `gte: now` excluded an invoice due today, so it skipped due-soon entirely and went straight to the overdue email on its due date; it now starts at `todayStart` and includes it.

**`NON_OPEN_STATUSES` had two definitions.** A private `Set` in `format.ts` drove the list's overdue tag; an exported array in `dashboardStats.ts` drove the KPIs, reminders and chatbot. Both now come from `src/lib/invoiceStatus.ts` (the client-safe module — `format.ts` can't import `dashboardStats.ts` without pulling in Prisma, which is why the copy existed). `invoiceStatus.ts` also gained `MAIN_FLOW_STATUSES`/`EXCEPTION_STATUSES` (previously re-declared inside `StatusFlowChart.tsx`, so a new status would get a badge and a label but silently vanish from the chart), `OPEN_STATUSES`, and `VENDOR_EDITABLE_STATUSES` for batch 5.

**KPIs no longer drop the settled-status exclusion when a status filter is applied.** `openFilter` was `filter.status ? filter : {...}` — so filtering the dashboard to PAID made the Overdue card count already-paid invoices and Total Payable sum their amounts, while the invoice list filtered the same way showed zero overdue rows (and the Excel export baked the contradiction into a shareable file). The exclusion is now unconditional and composes with the caller's status filter. **Decided with the maintainer** rather than assumed: the alternative was to keep the filtered behaviour and relabel the cards.

**Aging buckets now partition the open set exactly.** The first bucket was `dueDate >= now-30d` with no upper bound, so invoices that aren't due yet — even ones due next year — sat in "0–30 hari"; invoices with a null due date matched no bucket at all and disappeared from the panel while still counting toward Total Payable, so the panel could never reconcile with the KPI above it. Buckets are now `Belum jatuh tempo | 0–30 | 31–60 | 61–90 | > 90 | Tanpa jatuh tempo`, and every open invoice lands in exactly one. Each bucket carries an `overdue: boolean` from the server; `AgingList` sums that flag instead of `data.slice(1)`, which had counted only invoices more than 30 days late — an invoice 10 days overdue showed "Overdue: 1" on the card and "Rp 0 · 0%" in the panel directly below. (The positional `isOldest` check also had to move to the flag: the new no-due-date bucket sits last and would otherwise have inherited the "tertua" label.)

**Two more counts that contradicted the same page.** `StatusFlowChart`'s "{count} not finished" summed only the 7 open main-flow statuses, excluding all 8 exception states that the Open Invoices KPI includes — it now filters the breakdown by `NON_OPEN_STATUSES`, the same rule the KPI uses. And the monthly "accepted" series counted only current-status `PAID`, so the graph-sanctioned `PAID → CLOSED` transition retroactively removed invoices from the line and the chart shrank as work was completed; it now counts `PAID || CLOSED`, matching the definition `prisma/seed.ts` has always used.

**Reminder fan-out is now vendor-scoped.** `VENDOR` is a selectable recipient role, but `checkDueDates` queries invoices across all vendors and fanned out unscoped — every vendor user received in-app notifications and a digest email listing **other vendors' invoice numbers and names**. Recipients now carry `role`/`vendorId`; `scopedFor()` filters per recipient, and `sendDigest()` sends one digest to internal recipients (plus configured extra addresses) and a separate per-vendor digest to each VENDOR recipient containing only their own rows.

**Reminder dedupe was a rolling 24h window, not a day.** `alreadyNotifiedToday` matched `createdAt >= now - 24h`, so a cron firing even a minute earlier than the previous day's run found yesterday's row still inside the window and silently skipped that day's reminders for every still-overdue invoice. It now compares against `todayStart`. The same rewrite fixed an N+1: it was one `findFirst` per invoice-per-recipient, sequentially awaited inside nested loops (500 overdue × 5 recipients = 2,500 round-trips per run) — now one `findMany` per reminder type into a `Set` of `userId:invoiceId` keys.

**AI chat: `overdueOnly` no longer clobbers an explicit status.** `where.status = args.status` was overwritten by `where.status = { notIn: NON_OPEN_STATUSES }`, so "how many PAYMENT_HOLD invoices are overdue?" returned the count and sum of *every* open overdue invoice and the assistant reported it as the answer.

**Data touched:** none — no schema or data changes. All edits are query predicates and display logic. `GET /api/dashboard`'s `agingBuckets` response field gains `overdue: boolean` and grows from 4 to 6 rows (source: `prisma.invoice.aggregate(_sum.total_amount)` per due-date range, all filtered by `openFilter`). New i18n keys `dashboard.agingNotDue` / `dashboard.agingNoDueDate` in both dictionaries; `agingSubtitle` corrected in both — it claimed "past 30 days counts as overdue", which was the bug, not the rule.

**Verified:** `tsc --noEmit` clean, `eslint` clean, **61/61 tests** (5 new, all on the boundary that caused the original report): `jakartaDayStart` rolls at 00:00 WIB rather than 00:00 UTC in both directions, an invoice is NOT overdue at 09:00 WIB *or* 23:59 WIB on its due day, it becomes overdue at 00:01 WIB the next day, and a settled invoice stays not-overdue three weeks past its due date.

### 2026-09-07 — Review remediation 1/5: tenant isolation, cron guard, client-side credentials

First of five batches from a whole-repo review (10 parallel finders → 8 adversarial verifiers, 32 confirmed findings). This batch is the security/tenant-isolation cluster.

**`GET /api/invoices/[id]/ocr` had no ownership check at all — the one route of its family that *writes*.** It ran `requireAuth()` then `findUnique({ where: { id } })`, while its read-only siblings (`…/file`, `…/upload`) each hand-rolled a `vendorId` comparison. Any signed-in user could re-OCR any other vendor's invoice: the SSE stream returned that vendor's extracted fields, and the route then overwrote `invoiceDate`, `dueDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount` and replaced every `invoice_items` row — on a `CLOSED` invoice too, since it had no status guard — with no `audit_logs` entry. The three hand-rolled copies are now one `requireInvoiceAccess(invoiceId, allowedRoles?)` in `src/lib/auth/helpers.ts`, used by the OCR, file and upload routes. It returns 403 to a VENDOR for a non-existent invoice as well as an unowned one, so invoice ids can't be probed for existence. The OCR route additionally refuses `TERMINAL_STATUSES` with 409 — `PATCH` already refuses to edit settled invoices, and re-running OCR was the back door around it.

**An unlinked VENDOR (role VENDOR, `vendorId` null) got an unscoped dashboard and a full cross-vendor Excel export.** `buildDashboardFilter` wrote `where.vendorId = session.user.vendorId ?? undefined`, and Prisma drops `undefined` keys — so the vendor scoping vanished, while `GET /api/invoices` rejected the identical session with 403. The state isn't reachable through the app's own APIs (`createUserSchema` refines it, `PATCH /api/users/[id]` rejects it), but `users.vendor_id` is `ON DELETE SET NULL`, so deleting a vendor row directly in the DB produces it. Now `unlinkedVendorResponse()` (one definition, in `auth/helpers.ts`) guards `/api/dashboard`, `/api/dashboard/export` and `/api/invoices`, and `buildDashboardFilter` **throws** instead of falling back to `undefined` if a future caller forgets — it fails closed rather than silently unscoped.

**`GET /api/cron/reminders` accepted `Authorization: Bearer undefined` when `CRON_SECRET` was unset**, because the guard interpolated the env var straight into the comparison string. `middleware.ts` deliberately exempts `/api/cron/` from session auth, so this was the only thing standing in front of it, and the email path has no dedupe (`alreadyNotifiedToday` guards only in-app notifications) — repeated calls re-send the whole digest. The secret's existence is now checked separately and a missing one returns 503.

**Live admin password removed from the client bundle.** The uncommitted dev-bypass block in `src/app/(auth)/login/page.tsx` carried `dJLrXlooGsBsGcNJ` — the same string `prisma/seed.ts:71` uses as the bootstrap admin fallback — inside a `'use client'` component. The `NODE_ENV === 'development'` guard wrapped only the JSX, not the `const`, so removal from a production bundle relied on minifier dead-code elimination; the dev bundle shipped it outright. The buttons now prefill the **email only** and the password is typed. `seed-demo-users.ts` and `check-demo-users.ts` (untracked, both holding plaintext passwords, both self-described as delete-after-demo) are now gitignored so `git add .` can't sweep them in.

**Two consistency fixes that fell out of the same files:** `GET /api/invoices` now builds its `where` with `buildDashboardFilter` instead of a near-copy that silently ignored `companyId` — the same query string scoped the dashboard but not the list. And the `?status=` param is validated against `INVOICE_STATUSES` rather than force-cast into Prisma's enum filter, so `?status=paid` is ignored (matching how the amount filters already treat junk input) instead of reaching the driver and returning a 500.

**Data touched:** no schema or data changes in this batch — all edits are request-path guards. `GET /api/invoices` stopped including `items` (the list page never rendered them; it was serialising the whole `invoice_items` table on every filter change).

**Not done here, deliberately:** the admin password itself still needs rotating — it has been in tracked git history at `prisma/seed.ts:71` since long before this change, so removing the copy above does not un-expose it. That's a deployment action, left to the maintainer. The two demo scripts are gitignored, not deleted.

**Verified:** `tsc --noEmit` clean, 56/56 existing tests pass. Behavioural verification against the database is in batch 5/5's entry, which covers all five batches together.

### 2026-09-03 — Rebrand to SIP (Smart Invoice & Payment)

**What:** App renamed **VISTA → SIP**, tagline "Vendor Invoice Submission & Tracking Assistant" → **"Smart Invoice & Payment"**. Changed in `src/app/layout.tsx` (page metadata/browser tab), both i18n dictionaries (`nav.brand`/`nav.brandTagline`, which drive the sidebar), `README.md`, and `docs/INDEX.md`.

**Deliberately unchanged, per the user's decision:**
- `prisma/seed.ts`'s bootstrap admin stays `admin@vista.id` — it's a login credential, and changing it would invalidate the existing admin on the next reseed. Still overridable via `ADMIN_EMAIL`.
- The email templates in `src/lib/services/email.ts` keep "Invoice Tracking" in their header/footer.
- `docs/CHANGELOG.md`'s earlier entries keep saying VISTA — they're a historical record of what happened on 2026-09-02, not current-state documentation.

**Also corrected while renaming** (the README's feature list sat directly under the title being rebranded and described a product that no longer exists): it advertised a "Multi-step Approval Workflow — Finance reviews first, then escalates to Manager", but `ApprovalWorkflow` was dropped back in migration `20260715171000_invoice_workflow_overhaul` and the `FINANCE`/`MANAGER` roles it names were deleted in `20260726171012_simplify_roles`. The bullets now describe what SIP actually does: the 17-stage workflow, PIC/SLA tracking, duplicate detection, and multi-document classification. The "approval alerts"/"approve, reject" phrasing in the notification and audit-log bullets was corrected for the same reason.

**Verified in the browser:** sidebar renders "SIP / Smart Invoice & Payment", browser tab title is `SIP`, no "VISTA" string remains anywhere on the rendered page, and the toggle confirms both language dictionaries carry the new name.

### 2026-09-03 — Fix: OCR wrote invoiceNumber past the duplicate check

**Found by running the app in a browser**, not by tests — `tsc`, lint and the suite were all green with this bug present.

**What went wrong.** `GET /api/invoices/[id]/ocr` persisted the extracted `invoice_number` straight onto the invoice. That field is the one the duplicate check in `PATCH /api/invoices/[id]` keys on, and `PATCH` is the only place that check runs — so OCR was writing it through a path with no check at all. Two observed failures:

1. **False-positive duplicate — the exact case the feature was asked to prevent.** Reaching the wizard's review step runs OCR, which parked a real invoice number on a live `RECEIVED` invoice. Abandoning the wizard there (closing the tab) left that number occupied, so re-uploading *the same document* was auto-rejected as a duplicate — of the user's own abandoned draft.
2. **Silent loss of extracted data.** With the number already taken, OCR's write tripped the partial unique index from `20260902000000_invoice_duplicate_guard`. The route's `catch` turned that into a generic SSE `error`, discarding every other extracted field and leaking a raw Prisma constraint message.

**Fix.** OCR no longer writes `invoiceNumber` — `PATCH` is now its single writer, which is what the duplicate check already assumed. The extracted number still reaches the UI through the existing `field` SSE event and is submitted normally, so nothing changes for the user except that it now gets checked. An abandoned session keeps its `DRAFT-<timestamp>` placeholder instead of burning a real number.

**Verified in the browser, both directions** (the failure mode and the feature it protects): abandoning after OCR now leaves 0 invoices holding the extracted number and the subsequent legitimate submission succeeds; submitting the same number twice still auto-rejects the second, with the first left `RECEIVED` and the duplicates `REJECTED`.

**Why tests missed it:** the bug lived in the interaction between two routes and a DB constraint, reachable only by actually walking the wizard. The unit suite covers pure functions, and no route-level or end-to-end test harness exists in this repo.

### 2026-09-03 — Stage lead-time + by-company dashboard widgets, extra filters, stage notification

Four independent items (Item D of the approved plan), plus one blocking bug they surfaced.

**Dashboard: average lead time per PIC stage.** The per-invoice SLA timeline already existed on the detail page; what was missing was the aggregate. `foldStageLeadTimes()` folds `invoice_stage_history` rows into `{stage, avgDays, completed, currentCount}`. A stage's duration is the gap to the **next** history row of the same invoice; the last row per invoice is still open, so it counts toward `currentCount` (invoices sitting there now) but **not** the average — averaging in-progress time would understate how long a stage actually takes. Rows are ordered `(invoiceId, changedAt)`, which is also what keeps every gap non-negative if a stage was ever recorded out of workflow order. Rendered by a new `StageLeadTimeList`, bars scaled against the slowest stage (there are no stored SLA targets, so stage-vs-stage is the only honest comparison) with amber marking the bottleneck. `avgDays: null` renders "—", not 0.

**Dashboard: invoices by company.** `groupBy(['companyId'])` + a second query for names (Prisma `groupBy` can't include a relation), sorted by value. Invoices with no company are kept as an "unassigned" row rather than dropped — a missing bill-to is worth seeing. New `CompanyList` deliberately uses one neutral colour rather than `AGING_COLORS`: company is a nominal dimension, and a healthy→danger ramp would imply a ranking that isn't there.

**Filters: PO number, PIC, amount range.** Added to `GET /api/invoices` and the dashboard's builder through one shared `applyInvoiceSearchFilters()`, so the two surfaces can't drift. Non-numeric amounts are ignored rather than becoming `NaN` (which Prisma rejects with an opaque driver error). The PIC filter is hidden from `VENDOR` — PIC is internal-only and already scrubbed from vendor-facing responses.

**Notification on PIC stage change.** `PATCH …/stage` now fires a new `stage_assigned` trigger, inlined in that route in the same shape as `notifyStatusChanged` — two call sites with genuinely different recipient rules don't justify extracting a shared helper, and merging them would mean parameterising away the only interesting difference. Recipients are the configured **role group, never the vendor**: `pic_stage` is internal routing, so telling a vendor their invoice reached SSU leaks process detail they can't act on. Only a real change notifies — re-selecting the current stage still appends history (an explicit "still here" record) but doesn't re-ping. The route's audit metadata also improved from `{ stage }` to `{ from, to }`.

**The blocking bug this surfaced:** `prisma/seed.ts` wiped `reminder_settings` and never recreated it, and every trigger no-ops when its row is missing — so `due_soon`, `overdue`, and `status_changed` were **already dead on any fresh database**, and `stage_assigned` would have shipped dead too. All 6 rows are now seeded (in-app on, email off since delivery needs `RESEND_API_KEY`; the two never-fired legacy types seeded `isActive: false` so the admin page doesn't present them as working). `docs/DATABASE.md` had claimed these rows existed since before the 2026-09-01 pass — that claim is now true rather than aspirational.

**Also fixed in passing:** the `status_changed` admin-page description still listed the old 4-value status names, user-visible and wrong since the status overhaul.

**Verification.** `tsc`, `lint`, **56/56 tests** (6 new on `foldStageLeadTimes`: gap measurement, last-row-is-open, the invoice-boundary guard that would otherwise read one invoice's last stage into the next invoice's first, cross-invoice averaging, all-stages-always-returned, and the backwards-correction case). Against the reseeded database both aggregates were checked for internal consistency — `currentCount` sums to exactly the invoice count (100/100, i.e. every invoice is held at exactly one stage) and `companyBreakdown` counts sum to the same 100 and come back correctly sorted. Confirmed no negative stage gaps exist in the data via a SQL `LEAD()` cross-check, and that the numbers were byte-identical before and after extracting `foldStageLeadTimes` out of the query function.

### 2026-09-03 — Multi-file attachments per invoice + AI document-type classification

**What.** An invoice submission carries more than the invoice: a tax invoice (faktur pajak), a BAST, supporting files. The schema could hold exactly one — `invoices.file_path`/`file_type`, with a storage key literally `{invoiceId}.{ext}`, silently overwritten on re-upload. New `invoice_documents` table (migration `20260903000000_invoice_documents`) holds one row per file; storage keys become `{invoiceId}/{documentId}.{ext}`.

**Expand/contract, deliberately.** `invoices.file_path`/`file_type` are kept and still written for the primary document, and the migration backfills one `INVOICE`-typed row per invoice that already had a file — **reusing the old flat storage key**, so no stored blob had to move. `getFileBuffer()` reads the stored path verbatim rather than re-deriving it, which is what lets both layouts coexist. Dropping the legacy columns is a later migration once every read path has moved over.

**Classification, in three layers** (the requirement was explicit that misclassification is unacceptable):
1. `document_type` + `classification_confidence` added to the existing OCR extraction schema, so the primary document is classified **for free** in a call that was already happening. Supporting documents use a new `classifyDocument()` with a minimal 2-field schema — running the full invoice-extraction schema against a BAST would spend tokens extracting fields that don't exist. One shared prompt describes all four types, including how a Faktur Pajak (NSFP, DJP references) differs from a commercial invoice.
2. `normalizeClassification()` forces `OTHER` below 70% confidence or for any value outside the enum, and clamps out-of-range scores. A wrong specific label is worse than an honest "Other" — the prompt says the same.
3. **The manual override is the actual guarantee**, not layers 1–2. Every document at any confidence gets a type dropdown, in both the wizard and the detail page (`PATCH …/documents/[documentId]`). Setting it by hand nulls `classification_confidence` so a human decision stops rendering as an AI guess.

Classification errors are caught and fall back to `OTHER` — a Gemini outage or missing API key must not lose a user's file.

**Routes:** `POST …/upload` now creates an `InvoiceDocument` and returns it (previously returned the invoice); takes an optional `primary=true` marking the OCR-driving file, which skips the redundant classify call and updates the legacy columns. New `PATCH`/`DELETE …/documents/[documentId]` (reclassify / remove) and `GET …/documents/[documentId]/file`. The per-document file route scopes its lookup by **both** invoice id and document id, so a document id from another invoice can't be read by pairing it with an invoice the caller may see. Delete removes the row but deliberately leaves the storage object — an accidental click stays recoverable, and every read path goes through the row.

**UI:** the wizard's review step gained a supporting-documents list (add / retype / remove, with the AI confidence shown when present); the detail page's `DocumentViewer` became tabbed. `DocumentPreview` was split out so each tab owns its page-number state — one shared counter meant opening tab 2 on tab 1's page.

**Verification.** `tsc`, `lint`, and **50/50 tests** (5 new, covering `normalizeClassification` — the one genuinely pure piece of this work, and the one worth pinning: the confidence floor, unknown-enum rejection, garbage/NaN input, and clamping). Behavioral checks against local Postgres confirmed two files coexist under one invoice with distinct paths and both read back byte-identical. The migration's backfill reported **0 rows on this database, which is correct rather than broken** — no seeded invoice carries a file; the SQL was separately exercised inside a transaction against a row given a `file_path`, produced the expected `INVOICE`-typed row with null confidence, and was rolled back.

**Why:** Item C of the approved 2026-09-01 plan.

### 2026-09-02 — Liquid Glass dark-first redesign, rebrand to "VISTA"

**What:** Full visual reskin of `feat/prod-adjustment`, independent of and unrelated to the "Architectural Glass" redesign already shipped on `feat/new-design` (2026-08-14, see `memory.md`) — these are two separate design explorations on two separate branches, not a reversion of that decision. App renamed "Invoice Intelligence" → **VISTA** ("Vendor Invoice Submission & Tracking Assistant", `src/app/layout.tsx` metadata). Dark is now the brand default (`<html class="dark">`, `useTheme()`'s initial state and no-`localStorage` fallback changed from reading `prefers-color-scheme` to a hardcoded `'dark'`); `/login` and `/change-password` are force-light instead (new `src/components/auth/AuthThemeReset.tsx` strips the `dark` class on mount and restores the stored theme on unmount, since an inline pre-paint script can't rerun on a client-side soft navigation the way it does on a hard load).

`globals.css` token set rebuilt around a "liquid glass" surface language (`.glass-panel`/`.glass-panel-strong`, `--glass-bg`/`--glass-border`/`--glass-highlight`/`--glass-shadow`, `--glow-primary`/`--glow-teal` for hover glows) plus an ambient 3-blob background + film-grain overlay mounted once at the root layout (`.liquid-bg`/`.grain-overlay`, `<html>` body). Swept through `Sidebar`, `TopBar` (icon buttons, notification popover, role chips, unread badge), the dashboard/auth layouts, and the login page (rebuilt split-panel hero, unchanged structurally from the pre-existing pattern but restyled to the new token set).

**Fixed while touching `TopBar`/`useNotificationStream`:** `markAllRead()` cleared the notification list locally even when the `PATCH /api/notifications` call failed (no `res.ok` check) — now bails out on a failed response so a network error doesn't silently show "no notifications" while the server still has them marked unread. `useNotificationStream()`'s return type changed from a bare `number` to `{ unreadCount, clearUnread }` so the bell's unread count can be cleared immediately on a successful mark-all-read instead of waiting for the next 60s poll.

**Not committed:** `DESIGN.md` (the design brief this reskin follows) — added to `.gitignore` instead, same convention the 2026-07-30 Liquid Intelligence redesign used for its own brief and reference screens (local input, not part of the tracked repo, per that earlier explicit user request).

**Why:** User-directed visual redesign, no functional/API changes. Existing `feat/new-design` branch's own redesign is a separate track and out of scope for this change.

**Verification:** 45/45 tests, `npm run lint` clean on all touched files.

### 2026-09-02 — Replace dashboard aging/status-breakdown charts with trend + flow charts

**What:** Deleted `AgingBar.tsx`/`StatusDonut.tsx`, added `MonthlyTrendChart.tsx` (area chart, `data.monthlyTrend` — total amount per month, trailing 12 months), `StatusFlowChart.tsx` (9-step main-flow pipeline strip + a separate compact chip row for the 8 exception statuses, `data.statusByMonth`/`data.statusBreakdown`), `AgingList.tsx` (row-list replacement for the old bar chart, same `agingBuckets[]` data), `ChartEmpty.tsx` (shared empty-state), and `chartShared.ts` (axis/tooltip formatters, the aging severity color ramp). This is the frontend half of the 2026-09-01 status-workflow-overhaul commit (`60635df`) that was deliberately left uncommitted then — see that commit's message: "Frontend pages... (dashboard page, StatusFlowChart) are updated on disk but intentionally left out... entangled with unrelated uncommitted redesign work from an earlier session." `dashboardStats.ts`/`i18n` dictionaries already shipped in that commit; no backend changes here, purely the deferred UI half.

`KPICard` prop API changed: dropped `icon`/`color` (each KPI was previously its own colored+iconed card) in favor of `tone?: 'default' | 'danger'` + `className` — the four KPIs now render as cells of one bordered strip (grid drawn by the page, not per-card borders), matching the redesign's flatter typographic hierarchy. `KPICard.test.tsx` updated to match (dropped the icon-crash regression test since `icon` no longer exists; added a `tone="danger"` assertion).

`GET /api/dashboard` and `GET /api/dashboard/export` both changed their invoice-list `where` clause from conditionally excluding `DRAFT` (`filter.status ? filter : { ...filter, status: { not: 'DRAFT' } }`) to always using the plain filter — this was actually a bug fix, not new behavior: `docs/API.md` already documented both routes as reflecting "no status exclusion of its own" / "unfiltered = every invoice" (written during the 2026-09-01 docs pass), the code just hadn't caught up. `docs/API.md`'s export column list updated to add **PO Number** and **PIC Stage** (both already in the code's `sheet.columns`, just missing from the doc).

**Why:** Completes the deferred frontend scope from the 2026-09-01 status-workflow overhaul; the old donut/bar charts couldn't represent the new 17-value status set legibly (a 17-slice donut is unreadable).

**Verification:** 45/45 tests, `npm run lint` clean, docs updated (`docs/API.md`).

### 2026-09-02 — PIC stage transition control, SLA timeline, and stage API

**What:** New `PATCH /api/invoices/[id]/stage` (`src/app/api/invoices/[id]/stage/route.ts`) — `ADMIN`/`GA_STAFF`/`GA_MANAGER` only, body validated by the already-existing `updateInvoiceStageSchema`. Writes `invoices.pic_stage`, appends an `invoice_stage_history` row, and an `audit_logs` row (`action: 'invoice.stage_changed'`). This endpoint was already fully documented in `docs/API.md` (from the 2026-09-01 docs pass) but the route file itself had never been committed — this commit adds the file the docs already described.

New `PICStageBadge.tsx` — read-only pill for the 5 PIC stages (`GA/BUDGET/PROC_LEGAL/SSU/TREASURY`), same visual language as `StatusBadge`. Wired into `/invoices` (list page: new "Tahap PIC"/PIC-stage column, badge + a stage-move dropdown for the 3 manager roles, `moveStage()` calling the new PATCH route) and `/invoices/[id]` (detail page: badge + a stage-change `<select>` + button for the same 3 roles, plus an SLA timeline rendering `invoice.stageHistory[]` with per-stage duration computed client-side from consecutive `changedAt` timestamps — "N days" for a closed stage, "ongoing" for the current one). Invoice list also now shows `poNumber` under the invoice number, and its status filter dropdown is generated from all `t.status` entries instead of a hardcoded 6-value list (a leftover from the pre-17-value-enum status set).

`audit/page.tsx`'s action-icon map gained `invoice.status_changed` and `invoice.stage_changed` entries — both actions already existed (the former from the 2026-09-01 overhaul, the latter from this route) but had no icon/label mapping, so they fell back to the generic default row.

**New tests:** `validations.test.ts` rewritten — it previously tested `isValidStatusTransition`/`VALID_TRANSITIONS`, which now have their own dedicated `invoiceStatus.test.ts` (added in the 2026-09-01 commit); replaced with coverage for `updateInvoiceStageSchema` (accepts all 5 stages, rejects an unknown one) and a gap-fill test for `createInvoiceSchema` (requires `poNumber`).

**Why:** Completes the deferred PIC-stage frontend scope from the 2026-09-01 status-workflow overhaul (schema/migration/API contract were already in place; this is the UI + route implementation).

**Verification:** 45/45 tests, `npm run lint` clean.

### 2026-09-02 — Localize remaining hardcoded UI strings to the i18n dictionary

**What:** Replaced hardcoded English strings with `useI18n()`/`t.*` lookups (existing dictionary keys, no new translations needed) in the four `/admin/*` pages (users, vendors, companies, reminders), the AI chat page (page title, disclaimer, suggested-prompt buttons, error toasts), and one leftover `aria-label` on the vendor profile page. `docs/ARCHITECTURE.md`'s i18n coverage list updated — it previously called out these exact pages as "not yet translated," which is now stale.

**Why:** These pages were the last remaining English-only surfaces per `docs/ARCHITECTURE.md`'s own tracking; closing that gap.

**Verification:** 45/45 tests, `npm run lint` clean.

### 2026-09-02 — Duplicate-invoice auto-rejection + upload-retry orphan-row fix

**What (1/2) — the orphan-row bug.** `runOCR()` in the upload wizard (`src/app/(dashboard)/invoices/upload/page.tsx`) unconditionally re-ran step 1 (`POST /api/invoices`) on every attempt, while its `catch` deliberately keeps `invoiceId` set. So a user retrying after a failed file-upload or a failed create got a **second live invoice row** — the first left orphaned with a `DRAFT-<timestamp>` number, visible in every list/dashboard/reminder scan. Fixed with a single `if (!id)` guard so a retry reuses the row the previous attempt created; `saveUploadedFile()`'s existing `upsert: true` already made re-uploading the file to the same invoice safe, so no cleanup logic was needed.

Follow-on the guard exposed: the "change" link on the drop stage sends the user back to pick a *different* company/vendor/PO, and reusing the invoice there would silently mis-attribute it to the original vendor (`vendorId` isn't writable via `PATCH`, so it can't be corrected in place). That link now clears `invoiceId` too. This is the same class of bug as the earlier `vendors[0]` default-attribution bug — worth not reintroducing a variant of it.

**What (2/2) — duplicate detection.** There was none anywhere: no unique constraint, no pre-insert check. Added at `PATCH /api/invoices/[id]`, which is the *only* point it can run — at `POST` the number is still a `DRAFT-<timestamp>` placeholder, which is also precisely why a retried failed upload is never mistaken for a duplicate.

Match key: `vendorId` + `invoiceNumber`, case-insensitive, excluding `REJECTED` rows. Deliberately **not** company-scoped (user decision: same vendor reusing a number across bill-to companies is still a duplicate). On a match the update is still saved but `status` is forced to `REJECTED`, payment fields are skipped, a `Auto-rejected: duplikat dari invoice …` line is appended to `notes`, and an `invoice.auto_rejected` audit row is written with `duplicateOfId`/`duplicateOfNumber`. Chose save-as-rejected over a 409 block (user decision) so the row keeps an audit trail instead of vanishing — the trade-off is that a duplicate returns **200**, so the client checks the new `duplicateOf` response field rather than the status code, and shows a distinct toast + routes to the detail page instead of the generic success path.

The check and the write aren't atomic, so migration `20260902000000_invoice_duplicate_guard` adds a partial unique index `(vendor_id, lower(invoice_number)) WHERE status <> 'REJECTED'` as a race backstop; the route catches the resulting Prisma `P2002` and funnels it into the same auto-reject path. Raw SQL, not `@@unique` — Prisma's DSL can't express `lower()` plus a `WHERE` clause.

**Verification.** `tsc --noEmit`, `npm run lint`, and 45/45 tests all clean. The new logic is DB- and UI-bound (a Prisma query, a forced-status branch, React state) with no meaningful pure surface, so rather than adding mock scaffolding that would assert object literals back at itself, it was verified behaviorally against local docker Postgres — confirming all five properties the design depends on: (1) case-insensitive matching finds `DUP-TEST-001` when querying `dup-test-001`; (2) the index rejects a second active row with **exactly `P2002`**, the code the route's catch tests for; (3) multiple `REJECTED` rows with the same number coexist, so a rejection doesn't burn the number; (4) a different vendor may reuse the number freely; (5) no pre-existing rows in the DB violated the constraint before it was added. CI has no database (`.github/workflows`), so this stays a manual check rather than a committed test.

**Why:** Item B of the approved 2026-09-01 plan — the requirement doc lists Duplicate Check as an explicit step in the submission flow, and the user asked specifically that a *failed upload* still be retryable without being blocked as a false duplicate.

### 2026-09-01 — Invoice status workflow overhaul (17-value enum + VALID_TRANSITIONS)

**What:** Replaced `InvoiceStatus` entirely (`prisma/schema.prisma`, migration `20260901000000_status_and_stage_overhaul`) — the DB was still on the old `DRAFT/SUBMITTED/PAID/CANCELLED/REJECTED/VOID/REVISION` lifecycle (the working tree's schema.prisma had a further uncommitted 4-value `VERIFICATION_PROCESS/VERIFICATION_SUCCESS/INVOICE_SEND/INVOICE_ACCEPTED` enum that was never actually migrated). New model, based on the "Smart Invoice Payment" business requirement doc minus its PR/PO/Advance-related states (product decision — PR/PO assumed to exist before an invoice reaches this system): main flow `RECEIVED → REGISTERED → DOC_VERIFICATION → FINANCE_VERIFICATION → READY_FOR_PAYMENT → TREASURY_PROCESS → PAYMENT_SCHEDULED → PAID → CLOSED`, plus 8 exception states each with one fixed entry/resolution point (`DOC_INCOMPLETE`, `RETURNED_TO_VENDOR`, `WAITING_USER_CONFIRMATION`, `WAITING_APPROVAL`, `WAITING_TAX_DOCUMENT`, `REJECTED` terminal, `PAYMENT_HOLD`, `VENDOR_BANK_ISSUE`). Full transition graph in new `src/lib/invoiceStatus.ts` (`VALID_TRANSITIONS`, `isValidStatusTransition()`) — split out from `validations.ts` because that module imports `next/server`, which can't bundle into client components that need the transition table (the invoice detail page's status dropdown). `validations.ts` re-exports for existing server-side importers.

Same migration also applied two schema changes that were already sitting uncommitted in `schema.prisma` from earlier work but never migrated: `invoices.po_number` (required, existing rows backfilled `'N/A'`) and `PICStage`/`invoices.pic_stage`/`invoice_stage_history` (existing rows backfilled one `GA` row each, dated at `created_at`, attributed to `created_by`).

**Enforcement:** `PATCH /api/invoices/[id]` now checks `isValidStatusTransition(current, next)` before writing (400 `Invalid status transition` if not a valid edge) — previously **no transition validation existed at all**, any role that could write `status` could jump to any value. `ADMIN` bypasses, consistent with its existing `allowedFields()` bypass. The status `<select>` on the invoice detail page now only lists `VALID_TRANSITIONS[current.status]` (`ADMIN` still sees all 17) so the UI never offers a choice the server will reject.

**Data remap** (existing seed/demo rows, confirmed safe to auto-remap — not production data): `DRAFT→RECEIVED`, `SUBMITTED→REGISTERED`, `PAID→PAID`, `CANCELLED/VOID→REJECTED`, `REJECTED→REJECTED`, `REVISION→RETURNED_TO_VENDOR`.

**Propagated the enum change through** (all mechanical, same value set, verified via `tsc --noEmit`): `prisma/seed.ts` (status mix re-weighted across all 17 values + light exception sprinkling; `picStageFor()` extended), `src/lib/i18n/{en,id}.ts` (17 status labels each), `src/components/invoice/StatusBadge.tsx` (17-entry icon/color config, grouped by family — main-flow progression violet→teal, terminal green/slate, exception amber/red), `src/lib/services/{dashboardStats,geminiChat,reminderScheduler}.ts`, `src/lib/format.ts` (`isOverdue`), `src/app/api/invoices/{route,[id]/route}.ts`, `src/app/(dashboard)/{page,invoices/page,invoices/[id]/page}.tsx`.

**Dashboard chart changes** (`StatusFlowChart.tsx`, `dashboardStats.ts`): the "pipeline strip" now shows all 9 main-flow steps (was 4); the monthly trend area chart collapses to 2 series (`entered`=RECEIVED, `accepted`=PAID — was already only ever 2 series conceptually, just mapped from different field names) rather than plotting all 17 statuses, which would be unreadable; a new compact chip row below the pipeline strip surfaces exception-status counts (reusing `StatusBadge`) so the full 17-status breakdown stays visible somewhere, not just the 9 main-flow steps. `dashboardStats.ts`'s "open" KPI filter (Total Payable/Overdue/Open Count/Aging) now excludes `{PAID, CLOSED, REJECTED}` (`NON_OPEN_STATUSES`) — previously only excluded the single old terminal status.

**Also fixed while touching these files:** a pre-existing `react-hooks/purity` lint error in the invoice detail page's stage-history timeline (`Date.now()` called during render) — moved to a `useState(() => Date.now())` frozen at mount, not something this task's scope introduced but blocking a clean `npm run lint`.

**Docs:** `docs/DATABASE.md`, `docs/API.md`, `docs/ARCHITECTURE.md` updated for the new status/PICStage/InvoiceStageHistory model — these sections had drifted significantly out of sync with the actual code even before this change (documenting a `DRAFT/SUBMITTED/REVISION` model and an `allowedFields()` shape that no longer matched `src/app/api/invoices/[id]/route.ts`), corrected as part of this pass since the same sections needed rewriting anyway.

**Explicitly not done in this change** (separate items in the approved plan, dated 2026-09-01): duplicate-invoice detection + the upload wizard's orphaned-row-on-retry bug (Item B), multi-file attachment with AI document classification (Item C), dashboard lead-time/company widgets, extra search filters, PIC-assignment notifications (Item D).

**Why:** First step of a larger approved plan closing gaps between the app and the "Smart Invoice Payment" business requirement doc. This item was sequenced first because the status enum is read/filtered by nearly everything else in the plan.

**New tests:** `src/lib/__tests__/invoiceStatus.test.ts` (9 cases covering `VALID_TRANSITIONS`/`isValidStatusTransition`). Updated fixtures in `format.test.ts` for the new status names. 45/45 tests pass, `tsc --noEmit` and `npm run lint` clean.

### 2026-07-27 — Forced password change no longer shows the app shell; chatbot scope locked to invoices

**What (1/2):** `/change-password` moved from `(dashboard)/change-password/page.tsx` to `(auth)/change-password/page.tsx` — it no longer renders inside `DashboardLayout` (Sidebar/TopBar), so a user completing their mandatory first-login password change never sees the app chrome around them, matching the login page's bare look. `(auth)/layout.tsx` (previously just a passthrough for `/login`) now fetches the session server-side and wraps children in `SessionProvider` — needed because the change-password page reads `useSession()` for its `mustChangePassword` copy — and mounts its own `<Toaster>`, since that previously only existed inside `DashboardLayout` and this page's `toast.success`/`toast.error` calls would otherwise render nothing. Middleware's redirect logic (`middleware.ts`) needed no change — it gates by URL pathname, not file location, so `/change-password` stays reachable only when authenticated and still force-redirects `mustChangePassword` users to it from anywhere else.

Submit flow changed from `update()` (silently refresh the JWT and continue into the app on the same session) to `signOut({ callbackUrl: '/login' })` — the user must log back in with their new password rather than being carried straight into the dashboard on the old session.

**What (2/2):** `geminiChat.ts`'s `systemInstruction()` previously said the model "may answer general questions... directly" with no boundary, so Gemini's own world knowledge happily answered anything (reported: "siapa presiden FIFA saat ini" got a real answer). Added an explicit STRICT SCOPE clause: the model only discusses this app's own data/features, must decline (in the user's language) anything else even if it knows the answer, and must not let later conversation turns override the rule (basic prompt-injection resistance for a multi-turn chat). This is a prompt-level guardrail, not a hard filter — inherent to how instruction-following LLMs work, not airtight against a determined jailbreak attempt, but matches the existing single-system-instruction architecture rather than adding a new moderation layer for a low-stakes internal tool.

**Why:** User request — (1) the forced-change flow looked like the user was "already inside" the app before actually completing a required security step, and re-entering the app on the same pre-change session wasn't clearly separated from a fresh login; (2) the chatbot answering unrelated general-knowledge questions undermines its purpose and looks unprofessional for an internal ops tool.

**Verified:** `npx tsc --noEmit` clean, `npm run lint` 0 errors (1 pre-existing unrelated warning), `npm test` 52/52. Live-tested against the real dev server and Supabase-backed DB: created a temporary `mustChangePassword: true` user, logged in via the real NextAuth credentials flow (CSRF token + cookie jar), confirmed `GET /change-password` returns 200 with no Sidebar/TopBar markers and the centered card layout, and confirmed `PATCH /api/users/me/password` still succeeds unchanged — then deleted the temporary user. For the chatbot, called `runChat()` live against Gemini with the user's exact repro question ("siapa presiden fifa saat ini") and confirmed it now declines in Indonesian instead of answering; re-ran an in-scope query ("berapa total invoice yang statusnya SUBMITTED?") and confirmed `query_invoices` still answers correctly (no regression).

### 2026-07-27 — Branded HTML email template + status-change vendor notification

**What:** New `renderEmailLayout()` in `src/lib/services/email.ts` — a shared, table-based, fully inline-styled HTML wrapper (dark header with "Invoice Tracking" wordmark, white content card, optional black CTA button, gray footer) used by every outbound email. No `<style>` block, no flex/grid — table + inline styles only, for consistent rendering in Gmail/Outlook rather than just modern browsers. No image logo (none exists in the repo, and inline/data-URI images are commonly stripped by Gmail) — text wordmark instead. Colors match the app's own monochrome theme (`--primary: oklch(0.205 0 0)` from `globals.css`), not an arbitrary palette.

All 4 existing email call sites now route through it: `renderInvoiceListEmail()` (`reminderScheduler.ts`, due_soon/overdue) renders its invoice list as a proper `<table>` instead of a bare `<ul>`, with a CTA to `/invoices?status=SUBMITTED`; `notifyInvoiceSubmitted()` and `notifyRevisionRequested()` each get a CTA straight to the specific invoice (`/invoices/{id}`).

**New: `status_changed` notification.** Previously only `invoice_submitted` (vendor → GA) and `revision_requested` (GA → vendor) fired; a GA/Admin marking an invoice `PAID`, `CANCELLED`, `REJECTED`, or `VOID` never told the vendor. New `notifyStatusChanged()` in `invoices/[id]/route.ts` fires on any status transition into one of those four (not `REVISION`, which keeps its own richer message; not `SUBMITTED`, which is the vendor's own resubmit action). Follows the existing `revision_requested` pattern exactly: fixed recipient (the invoice's own vendor users), not role-configurable, gated by its own `ReminderSetting` row (`status_changed`) so email/in-app/active can each be toggled independently at `/admin/reminders` without a deploy. Added to `REMINDER_TYPES` (`validations.ts`), `prisma/seed.ts` (default row for fresh DBs), and `TYPE_LABELS` in the admin reminders page. The `status_changed` row was also inserted directly into the live Supabase DB via a one-off script, since `seed.ts` won't run again against a DB that already has real users in it.

**Why:** User request — the existing plain-`<p>`/`<ul>` emails looked unfinished (confirmed working via a real Gmail test send, but visually plain), and vendors had no way to find out their invoice was rejected/cancelled/paid except by checking the app themselves.

**Verified:** `npx tsc --noEmit` clean, `npm run lint` 0 errors (1 pre-existing unrelated warning), `npm test` 52/52. Sent a real test email through the new `renderEmailLayout()` (via Resend, real API call) to confirm it renders correctly, not just that it type-checks — user to visually confirm in their inbox.

### 2026-07-27 — Fix: vendor upload sent `companyId: ""`, rejected with 400

**What:** `onDrop` in `src/app/(dashboard)/invoices/upload/page.tsx` was wrapped in `useCallback(..., [])`. An empty dependency array freezes the callback's closure at the component's first render forever — react-dropzone kept calling that frozen version on every drop, so it always read `companyIdValue` from its **initial** state (`useState('')`), regardless of what the user selected in the `'select'` stage moments earlier. Every draft-creation `POST /api/invoices` therefore sent `companyId: ""`, which fails `createInvoiceSchema`'s `z.string().uuid().optional().nullable()` (`.optional()` tolerates `undefined`, not an empty string) — 400 `Validation failed: companyId: Invalid company ID` on every vendor upload. `continueFromSelect()`'s own guard against an empty `companyIdValue` never caught this because it read the (correct, live) state directly, not through the stale closure.

Fix: `onDrop` is now a plain function (redefined every render like `runOCR` already was), so it always closes over the current `companyIdValue`/`effectiveVendorId`. `react-dropzone` doesn't require a memoized callback — it happily takes a new one each render. Removed the now-unused `useCallback` import and the two `eslint-disable` comments that were suppressing the (correct) exhaustive-deps warning on this line.

**Why:** Reported by the user testing the deployed Vercel app as VENDOR — every PDF upload failed at the create-draft step.

**Verified:** `npx tsc --noEmit` clean, `npm run lint` 0 errors (1 pre-existing unrelated warning), `npm test` 52/52. Not verified against a live browser session in this pass — no browser tooling available in this environment; traced the stale-closure mechanism by reading the render/closure chain (`onDrop` → `runOCR` → `companyIdValue`) and confirmed the state-init value (`''`) matches the exact string reported in the failing payload. Recommend the user re-run the VENDOR upload flow on the next deploy to confirm.

### 2026-07-27 — ID/EN language toggle (Stage 5 of 5, upload/UX overhaul)
**What:** New `src/lib/i18n/{id,en}.ts` — two dictionaries with an identical key shape (grouped by page/section: `common`, `status`, `nav`, `topbar`, `login`, `dashboard`, `invoices`, `invoiceDetail`, `upload`, `vendorProfile`, `changePassword`, `reminders`, `audit`). `Dictionary` type is `typeof id` widened to `string` leaves via a `Widen<T>` mapped type — without that widening, TypeScript infers each Indonesian string as its own literal type and `en.ts`'s different literal values fail to structurally match. New test (`src/lib/i18n/__tests__/dictionaries.test.ts`) asserts `id`/`en` have exactly the same set of key paths and that no value is an empty string — catches a missing translation immediately instead of silently falling through to a key name or `undefined` in the UI.

`I18nProvider`/`useI18n()` (`src/hooks/useI18n.tsx`) — a React Context, deliberately **not** the same no-Context pattern `useTheme` uses (each `useTheme()` caller holds independent local state, synced only via `localStorage` + a shared DOM class mutation, which works for a CSS-driven concern but can't make every text node across the tree re-render together). Mounted once at the root layout (`src/app/layout.tsx`), covering both the `(auth)` and `(dashboard)` route groups so the choice persists across login/logout. Defaults to `id`, persisted to `localStorage` (`locale` key), consistent with `useTheme`'s own persistence pattern.

**Toggle button**: `TopBar`, immediately left of the existing dark-mode Moon/Sun button — a `Languages` icon plus the current locale code (`ID`/`EN`), click toggles.

**Translated**: `login`, `TopBar`, `Sidebar`, `Dashboard` (including the aging-bucket labels, translated client-side via a lookup keyed on the server's original Indonesian bucket strings, and `STATUSES` filter options), `Invoices` list, `Invoice` detail (including the duplicated `STATUS_LABELS` map that page already had to hand-roll — `next/server` can't be bundled into that client component, so it can't import `validations.ts` directly), the upload wizard (all 6 stages, plus the `FIELD_DEFS` fallback labels used when OCR fails), vendor `Company Profile`, `Change Password`, the `Reminders`/notification feed, the `Audit Log`, and the shared `StatusBadge`/`StatusDonut` components (both converted to Client Components to call `useI18n()`).

**Deliberately not translated this pass** (English-only regardless of toggle — doesn't crash, just doesn't respond): the four `/admin/*` management pages (`users`, `vendors`, `companies`, `reminders` settings) and the `chat` page. These are lower-traffic, admin-configuration-only screens; translating the remaining ~5 files is a bounded, mechanical follow-up using the same `useI18n()` pattern established here, deferred to keep this stage's scope deliverable rather than attempting all ~20 files in one pass. `notifications.title`/`body` (stored text, e.g. "Invoice X perlu diperiksa") is intentionally **not** retroactively translated by the toggle — it's historical data written once in whatever language was active at creation time, not live UI chrome; same treatment as audit log `metadata`.

**Why:** User request — language usage should be consistent (not mixed Indonesian/English within a view), with a toggle button next to the dark-mode button to switch between them.

**Verified live against local Postgres**: full `npx tsc --noEmit` (clean — the `Widen<T>` fix was required for `en.ts` to type-check against `id.ts`'s inferred shape), `npm run lint` (0 errors), `npm test` (52/52 — the 2 new passing tests are the dictionary key-parity and no-empty-value assertions). Started the real dev server and, for both the unauthenticated login page and 7 authenticated pages (dashboard, invoices, upload, vendor profile, change-password, reminders, audit) as `admin@demo.com`, confirmed 200 responses and that the server-rendered HTML actually contains the expected Indonesian strings (`grep`-verified against the raw HTML, not just "the page loaded") — e.g. dashboard's "Ringkasan sistem invoice AP", upload's "Invoice ini ditujukan ke mana?", audit's "Log Audit"/"Hanya Baca", confirming the default locale renders correctly server-side, not just after client hydration. Confirmed the toggle button itself renders in the TopBar with the correct `aria-label="Ganti bahasa"`.


### 2026-07-27 — Dashboard filters: search, status, vendor, company, due date (Stage 4 of 5)
**What:** New `buildDashboardFilter(searchParams, session)` (`src/lib/services/dashboardStats.ts`) — builds a `Prisma.InvoiceWhereInput` from query params (`search`, `status`, `vendorId` non-vendor-only, `companyId`, `from`/`to`) plus the existing `VENDOR`-role scoping, shared by both `GET /api/dashboard` and `GET /api/dashboard/export` so they never disagree. `getDashboardStats()` reworked to accept this combined filter directly (previously just the bare vendor-role scope) — when the caller filter already specifies a `status`, the "open" metrics (Total Payable, Overdue, Open count, Aging buckets) reflect that status instead of always forcing `SUBMITTED`/`REVISION`, so e.g. filtering to `PAID` shows PAID totals in those cards instead of zeros.

`src/app/(dashboard)/page.tsx` converted from a Server Component (with a server-side self-fetch to its own `/api/dashboard`, built from `process.env.NEXTAUTH_URL`) to a client component with a filter bar (search input, status/vendor/company selects, due-date range) matching `/invoices/page.tsx`'s existing pattern — debounced 300ms fetch on any filter change. The vendor filter is hidden for `VENDOR` role (meaningless — they only ever see their own invoices). The Export to Excel link now carries the same query string as the active filters. Recent Invoices table gained a Company column.

**Not the primary goal, but a side effect worth noting:** this removes the `NEXTAUTH_URL`-dependent self-fetch pattern that caused a real production bug (`ECONNREFUSED 127.0.0.1:3000`) when that env var was misconfigured on the first Vercel deploy — the dashboard no longer makes a server-to-itself HTTP round-trip at all, client-side `fetch` naturally resolves against the actual origin the browser is on.

**Why:** User request — dashboard needed the same kind of filter/search bar the Invoices list already has, and it should affect the whole page (KPIs and charts too), not just a table.

**Verified live against local Postgres:** confirmed unfiltered `totalInvoices` matches the full seeded set; `?status=PAID` narrows `totalInvoices` to 2 and `totalPayable` to the exact sum of those two invoices' `totalAmount` (165,000,000 — matches seed data); `?search=INV-2024-001` narrows to exactly 1; `?companyId=...` narrows correctly; confirmed the Excel export's file size differs between an unfiltered and a `status=PAID`-filtered download, proving the filter reaches the export path too. `npx tsc --noEmit` clean, `npm run lint` 0 errors (one unnecessary `eslint-disable` caught and removed — the dependency it was suppressing a warning for turned out not to be missing), `npm test` 50/50 (unchanged — this stage is route/page wiring, no new pure functions).

### 2026-07-27 — Mandatory vendor contact fields (Stage 3 of 5)
**What:** `PATCH /api/vendors/[id]` now rejects (400) any update from the vendor's own self-service edit (`isOwner`) that would leave `contactName` or `contactEmail` empty — checked against the *effective* post-update value (this patch's value if it touches the field, else the current DB value), so an unrelated partial update (e.g. just `phone`) on a vendor that already has contact info filled in is never blocked by this. Deliberately scoped to `isOwner` only — `ADMIN`/`GA_STAFF`/`GA_MANAGER` can still freely edit an admin-seeded vendor that hasn't filled in its own profile yet (e.g. toggling `isActive`) without hitting this constraint.

`/vendor/profile` (the vendor's own Company Profile page): added a red `*` to the Primary Contact Name/Email labels plus a "* Required field" legend, `type="email"` on the email input, and a `validate()` check before the save request fires — empty name, empty email, or a malformed email address all show a toast and never reach the API. Server error messages (e.g. the 400 above) now surface directly in the toast instead of a generic "Update failed".

**Why:** User request — vendor profile completeness (at minimum, a named contact and their email) should be enforced, not just implied by the form having those fields. Explicitly chosen: validation on save (not a hard block on using the rest of the app, e.g. uploading invoices) — a vendor with an incomplete profile can still work, they just can't leave contact info blank when they do save the profile page itself.

**Verified live against local Postgres:** as `vendor1`, attempted to clear both `contactName` and `contactEmail` via a direct API call — got the expected 400. Then sent an unrelated partial update (`phone` only, contact fields untouched) — succeeded 200 with the existing `contactName`/`contactEmail` preserved, confirming the fix doesn't block ordinary partial edits. `npx tsc --noEmit` clean (needed one explicit cast — `Object.fromEntries` collapses the filtered-fields object's value type to a union across every possible field, including `isActive: boolean`, so `.trim()` needed a `string | null` cast), `npm run lint` 0 errors, `npm test` 50/50 (unchanged — no new pure functions to unit test; the validation lives in a route handler and a client component).

### 2026-07-27 — Upload wizard restructure: company/vendor first, OCR-failure fallback (Stage 2 of 5)
**What:** `src/app/(dashboard)/invoices/upload/page.tsx` rewritten around a new first stage, `select`: the user picks the bill-to `Company` and — for any non-`VENDOR` role — the `Vendor` sending the invoice, both from real dropdowns, before a file is even chosen. Only after that does the wizard show the drop-zone. `POST /api/invoices` now receives `companyId` and the explicitly-chosen `vendorId` at draft-creation time, not deferred to the review-step `PATCH`.

**Fixed a real bug found while tracing this flow**: `GA_STAFF`/`GA_MANAGER`/`ADMIN` uploads previously called `GET /api/vendors?limit=1` (a query param that route doesn't even use — it returns every active vendor regardless) and blindly took `vendors[0]`, so an invoice uploaded by staff could silently get attributed to whichever vendor happened to sort first, not the vendor whose document was actually being entered. There was no way to notice this from the UI — nothing displayed which vendor got picked.

**OCR-failure fallback**: previously, an OCR error or dropped `EventSource` connection still moved the wizard to the `review` stage, but the review form is driven entirely by the `fields` array populated from SSE `field` events — if OCR failed before extracting anything, that array stayed empty and the form rendered with **zero visible inputs**, i.e. exactly "leave it blank" with no way to proceed except abandoning the upload (which is what produced the Stage 1 `DRAFT`-nyangkut bug in the first place). Both failure paths (`error` event, `onerror`) now call `fallbackToManualFields()`, which populates the same 8 field keys the server would have sent (`vendor_name` … `total_amount`) as empty, fully-editable inputs — using the functional `setFields` form so it never clobbers any fields that *did* extract successfully before the failure — plus a red banner replacing the confidence banner. The file itself was already uploaded successfully by this point; only the AI extraction step failed.

**Other flow changes**: `sendDate` (hardcopy-sent date) moved out of the `VENDOR`-only block into a field every role sees in the review step, matching the requirement that whoever uploads can record it. `companyId` is no longer re-selectable in the review step (shown read-only as "Bill to: {name}", already locked in from step 0). `PATCH /api/invoices/[id]` at final submit now explicitly sends `status: 'SUBMITTED'` (previously implicit/absent from this call — Stage 1 made the `DRAFT → SUBMITTED` transition this route's actual job). "Upload Again" now resets all the way back to the `select` stage, not just `drop`, so a restart also lets the user reconsider company/vendor.

**Why:** User request — the upload flow's information order didn't match how the real-world process works (which PT an invoice bills should be known before you even open the document), OCR failures produced an unusable blank form instead of falling back to manual entry, and there was a live data-integrity bug (wrong vendor attribution) with no way for the uploader to notice it. Part of a 5-stage plan agreed with the user (Stage 1: DRAFT status, this stage, mandatory vendor-profile fields, dashboard filters, ID/EN i18n toggle).

**Verified live against local Postgres** (not Supabase, same reasoning as Stage 1): logged in as `gastaff`, explicitly selected a vendor that was *not* first alphabetically/positionally in the list, created the draft via the real API, uploaded a real file, confirmed both `vendorId` and `companyId` came back exactly as selected (not defaulted). Completed the full create → upload → submit sequence with manually-typed field values (simulating the OCR-failure path server-side, since no `GOOGLE_API_KEY` is configured for local dev) and confirmed the invoice reached `SUBMITTED` with the file attached and the manually-entered data persisted. `npx tsc --noEmit` clean, `npm run lint` 0 errors, `npm test` 50/50 (unchanged — this stage is UI-flow logic, no new unit-testable pure functions).

### 2026-07-27 — DRAFT invoice status (Stage 1 of 5, upload/UX overhaul)
**What:** New `DRAFT` value on `InvoiceStatus` (migration `20260727000000_add_draft_invoice_status`, additive). `POST /api/invoices` now creates the placeholder row as `DRAFT` instead of `SUBMITTED`. `DRAFT` is excluded from: `GET /api/invoices` (unconditionally, regardless of `?status=` filter), `getDashboardStats()` and its two callers (`GET /api/dashboard`, `GET /api/dashboard/export`), and the chat `query_invoices` tool's default query (`geminiChat.ts`). `VALID_TRANSITIONS.DRAFT = [SUBMITTED, CANCELLED]`. `allowedFields()` in `PATCH /api/invoices/[id]` treats `DRAFT` like `REVISION` — the owning `VENDOR`/`GA_STAFF`/`GA_MANAGER` gets the full `CREATE_TIME_FIELDS` set plus `status`, so the wizard's final "Submit" step can both correct the data and transition `DRAFT → SUBMITTED` in one `PATCH`. `isOverdue()` (`src/lib/format.ts`) now also treats `DRAFT` as never-overdue.

**Moved the `invoice_submitted` notification trigger** from `POST /api/invoices` (creation) to `PATCH /api/invoices/[id]` (the `DRAFT → SUBMITTED` transition, gated on the confirming user being `VENDOR` — unchanged from before). `notifyInvoiceSubmitted()` exported from `src/app/api/invoices/route.ts` and imported into the `[id]` route rather than duplicated. The `[id]` route's `PATCH` update query now also includes `vendor: { select: { name: true } }`, needed for the notification's vendor-name text.

**Why:** User-reported gap: closing the browser mid-upload left an empty `DRAFT-{timestamp}` row that showed up in the invoice list, dashboard KPIs/charts, and — worse — had already fired an `invoice_submitted` notification/email to GA Staff for an invoice the vendor never actually finished submitting. This is Stage 1 of a 5-stage plan (upload wizard restructure, mandatory vendor-profile fields, dashboard filters, ID/EN i18n toggle) agreed with the user before starting; later stages build on this status.

**Verified live against local Postgres** (not Supabase — deliberately targeted the local docker DB via inline env overrides to avoid touching the production database without being asked): created a real draft via the API as `vendor1`, confirmed `totalInvoices`/`GET /api/invoices` count unchanged while `DRAFT`, confirmed zero notifications fired at creation; `PATCH`ed `status: SUBMITTED`, confirmed the count incremented and exactly one `invoice_submitted` notification landed for `gastaff`. `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test` (50/50 — the 3 new passing cases are the auto-generated `DRAFT → SUBMITTED`/`DRAFT → CANCELLED` transition tests from the existing data-driven `VALID_TRANSITIONS` test, plus one added `isOverdue` case for `DRAFT`).


### 2026-07-27 — Fix: `prisma.config.ts`/`seed.ts` ignored `.env.local`
**What:** Both files loaded env vars via plain `import "dotenv/config"`, which only reads `.env` — never `.env.local`. Whenever both files coexist (the common case: an old `.env` left over from earlier in the project, plus the `.env.local` `docs/SETUP.md` actually documents), `prisma migrate deploy` and `npx tsx prisma/seed.ts` would silently use `.env`'s values, completely ignoring `.env.local` edits, with no error — just the wrong database. Switched both to `@next/env`'s `loadEnvConfig()` (added as an explicit devDependency — was already bundled transitively via `next`), which is the exact mechanism `next dev` itself uses (`.env.local` overrides `.env`), so CLI tooling and the running app now resolve env vars identically. Also gave `seed.ts` the same Supabase-pooler SSL workaround `src/lib/db/prisma.ts` already had (explicit `pg.Pool` + `ssl` option, `sslmode`/`sslaccept` stripped from the URL) — it was building its own `PrismaPg` adapter directly from a connection string with no SSL handling at all, which would have failed against Supabase even after the env-loading fix. Fixed a stale `5434` fallback port in `prisma.config.ts` to `5433`, matching `docker-compose.yml`.

**Why:** User-reported — ran the Supabase deployment guide's migrate/seed steps, got no visible error, but no data appeared in the new Supabase project. Root-caused via a hash comparison of `.env` vs `.env.local`'s `DATABASE_URL` (without ever printing the actual connection string) — confirmed `prisma.config.ts` was resolving to `.env`'s stale value, not `.env.local`'s.

**Not user's config mistake, but flagged one anyway:** while diagnosing, found `DATABASE_URL` in the user's `.env.local` still matched the original local-docker default byte-for-byte — only `DIRECT_URL` had actually been updated to Supabase. Since the app runtime and seed script only ever read `DATABASE_URL` (never `DIRECT_URL`), this needed calling out separately from the code fix — the code fix alone doesn't help if `DATABASE_URL` itself was never pointed at Supabase.

**Also removed** the stale `.env` file (untracked/gitignored, dated 2026-07-15, fully superseded by `.env.local`) per user request, to prevent this exact class of bug from recurring.

**Verified:** `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test` (47/47) all pass. Confirmed the fix's *precedence logic* via SHA-256 hash comparison of `.env`/`.env.local`/resolved values — never printed a real secret to verify. Did not run `migrate deploy`/`seed` against the user's live Supabase project myself (would mutate their real external database without being explicitly asked to in that moment); left for the user to re-run and confirm.

### 2026-07-26 — Supabase Storage, Gemini OCR/chat, Resend email — retired the Python ai-service
**What:** Added `@supabase/supabase-js`, `@google/genai`, `resend` (explicit user approval per `CLAUDE.md`'s new-dependency rule). Removed `ai-service/` entirely (Python FastAPI + Tesseract + LangChain, explicit user approval — a separate destructive-action confirmation since it deletes tracked files).

**File storage** (`src/lib/services/fileService.ts`): `saveUploadedFile()`/new `getFileBuffer()` use Supabase Storage (private `invoices` bucket, service-role key) when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set, else fall back to local disk — same fallback behavior dev has always had, but now Vercel-capable when configured. `filePath` is now always the bare `{invoiceId}.{ext}` object key (previously the local-disk build stored a full absolute path) — server-derived from `invoiceId`, never user input, so the old path-traversal confinement check in `GET /api/invoices/[id]/file` was removed as dead code rather than kept as defense with nothing to defend against. That route's Vercel-503 special case is also gone — Supabase Storage works on Vercel, so there's no longer a deployment target where file serving is impossible.

**OCR** (`src/lib/services/geminiExtraction.ts`): `GET /api/invoices/[id]/ocr` now reads the file via `getFileBuffer()` and calls `extractInvoiceFields()` — one Gemini vision call reads the PDF/image directly (`responseSchema`-enforced JSON output), replacing the old two-step Tesseract-text → LangChain-LLM pipeline. Output shape (`{field: {value, confidence}}[]` + `line_items` + `overall_confidence`) and the `overall_confidence` formula (average of the 7 core fields' confidence, excluding currency, over non-null values) were kept identical to the old `ai-service/app/api/ocr.py` so no other code — the SSE event stream, the DB write, the frontend confidence bars — needed to change.

**Chat** (`src/lib/services/geminiChat.ts`): `POST /api/chat` now calls `runChat()` directly. Defines a `query_invoices` function declaration (filters: status, vendorName, companyName, overdueOnly, due date range, limit) that Gemini calls when a question needs real data; the route runs an actual Prisma query and returns matched invoices plus a server-computed `totalMatched`/`sumTotalAmount` so aggregate questions (totals, counts) stay accurate even past the returned list's cap, then feeds the result back to Gemini as a `FunctionResponse` for a final answer. Per the user's explicit correction earlier this session, the query is **not** scoped to any particular status — chat can answer about any invoice, gated only by the route's existing `ADMIN`/`GA_MANAGER`-only `requireRole`. This replaces the old static-context-string prompt (which answered from the model's general knowledge, not the database) — the actual point of `docs/PRODUCTION_PLAN.md` §5.2.

**Email** (`src/lib/services/email.ts`): `sendEmail(to, subject, html)` via Resend, no-ops silently (not an error) when `RESEND_API_KEY` is unset — reminder triggers call it unconditionally and shouldn't fail (or crash the daily cron) over missing config. Wired into all three existing notification triggers, each gated independently from its in-app counterpart via the same `ReminderSetting` row: `checkDueDates()` (due_soon/overdue — restructured so `isActive && (inAppEnabled || emailEnabled)` gates the invoice scan, with `inAppEnabled`/`emailEnabled` then independently gating each channel, where previously `inAppEnabled` alone gated the whole block and email had no path at all), `notifyInvoiceSubmitted()`, `notifyRevisionRequested()`. Recipients = the same role/vendor-scoped user list already computed for in-app notifications, plus each setting's `extraEmails`.

**Why:** Completes the three pieces of `docs/PRODUCTION_PLAN.md` deferred at the CI checkpoint pending user approval for new dependencies and credentials — user approved all three (Supabase Storage, Gemini OCR+chat, Resend) plus removing `ai-service/` in the same session.

**Env vars** (all optional — each integration degrades gracefully without its key, verified below): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Added to `.env.example` (new file) and as empty placeholders in `.env.local`, which is gitignored — no real key values were ever available to or handled by the assistant, since credentials aren't something that should be pasted into a chat session even a private one.

**Verified live against the real running dev server and local Postgres, deliberately without real credentials** (none were available — the point was confirming graceful degradation, not full round-trips through Gemini/Supabase/Resend, which the user still needs to do once they add real keys): logged in as `vendor1` via the real NextAuth flow, created a draft invoice, uploaded a PDF — confirmed `filePath` came back as the new bare `{id}.pdf` object key (local-disk fallback, no `SUPABASE_URL` set), downloaded it back through `GET /api/invoices/[id]/file` and diffed it byte-for-byte against the original upload (identical), confirmed `vendor2` still gets 403 on `vendor1`'s file. Hit `GET /api/invoices/[id]/ocr` without `GOOGLE_API_KEY` — got a clean SSE `error` event (`"GOOGLE_API_KEY is not configured"`), not a crash or a hung stream. Hit `POST /api/chat` the same way — got the existing friendly-fallback `{answer: "..."}` response, 200, not a 500. Ran the real cron route (`GET /api/cron/reminders` with the correct `CRON_SECRET`) and the two inline triggers (created an invoice as `vendor1`, transitioned it to `REVISION` as `admin`) with the new email code path active and no `RESEND_API_KEY` set — all three completed 200/201 with no error, confirming the no-op path doesn't break the request it's attached to. Full `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test` (47/47), and `npm run build` (real production build, not just typecheck) all pass.

**Found and fixed along the way, unrelated to the new integrations:** `new NextResponse(buffer, ...)` in the file-serving route started failing `tsc` once `buffer` came from a function with an explicit `Promise<Buffer>` return-type annotation instead of a directly-inferred `readFile()` call — a real (if obscure) TypeScript/Node-types quirk where an explicitly-annotated `Buffer` return type doesn't structurally satisfy `BodyInit` the same way an inferred one does, reproduced in isolation before concluding it wasn't caused by the new dependencies. Fixed by wrapping in `new Uint8Array(buffer)`, which is unambiguously `BodyInit`-compatible regardless of how the `Buffer` was produced.

### 2026-07-26 — GitHub Actions CI (typecheck/lint/test on every push and PR)
**What:** New `.github/workflows/ci.yml` — on `push` to `main` and every `pull_request`: `npm ci` → `npx prisma generate` (schema-only, no live DB needed) → `npx tsc --noEmit` → `npm run lint` → `npm test`. Node 22, npm-cached.

**Fixed the pre-existing lint errors this surfaced** (none newly introduced — `npm run lint` had never been run clean across the whole repo before, only spot-checked per file): `src/hooks/useTheme.ts` had `applyTheme` referenced before its declaration and two `setState`-in-effect calls flagged by `eslint-plugin-react-hooks`'s newer rules — reordered `applyTheme` above the effect, and scoped `eslint-disable-next-line` on the two calls that are the standard client-only-hydration pattern (reading `localStorage`/`matchMedia` can't move into a lazy `useState` initializer without a server/client render mismatch). The same `setState`-in-effect pattern (an effect calling a `useCallback`/function that sets a loading flag before its async fetch — a legitimate, common data-fetch-on-mount shape) recurs in `audit/page.tsx`, `invoices/[id]/page.tsx`, `invoices/upload/page.tsx`, `reminders/page.tsx`, and the new `vendor/profile/page.tsx`; same scoped-disable treatment. `invoices/upload/page.tsx` also had `runOCR` (a hoisted `function` declaration, safe at runtime) referenced by an earlier `useCallback` — disabled `react-hooks/immutability` at the one call site rather than relocating a 90-line function. Two `<p>`/`<div>` apostrophes in `vendor/profile/page.tsx` needed `&apos;` (`react/no-unescaped-entities`). Two `any`-typed Prisma `where` clauses (`api/audit/route.ts`, `api/invoices/route.ts`) replaced with `Prisma.AuditLogWhereInput`/`Prisma.EnumInvoiceStatusFilter['equals']`.

**Why:** `CLAUDE.md` requires unit tests before finishing tasks; a CI workflow makes that automatic on every push/PR instead of relying on remembering to run it locally. Fixing the lint errors it surfaced was necessary — a CI job that fails on its first run against `main` isn't useful, and none of these were touched by unrelated refactoring beyond what made the rule pass.

**Verified locally by running the exact 4 CI steps against this working tree:** `npx prisma generate` (105ms, no DB connection attempted), `npx tsc --noEmit` (clean), `npm run lint` (0 errors, 1 pre-existing unused-arg warning on `notifications/route.ts`'s `PATCH(req)` — Next.js route handlers require the parameter even when unused, left as-is), `npm test` (47/47 passing, 5 files). Did not push a branch to actually trigger GitHub Actions — that requires the repo's Actions to be enabled/observed on GitHub, outside local verification.

### 2026-07-26 — Admin-editable reminder settings, replacing hardcoded thresholds (3f)
**What:** New `ReminderSetting` model (`reminder_settings` table, unique `type`) — one row per notification type (`due_soon`, `overdue`, `invoice_submitted`, `revision_requested`), each with `isActive`, `daysBefore` (only meaningful for `due_soon`), `recipientRoles` (JSON array of `Role`), `extraEmails`, `emailEnabled`, `inAppEnabled`, and a server-assigned `updatedById`. New `GET /api/admin/reminders` + `PATCH /api/admin/reminders/[type]` (`ADMIN`-only, writes `audit_logs`). New `/admin/reminders` page — one card per type with an active toggle, days-before input (`due_soon` only), a role multi-select, a comma-separated extra-emails field, and separate email/in-app switches. Per the plan, deliberately **no** send-time/frequency controls — Vercel Hobby's cron cap means only "once daily" is actually deliverable, and a UI promising more would be a lie.

`reminderScheduler.ts`'s `checkDueDates()` rewritten to read `daysBefore`/`recipientRoles`/`isActive`/`inAppEnabled` from the `due_soon`/`overdue` rows instead of the module-level constants it had before (`OPEN_STATUSES` for status filtering stays hardcoded — that's app-model, not admin policy).

**Extended scope beyond a settings-CRUD page — wired two more triggers that don't need Resend:** `invoice_submitted` (fires in `POST /api/invoices` when the creator is `VENDOR`) and `revision_requested` (fires in `PATCH /api/invoices/[id]` when `status → REVISION`, always targeting the invoice's own `VENDOR` users regardless of `recipientRoles` — that field only applies to the other three types) now write real `notifications` rows, gated by their settings row's `isActive`/`inAppEnabled`. These were previously undocumented gaps — no in-app notification existed for either event at all. `emailEnabled` is stored and surfaced in the UI but not yet acted on anywhere; that's the thin layer that gets added once Resend is approved, without touching this notification-creation logic.

**Why:** User request (3f) — the two thresholds (due-soon window, recipient list) previously required a code change + deploy to adjust. The `invoice_submitted`/`revision_requested` wiring directly serves the reminder-email feature request's own stated triggers (`docs/PRODUCTION_PLAN.md` §6.2), just via in-app notifications for now instead of email.

**Verified live against real Postgres and real sessions:** confirmed all 4 default rows seed correctly; `PATCH` as `ADMIN` updates `daysBefore`/`emailEnabled`/`extraEmails` and stamps `updatedById`; `GA_STAFF` gets 403 on both `GET` and `PATCH`; an unknown `type` 404s before validation runs; the cron route picks up a changed `daysBefore` on the next call; a real `vendor1` invoice creation produces an `invoice_submitted` notification for `gastaff`; a real `REVISION` transition produces a `revision_requested` notification for the vendor; and — the actual suppression test — disabling the `revision_requested` row via `PATCH`, then triggering the same transition again, produced **zero** new notifications (count unchanged before/after), confirming the gate actually gates.

### 2026-07-26 — Forced password change for admin-created accounts + active toggle (3a)
**What:** `User.mustChangePassword` (bool, default `true`; migration `20260726181558_add_must_change_password`). `POST /api/users` now creates accounts that must set their own password before reaching anything else — `middleware.ts` redirects every page route to `/change-password` while the flag is true (API routes stay reachable — the change-password call itself is one). New `PATCH /api/users/me/password` (verifies `currentPassword`, rehashes, clears the flag, writes `audit_logs`). New `/change-password` page.

**The stale-JWT problem and how it's handled:** NextAuth JWT sessions are stateless, so clearing the DB flag alone wouldn't update the session the user is already holding — they'd stay gated until the token's natural expiry. Fixed with NextAuth's `trigger: 'update'` mechanism: `/change-password` calls the client-side `update()` after a successful password change, which POSTs to `/api/auth/session` and re-runs `auth.ts`'s `jwt` callback with `trigger === 'update'`, re-reading `mustChangePassword` from the DB and re-encoding the cookie. Had to fix this in **two places**, not one — `middleware.ts` runs against the separate Edge-safe `authConfig` (no DB access), which has its own `jwt`/`session` callbacks that only forwarded `id`/`role` onto `session.user`; `mustChangePassword` had to be added there too or middleware would never see it even though the full `auth.ts` config set it correctly.

Also wired up the admin users page's previously-static "Yes/No" Active column into a clickable toggle (`PATCH /api/users/[id]` with `{isActive}` — that endpoint already accepted the field, just had no UI control).

Demo seed accounts (`prisma/seed.ts`) explicitly set `mustChangePassword: false` on all 6 — otherwise the shared `demo123` quick-login buttons on the login page would force a password reset on every demo account's first use, breaking the documented demo flow.

**Why:** User request (3a) — the remaining gap from the existing admin-user-creation flow, per `docs/PRODUCTION_PLAN.md` §6.1 (welcome-email delivery is the other listed gap, deferred pending the Resend decision).

**Verified live end-to-end, not just compiled:** confirmed demo `admin@demo.com` logs in and reaches the dashboard without any redirect (seed's `false` flag holds); created a real user via `POST /api/users`, logged in as them, confirmed the session correctly carried `mustChangePassword: true`, confirmed a page route redirected to `/change-password` while an API route (`GET /api/invoices`) did not; confirmed a wrong `currentPassword` is rejected 400; confirmed a correct change succeeds and the JWT stays stale until the `update()` call is simulated (`POST /api/auth/session`), after which the session flips to `false` and the dashboard becomes reachable in the same request round-trip.

### 2026-07-26 — Vendor profile: extended fields, VendorContact, self-service editing (3e)
**What:** `Vendor` gains `address`/`city`/`phone`/`bankAccountHolder`/`bankBranch` (migration `20260726180556_extend_vendor_profile`). New `VendorContact` model (`vendor_contacts` table, cascade-deletes with its vendor) — a vendor can have several PICs (finance, sales, ops), kept as a separate table rather than flat fields.

New endpoints: `POST /api/vendors` (`ADMIN`-only — creates the `Vendor` entity a `VENDOR`-role user account later links to via `POST /api/users`, a separate step); `GET/PATCH /api/vendors/[id]`; `GET/POST /api/vendors/[id]/contacts`; `DELETE /api/vendors/[id]/contacts/[contactId]`. `GET /api/vendors` (list) now scopes `VENDOR`-role callers to their own vendor only — previously returned the full list to everyone. `PATCH` uses the same field-aware-not-flat-role-gate pattern as invoices (`allowedVendorFields()`): `name`/`npwp` are `ADMIN`-only (they're used to match tax documents — a vendor renaming itself would break that audit trail), everything else is self-editable by `ADMIN`/`GA_STAFF`/`GA_MANAGER` for any vendor, or by the linked `VENDOR` for their own record only.

New `/admin/vendors` page (create — `ADMIN` only — plus an expandable per-row edit panel with a contacts sub-list, open to `ADMIN`/`GA_STAFF`/`GA_MANAGER`) and `/vendor/profile` (self-service page for `VENDOR`, name/npwp shown read-only with a lock icon and an explanatory note, rest editable, own contacts manageable).

**Resolved a conflict in my own plan while implementing:** `docs/PRODUCTION_PLAN.md` §6.5's prose said vendor-data editing is `ADMIN, GA_STAFF` only, but its own §11 role-matrix table listed `GA_MANAGER` as included. Went with including `GA_MANAGER` — consistent with the pattern established everywhere else this session (`GA_MANAGER` mirrors `GA_STAFF`'s operational permissions plus supervisory extras), and matches the more-recently-written summary table.

**Why:** User request (3e) — vendor's own detail data (address, bank account, PICs) editable by the vendor after being seeded by admin; name/NPWP locked since they anchor tax-document matching.

**Verified live against real Postgres and real sessions across three roles:** as `VENDOR`, confirmed a `name`/`npwp` change is silently dropped while `city`/`phone` in the same request still applies (partial-field filtering, not a hard reject); confirmed `GET /api/vendors` returns only the caller's own vendor; confirmed `GET`/`PATCH` on a different vendor's real id both return 403 (tested against an actual second vendor id, not just a malformed one); confirmed adding a contact works. As `GA_STAFF`: confirmed `POST /api/vendors` (create) is blocked 403 (`ADMIN`-only) while `PATCH` on an existing vendor's non-locked field succeeds, and a `name`-only `PATCH` correctly 403s (filtered field list ends up empty).

### 2026-07-26 — Company model: bill-to entity selection (3c/3d)
**What:** New `Company` model (`companies` table, migration `20260726175202_add_companies`) — the invoice-receiving entity ("bill-to"), distinct from `Vendor` (the sender). `Invoice.companyId` is a nullable FK (nullable by design, not backfill laziness — avoids forcing a value onto rows that predate the feature; see `docs/PRODUCTION_PLAN.md` §6.3). New `GET/POST /api/companies` and `PATCH/DELETE /api/companies/[id]`, writes/deletes restricted to `ADMIN`/`GA_STAFF` (`GA_MANAGER` explicitly excluded — matches the plan's own permission matrix, which the Sidebar nav had drifted from, see below); `DELETE` soft-deletes (`isActive = false`) so existing invoice references stay valid. `GET` is open to any authenticated user, including `VENDOR` — it populates the upload wizard's company dropdown.

New `/admin/companies` page (create/list/deactivate). Upload wizard: `VENDOR` gets a required company `<select>` in the review step (same pattern as the existing `sendDate`/`picId` fields — collected after the draft invoice exists, submitted via the confirm `PATCH`, not at initial draft-creation time). Invoice detail page shows "Bill to: {company.name}". Excel export gains a Company column. `allowedFields()` in `PATCH /api/invoices/[id]` grants `companyId` alongside the other `CREATE_TIME_FIELDS` (editable during the same review/resubmit window as `invoiceNumber`/`totalAmount`/etc.).

**Found and fixed while wiring up the Sidebar:** I'd added `/admin/companies` to `GA_MANAGER`'s nav roles in an earlier commit this session, ahead of actually building the feature — but the plan (§6.4, and the role matrix in §11) restricts company management to `ADMIN`/`GA_STAFF` only. Caught by re-reading the plan before implementing; corrected before it ever shipped inconsistently.

**Why:** User request (3c/3d) — vendor picks which PT an invoice is billed to at submission time; admin/GA Staff manage the PT list.

**Verified live against real Postgres and real sessions:** applied the migration, restarted the dev server for the regenerated Prisma client, reseeded (2 demo companies, cycled across all 20 seed invoices by index). Then, through the real API: created/patched/soft-deleted a company as `ADMIN` and confirmed the soft-deleted one disappears from the default `GET` but still appears with `?includeInactive=true`; confirmed `GA_MANAGER` and `VENDOR` both get 403 on `POST /api/companies` but 200 on `GET`; and ran the actual wizard sequence as `vendor1` — created a draft (`companyId: null`), then `PATCH`ed with a real `companyId`, then confirmed `GET` returns the fully populated `company` relation.

### 2026-07-26 — Payment tracking: PAID status, paidDate/paidAmount/paidBy
**What:** `InvoiceStatus` gets `PAID` back (additive `ALTER TYPE ... ADD VALUE`, migration `20260726173942_add_payment_tracking` — no type-swap needed since adding an enum value doesn't require one, unlike the role removal migration). `Invoice` gains `paidDate`, `paidAmount` (`Decimal(15,2)`), `paidById` (FK → `users.id`). `VALID_TRANSITIONS`: `SUBMITTED → {..., PAID}`, `PAID → []` (terminal). `allowedFields()` in `PATCH /api/invoices/[id]` grants `paidDate`/`paidAmount` to `GA_STAFF`/`GA_MANAGER` unconditionally (not gated on `isEditor` — marking paid isn't tied to who created the invoice). The route sets `paidById` **server-side only** (session user id, never from the request body) and defaults `paidDate`/`paidAmount` to `now()`/`totalAmount` when the caller omits them, so a partial-payment amount can still be recorded explicitly.

UI: invoice detail page gets a "Tandai Lunas" card (paid date + amount inputs, defaults pre-filled) shown to `GA_STAFF`/`GA_MANAGER`/`ADMIN` while `status = SUBMITTED`; once paid, the same slot shows a read-only paid-date/amount/marked-by summary. `PAID` is deliberately excluded from the generic status-update dropdown (which has no fields for paidDate/paidAmount) so there's exactly one path that can set it. `StatusBadge` and the invoices-list status filter both get a `PAID`/"Lunas" entry. Excel export gains Paid Date/Paid Amount columns.

**Found and fixed while touching this area:** `isOverdue()` (`src/lib/format.ts`) excluded `CANCELLED`/`REJECTED`/`VOID` from the overdue check but not `PAID` — a paid invoice past its due date would have displayed as overdue. Added `PAID` to the terminal-status list. Also added `src/lib/__tests__/format.test.ts` (7 cases), which this function had no coverage for before.

**Why:** User decision — chatbot needs a real payment signal to answer "which invoices are unpaid" honestly (`SUBMITTED` means "outcome unknown", not "unpaid" — see `docs/PRODUCTION_PLAN.md` §5.2/§5.3). No payment gateway integration; this is a manual record of an outcome decided outside the app, same pattern as `CANCELLED`/`REJECTED`/`VOID`.

**Known pre-existing issue found, not fixed (out of scope for this task):** `seed.ts`'s invoice-creation loop only ever assigns `createdById` to `gaStaff` or `gaManager` (`d.creator === 'gastaff' ? gaStaff : gaManager`), even for the ~14 entries tagged `creator: 'vendor'` — so those "vendor-created" demo invoices are actually attributed to a GA_MANAGER user, not an actual vendor user. Predates this session (the ternary was already binary before the role-simplification commit touched this line); demo-data cosmetic issue only, no functional impact.

**Verified live against real Postgres and a real session, not just compiled:** applied the migration to the local dev DB, regenerated the Prisma client, restarted the dev server (caught a stale-Prisma-client 500 from the long-running dev process — `Unknown field paidBy for include statement` — until restarted with the freshly generated client), reseeded, then through the actual NextAuth login flow: marked a real `SUBMITTED` invoice `PAID` as `GA_STAFF` with no `paidAmount` supplied (confirmed it defaulted to `totalAmount` and `paidById` matched the logged-in user's real id), confirmed `PAID → PAID` is rejected 400 ("Cannot transition from PAID to PAID"), and confirmed a `VENDOR` attempting to mark their own invoice paid gets 403.

### 2026-07-26 — docker-compose: pgvector → plain postgres
**What:** `docker-compose.yml`'s `db.image` changed from `pgvector/pgvector:pg16` to `postgres:16`. Docs updated to match (`docs/ARCHITECTURE.md`, `docs/DATABASE.md`).
**Why:** No `vector` column has ever existed in the schema — chat has always answered from a static context string (`docs/ARCHITECTURE.md`'s own Known Limitations section already said so), and is being rebuilt onto a structured `query_invoices` tool rather than vector search (`docs/PRODUCTION_PLAN.md` §5.2). Dead weight removed from the local dev image.
**Not applied to the running container:** this only changes what a fresh `docker-compose up` provisions. The already-running local `invoice_demo_db` container (with this session's migrated + seeded data) was intentionally left untouched — recreating it wasn't asked for and risked live dev data for a cosmetic image swap.

### 2026-07-26 — Rate limiter: lazy sweep instead of a background setInterval
**What:** `src/lib/rate-limit.ts`'s `setInterval(...).unref()` (swept expired entries every 60s) replaced with a lazy sweep — every 100th call to `rateLimit()` walks the Map and drops expired entries. New `src/lib/__tests__/rate-limit.test.ts` (4 cases: under-limit allowed, over-limit 429 + `Retry-After`, window reset, independent identifiers) — this file had no test coverage before.
**Why:** A `setInterval` doesn't fire reliably on serverless (the process can freeze between invocations), so correctness shouldn't depend on it. The per-instance in-memory limiter itself is accepted as-is for now — see `docs/PRODUCTION_PLAN.md` §4.3 for why (protects an authenticated surface, not anonymous; degrades to "per instance" rather than failing open).
**Verified live:** hit `/api/chat` (limit 10/min) 11 times through the real running server as a logged-in `GA_MANAGER` — first 10 returned 200, the 11th returned 429, confirming the refactor preserved the exact limiting behavior, not just that it type-checks.

### 2026-07-26 — Notification bell: SSE stream → client polling
**What:** Deleted `GET /api/notifications/stream` (held a `ReadableStream` open, polling the DB server-side every 15s for as long as the client stayed connected). `useNotificationStream.ts` now polls the existing `GET /api/notifications?unread=true` endpoint client-side every 60s and uses the response array's length as the unread count — no new route needed, the endpoint already existed for the notification-bell popover.
**Why:** A held-open SSE connection doesn't fit a serverless function — Vercel bills and eventually terminates long-lived connections, and it defeats scale-to-zero. Client polling is one `fetch` per interval, fits the request/response model serverless is built for. See `docs/PRODUCTION_PLAN.md` §4.4.
**Verified live:** confirmed the deleted route now hits middleware's generic 401 (not a route-specific response — expected, doesn't leak route existence) and that the new polling call returns real unread-notification rows for a logged-in user via the actual NextAuth session flow.

### 2026-07-26 — node-cron → Vercel Cron for due-date reminders
**What:** Removed `node-cron`/`@types/node-cron` and `src/instrumentation.ts` (an in-process scheduler doesn't survive Vercel's serverless scale-to-zero). `src/lib/services/reminderScheduler.ts` now exports a pure `checkDueDates()` function (previously wrapped in `cron.schedule(...)` + a `setTimeout` for demo-boot); new `GET /api/cron/reminders` route calls it, guarded by an `Authorization: Bearer <CRON_SECRET>` check done inside the route itself (no NextAuth session exists for a Vercel Cron-initiated request). Registered in `vercel.json` → `crons: [{ path: "/api/cron/reminders", schedule: "0 1 * * *" }]` — daily, the Vercel Hobby-plan cap. Also bumped the OCR route's `maxDuration` to 60s in `vercel.json` (Hobby's function ceiling is actually 300s, well above the 30s default already set — 60 is margin, not a fix for a real limit). Cleaned up the 3 pre-existing `as any` casts in this file while rewriting it (Prisma's typed `InvoiceStatus[]`/`Role[]` need no cast once the query shape is right).
**Found and fixed while verifying live:** `src/middleware.ts` returned its own 401 for `/api/cron/reminders` *before* the route's `CRON_SECRET` check ever ran, because the request carries no NextAuth session and middleware only allowlists `/login`, `/api/auth/**`, `/api/health`. Both failure modes produced the identical `{"error":"Unauthorized"}` body, so this was only caught by curling the running route with the right secret and getting 401 anyway — `tsc`/tests never would have caught it, since middleware and the route are two independent auth checks that both happen to fail the same way. Added `/api/cron/**` to middleware's public-route allowlist (the route still authenticates itself via `CRON_SECRET` — middleware just needed to stop pre-empting it).
**Why:** Required for the Vercel deployment target — see `docs/PRODUCTION_PLAN.md` §4.2.
**Verified live, not just compiled:** ran the actual Next.js dev server (not just `tsc`/`next build`) and curled `/api/cron/reminders` — confirmed 401 with no/wrong `CRON_SECRET`, 200 with the correct one, and that a second immediate call creates 0 new notifications (24h dedup working against real DB rows). Also logged in via the real NextAuth credentials flow as `GA_MANAGER` and `GA_STAFF` to confirm the Phase 13 role changes actually hold end-to-end (GA_MANAGER: 200 on `/api/audit` and `/api/chat`; GA_STAFF: 403 on both) — not just that the code compiles.

### 2026-07-26 — Role model simplified from 7 to 4 (dropped MANAGER/FINANCE/VIEWER)
**What:** `prisma/schema.prisma` `Role` enum reduced to `ADMIN`, `GA_STAFF`, `GA_MANAGER`, `VENDOR`. New migration `20260726171012_simplify_roles` (hand-written, applied and verified against the local dev DB): remaps any existing `MANAGER`/`FINANCE`/`VIEWER` rows to `GA_STAFF` as a safety net, then swaps the Postgres enum type (`CREATE TYPE Role_new` → `ALTER TABLE ... TYPE` → `DROP TYPE` → rename). `FINANCE`'s six responsibilities were redistributed rather than dropped: create/upload/status-change invoices and audit-log access now go to `GA_STAFF`+`GA_MANAGER` (previously `GA_STAFF` alone lacked audit access, `GA_MANAGER` had neither); the invoice `PATCH` route's `allowedFields()` switch folds `GA_MANAGER` into the existing `GA_STAFF` case rather than keeping a separate `FINANCE` branch, since `isEditor` already generalizes to "whoever created this invoice" regardless of role name. `GA_MANAGER` also keeps sole (with `ADMIN`) access to `POST /api/chat` — narrowed from "every role except VENDOR". Reminder-scheduler recipients (`FINANCE`,`GA_STAFF` → `GA_STAFF`,`GA_MANAGER`) updated inline; the file itself is due for a full rewrite when the Vercel Cron + `ReminderSetting` work lands, so its two remaining `as any` casts were left for that pass rather than touched twice. Updated every `requireRole()`/Zod-enum call site (`chat`, `invoices`, `invoices/[id]`, `invoices/[id]/upload`, `audit`, `users`, `users/[id]`, `validations.ts`), all UI role lists/badges (`Sidebar.tsx`, `TopBar.tsx`, `audit/page.tsx`, `admin/users/page.tsx`, `invoices/page.tsx`, `invoices/upload/page.tsx`, `invoices/[id]/page.tsx`, login demo-account list), `prisma/seed.ts` (6 users now, `finance@`/`manager@`/`viewer@` demo accounts removed), and `src/lib/auth/__tests__/rbac.test.ts` (8 cases rewritten for the 4-role matrix). Replaced the `Sidebar`/`TopBar` `?? 'VIEWER'` fallback — used while the session is still loading — with an explicit loading state (empty nav / neutral badge) instead of falling back to any real role, since a fallback role would render nav items or badge colors the user may not actually be permitted to see. `Sidebar.tsx` also gained two nav entries (`/admin/companies`, `/admin/reminders`) for pages landing in follow-up commits. Docs updated: `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/SETUP.md`.
**Why:** User decision — the only roles actually in use across the org are Admin, GA Staff, GA Manager, and Vendor; `MANAGER` and `VIEWER` were already dead (deprecated, read-only, no distinct capability), and `FINANCE` was real but its responsibilities belonged with GA Staff/GA Manager once payment tracking moves in-house. Full plan: `docs/PRODUCTION_PLAN.md` §4.9. Verified against a live Postgres instance (not just `tsc`) — migration applied cleanly, `prisma/seed.ts` reseeded successfully, all 35 existing tests pass, and a full `next build` (same pipeline Vercel runs) succeeds.
**Not Stored / no schema change beyond the enum:** no new columns — this commit only removes enum values and redistributes existing route/UI permission checks.

### 2026-07-16 — Three manual-QA fixes: resubmit ownership, PIC privacy, UI copy
**What:** (1) `PATCH /api/invoices/[id]` now rejects `REVISION → SUBMITTED` from `GA_STAFF` (403 "Only the vendor can resubmit a revision") — fixing/resubmitting is the vendor's job even though `GA_STAFF` can create invoices; frontend `canResubmit` matches (`VENDOR` owner or `ADMIN` only), and `isOwner` was also fixed to compare `vendor.id` (company-level) instead of `createdBy.id` (single-user), matching the backend's own ownership check. (2) `GET /api/invoices/[id]` now forces `pic: null` for `VENDOR` callers — PIC (the GA Staff handling the hardcopy) is internal-only; the frontend read-only PIC line is hidden for `VENDOR` too. (3) Removed the "Line item tidak bisa diubah di sini..." note from the Fix & Resubmit card.
**Why:** User-reported during manual QA (screenshot showed `GA_STAFF` seeing the resubmit form after setting a status themselves) — the resubmit-ownership and PIC-visibility issues were real gaps versus the app's role model; the copy removal was a UX preference.

### 2026-07-15 — Added the missing Fix & Resubmit form for REVISION invoices
**What:** `invoices/[id]/page.tsx`'s "Resubmit" button previously only sent `{status: 'SUBMITTED'}` with no way to actually correct anything — `PATCH /api/invoices/[id]` already allowed `VENDOR` (owner) to edit `invoiceNumber`/`invoiceDate`/`dueDate`/`subtotal`/`taxAmount`/`totalAmount`/`notes` while `status = REVISION`, but no frontend form existed for it. Added editable inputs for those fields, submitted together with `status: 'SUBMITTED'` in one `PATCH`. Line items are explicitly not editable here (noted in the UI) — that would need a separate line-item editor, out of scope for this fix.
**Why:** User asked how a vendor is supposed to fix a `REVISION` invoice — answer was "there's no way yet," a real gap versus this plan's own locked decision ("Vendor may edit the same fields during REVISION as they can at creation time").

### 2026-07-15 — Invoice list navigation didn't reach the editable detail page
**What:** `invoices/page.tsx` row click opened the read-only `InvoiceDetailDrawer` instead of navigating to `/invoices/[id]`, so the Update Status / Delivery & PIC editing cards added in the status-lifecycle work were unreachable. Rows now `router.push()` to the full detail page; `InvoiceDetailDrawer.tsx` (now fully unused) and its test were deleted.
**Why:** User-reported via screenshot during manual QA — confirmed the underlying card code was correct, the bug was pure navigation.

### 2026-07-15 — Two bugs found during manual QA of the invoice workflow overhaul
**What:** (1) `ai-service/main.py` now calls `load_dotenv()` before the FastAPI app/router imports — `python-dotenv` was already a listed dependency but nothing invoked it, so `ai-service/.env` never reached `os.environ`, causing every OCR/chat call to fail with a `GROQ_API_KEY` error even though `uvicorn` itself started fine. (2) `invoices/upload/page.tsx` review step gets a PIC dropdown for `GA_STAFF` uploaders (sourced from `GET /api/users?role=GA_STAFF`, defaults to self, submitted via the existing `PATCH /api/invoices/[id]` `picId` field) — previously only `VENDOR` got a Send Date input at this step, `GA_STAFF` had no way to assign/reassign PIC during upload at all.
**Why:** User-reported during manual verification of the previous commits (see Phase 9 in the Commit Log below).

### 2026-07-15 — Structured `docs/` reference created
**What:** Added `docs/INDEX.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/SETUP.md`, `docs/CHANGELOG.md` (this file). Fixed a stale port reference in the root `README.md` (said Postgres runs on 5432; `docker-compose.yml` maps it to 5434 as of commit `a56ffcd`).
**Why:** `CLAUDE.md` requires every change to be documented in `docs/` with API response fields traced to their `table.column`/formula source, but no `docs/` directory existed yet — all project knowledge lived only in the root `README.md` (demo pitch) and `memory.md` (freeform dev notes), neither of which is organized for that traceability requirement. This reconstructs a structured reference from the current codebase and full commit history.
**Not stored / no schema change:** documentation only, no code or migration touched.

### 2026-07-15 — Renamed docs index file, untracked CLAUDE.md
**What:** Renamed `docs/README.md` → `docs/INDEX.md` (updated the two references that pointed at it, in the root `README.md` and here). Committed the pre-existing uncommitted `.gitignore` change (adds `AGENTS.md`, `memory.md`, `CLAUDE.md` to ignore list) and removed `CLAUDE.md` from git tracking (`git rm --cached`, file kept on disk) to match `AGENTS.md`/`memory.md`, which were already untracked.
**Why:** User preference — avoid a second `README.md` inside `docs/` (ambiguous alongside the root one), and finish untracking the AI-assistant instruction files consistently now that `.gitignore` covers all three.

### 2026-07-15 — Fixed stale Postgres port reference (5434 → 5433)
**What:** `docker-compose.yml` already mapped Postgres to host port 5433 (uncommitted local change predating this session); `README.md` and `docs/SETUP.md` still said 5434. Corrected both to match the actual running port (verified via `docker ps`/`.env`).
**Why:** Pure documentation-accuracy fix, unrelated to any feature work — grouped as its own commit per `CLAUDE.md`'s "split unrelated changes into separate commits".
**Not Stored:** config/docs only, no schema or code logic touched.

### 2026-07-15 — Invoice status pipeline replaced: Submitted/Cancelled/Rejected/Void/Revision
**What:** Dropped the in-app 2-step `ApprovalWorkflow` (`ApprovalStatus` enum, `/api/approvals/**`, `/approvals` page) and the old 6-status pipeline (`PENDING_OCR/PENDING_REVIEW/PENDING_APPROVAL/APPROVED/REJECTED/PAID`). New `InvoiceStatus`: `SUBMITTED/CANCELLED/REJECTED/VOID/REVISION`, set via `VALID_TRANSITIONS` (`src/lib/validations.ts`). Added `Invoice.sendDate`/`deliveredDate`/`picId` for GA Staff hardcopy tracking (`validateDeliveryDates()` enforces `deliveredDate ≥ sendDate`). `PATCH /api/invoices/[id]` rewritten with a per-role/per-status field-permission matrix (`allowedFields()`) replacing the flat `requireRole(['FINANCE','ADMIN'])` gate; `POST /api/invoices`/`upload` now also allow `GA_STAFF`. OCR route no longer changes `status`. Frontend: `StatusBadge`/`StatusDonut` relabeled; invoice detail/list/upload pages and `InvoiceDetailDrawer` updated (approval UI replaced with Update Status + Delivery & PIC cards); `reminderScheduler.ts`/`format.ts` updated to the new open-status set (`SUBMITTED`/`REVISION`). New migration `20260715171000_invoice_workflow_overhaul` (hand-written — `prisma migrate dev` refuses non-interactive environments), applied by the user via `npx prisma migrate reset --force`. `prisma/seed.ts` rewritten for the new status set + delivery/PIC demo data. New `src/lib/__tests__/validations.test.ts`; `InvoiceDetailDrawer.test.tsx` updated. See `docs/DATABASE.md`, `docs/API.md`, `docs/ARCHITECTURE.md#invoice-status-lifecycle` for field-source tracing.
**Why:** User request — the real physical process is a vendor/GA-Staff submitting an invoice, GA Staff forwarding the hardcopy to Finance outside the app, and someone later recording the outcome; the old approval workflow modeled a process the app doesn't actually own, and `PAID` was meaningless since Finance never pays through the system. Full decision trail: `/Users/harioprakoso/.claude/plans/okee-jadi-sekarang-fokus-luminous-nest.md`.

### 2026-07-15 — Dashboard Excel export
**What:** New `GET /api/dashboard/export`, generates a two-sheet `.xlsx` (KPI Summary + full invoice list) via `exceljs`, streamed on demand, nothing persisted. Extracted the dashboard aggregation query logic into `src/lib/services/dashboardStats.ts` so `GET /api/dashboard` and the new export route compute identical numbers from one place (also renames the response field `pendingApprovalCount` → `openCount`, since the approval concept no longer exists). Dashboard page gets an "Export to Excel" link.
**Why:** Requested feature — export dashboard report to Excel. New dependency `exceljs` was explicitly approved by the user before installing, per `CLAUDE.md`'s "ask before adding new dependencies" rule.

### 2026-07-15 — Admin user management (create user, edit role)
**What:** New `GET/POST /api/users`, `PATCH /api/users/[id]` (create named accounts, edit role, `ADMIN`-only for writes; broader read for the PIC dropdown), using `createUserSchema` (bcrypt hash, `vendorId` required when `role=VENDOR`, added to `validations.ts` in the previous commit). New `/admin/users` page: user table with inline role edit + a create-user form.
**Why:** Requested feature — admin needs a way to create real named per-person accounts (previously only 8 hardcoded demo/role accounts existed) and change any user's role.

### 2026-07-15 — Removed VENDOR access to the AI chat
**What:** `POST /api/chat`: `requireAuth()` → `requireRole([...])` excluding `VENDOR` (previously no role check at all — any authenticated user, VENDOR included, could use it).
**Why:** Requested — take the AI chat feature out of the vendor role.

### 2026-07-15 — Wired up Sidebar/TopBar for the new routes and permissions
**What:** `Sidebar.tsx`: removed the `/approvals` nav entry (feature removed), added `GA_STAFF` to the Upload Invoice entry's roles, removed `VENDOR` from the AI Assistant entry, added a new ADMIN-only User Management entry (`/admin/users`). `TopBar.tsx`: removed the `/approvals` page-title mapping, added `/admin/users`.
**Why:** Navigation plumbing for the four preceding feature commits (status lifecycle, Excel export, admin RBAC, chat lockdown) — grouped as its own commit since `Sidebar.tsx`/`TopBar.tsx` are directly related to each other (both navigation shell components) but not tightly coupled to any single one of those features individually.

### 2026-07-15 — Dashboard page: Export to Excel link, Open Invoices card
**What:** `src/app/(dashboard)/page.tsx`: added an "Export to Excel" link (`<a href="/api/dashboard/export" download>`, native browser download, no client-side fetch/blob needed) next to the page header; renamed the 4th KPI card from "Pending Approval"/`pendingApprovalCount` to "Open Invoices"/`openCount`, matching the API field renamed in the Excel-export commit.
**Why:** Completes the two preceding commits (Excel export, status lifecycle) on the frontend — accidentally left uncommitted when those landed.

### Phase 11 — Production-readiness plan execution: role simplification, payment tracking, Company/Vendor/Reminder features
| Commit | Date | Message |
|---|---|---|
| `cd753a6` | 2026-07-26 | fix: remove duplicate const url declaration blocking build |
| `5c19eb6` | 2026-07-26 | docs: add production readiness plan |
| `d0627ec` | 2026-07-26 | refactor: simplify role model from 7 to 4 roles |
| `d1e46f7` | 2026-07-26 | refactor: replace node-cron with Vercel Cron for reminders |
| `117302b` | 2026-07-26 | refactor: notification bell polls instead of holding an SSE stream |
| `d4e6b1c` | 2026-07-26 | refactor: rate limiter uses lazy sweep instead of setInterval |
| `6c8e47a` | 2026-07-26 | chore: downgrade local dev Postgres image from pgvector to plain |
| `7764daa` | 2026-07-26 | feat: add payment tracking (PAID status) |
| `bc92958` | 2026-07-26 | feat: add Company model for vendor bill-to selection (3c/3d) |
| `7889ba2` | 2026-07-26 | feat: vendor profile self-service editing (3e) |
| `a067057` | 2026-07-26 | feat: force password change for admin-created accounts (3a) |
| `3f32262` | 2026-07-26 | feat: admin-editable reminder settings (3f) |

### Phase 12 — Supabase Storage, Gemini OCR/chat, Resend email; CI
| Commit | Date | Message |
|---|---|---|
| `ec0eee2` | 2026-07-26 | chore: add GitHub Actions CI running tsc/lint/test |
| `a37d4fb` | 2026-07-26 | feat: Supabase Storage, Gemini OCR/chat, Resend email; retire ai-service |
| `6681d1a` | 2026-07-26 | docs: record commit log entries for CI and the AI-service migration |

### Phase 13 — Merged to main, deploy prep fixes
`feat/deploy-ready` fast-forward merged into `main` at `27745ba` (no merge commit — main had no divergent commits) and pushed; `main` is now the deploy branch for the fresh Vercel/Supabase project.
| Commit | Date | Message |
|---|---|---|
| `f7c8a27` | 2026-07-26 | chore: gitignore .agents/ and skills-lock.json |
| `7d2e2e4` | 2026-07-26 | docs: document DIRECT_URL and clarify CRON_SECRET behavior on Vercel |
| `27745ba` | 2026-07-26 | chore: remove obsolete version key from docker-compose.yml |
| `4e03b10` | 2026-07-27 | fix: load .env.local in prisma.config.ts and seed.ts, not just .env |

## Commit Log

Full history of `main` (current branch — `feat/deploy-ready` was fast-forward merged into it at `27745ba`, see Phase 13), grouped by phase. Older deploy attempts live on separate branches (`deploy/option-a`, `deploy/option-b`, `chore/cleanup-tracked-files`) with their own merge commits, omitted here.

### Phase 0 — Scaffold
| Commit | Date | Message |
|---|---|---|
| `f73db86` | 2026-06-09 | Initial commit from Create Next App |

### Phase 1 — Core MVP build
| Commit | Date | Message |
|---|---|---|
| `8c01a15` | 2026-06-09 | feat: initial AI-powered invoice tracking system (demo MVP) |
| `1aefd2c` | 2026-06-09 | docs: add project conventions to CLAUDE.md |
| `a152127` | 2026-06-09 | feat(task-13): invoice detail page with PDF viewer and approval timeline |
| `4efa80c` | 2026-06-09 | feat(task-14): approval queue page with role-based cards and optimistic UI |
| `133a55f` | 2026-06-09 | feat(task-15): reminders page with filter tabs and per-notification read actions |
| `3d1f56c` | 2026-06-09 | feat(task-16): chatbot, audit log, page transitions, and AI chat service |
| `78d41a4` | 2026-06-09 | docs: rewrite README with 5W 1H structure for clarity |
| `3634b11` | 2026-06-09 | fix: address 7 code-review findings (security, correctness, cleanup) |
| `7ac71bc` | 2026-06-09 | fix: pass icon as ReactNode to resolve RSC boundary crash on dashboard |
| `90dae5d` | 2026-06-09 | fix: update gemini model to gemini-2.0-flash and add groq support note |
| `3545fb5` | 2026-06-09 | fix: guard approvals array against undefined in InvoiceDetailDrawer |

### Phase 2 — Dark mode, accessibility, UX polish
| Commit | Date | Message |
|---|---|---|
| `b15ce14` | 2026-06-10 | fix: sidebar highlights only the exact active nav item |
| `b6f854d` | 2026-06-10 | fix: sidebar active state — exact nav match blocks parent prefix highlight |
| `f40e1da` | 2026-06-10 | fix(a11y): address critical accessibility issues from UI review |
| `ed6bd5b` | 2026-06-10 | fix(ux): address high and medium priority UI/UX issues |
| `b21e823` | 2026-06-10 | fix(polish): improve UI details and visual clarity |
| `65c405d` | 2026-06-10 | feat(theme): add dark mode support with toggle |
| `bf45259` | 2026-06-10 | feat(theme): wire dark mode classes to shell components |
| `5d6b1e6` | 2026-06-10 | Add dark mode variants to InvoiceDetailDrawer component |
| `e56f592` | 2026-06-10 | Add comprehensive project memory.md documentation |
| `84abd91` | 2026-06-10 | Complete dark mode for dashboard and InvoiceDetailDrawer |
| `9d6928e` | 2026-06-10 | Fix dark mode text colors across all dashboard pages |

### Phase 3 — Language consistency
| Commit | Date | Message |
|---|---|---|
| `0612241` | 2026-06-11 | Fixing inconsistent UI language |

### Phase 4 — Multi-persona RBAC (VENDOR / GA_STAFF / GA_MANAGER) + deploy prep
| Commit | Date | Message |
|---|---|---|
| `51bc652` | 2026-06-18 | feat: add VENDOR, GA_STAFF, GA_MANAGER roles and vendor-user link |
| `dc87d56` | 2026-06-18 | feat: migrate to bcrypt, add vendorId to JWT, seed new personas |
| `8b880fc` | 2026-06-18 | feat: RBAC updates for vendor/GA personas with IDOR protection |
| `9f432b5` | 2026-06-18 | feat: update frontend for new personas |
| `cd53dfc` | 2026-06-18 | test: add RBAC tests for new roles and vendor isolation |
| `7460e07` | 2026-06-18 | docs: update memory.md with Phase 9 multi-persona changes |
| `7336cd3` | 2026-06-18 | feat: update login page demo accounts to show all 6 personas |
| `16120a8` | 2026-06-18 | chore: untrack files covered by .gitignore |
| `15e593b` | 2026-06-18 | chore(deploy): option-a vercel prep |
| `ab522b8` | 2026-06-18 | Prepare deployment |

### Phase 5 — Supabase SSL fixes, dashboard dark-mode completion
| Commit | Date | Message |
|---|---|---|
| `da12472` | 2026-06-19 | fix: disable SSL cert verification via env var for Supabase pooler |
| `ee4298c` | 2026-06-19 | fix: use explicit pg Pool to pass SSL options to Prisma adapter |
| `880802f` | 2026-06-19 | fix: use explicit pg Pool to bypass sslmode URL param for Supabase |
| `6e82560` | 2026-06-19 | ui: fix dark mode across KPICard, StatusBadge, TopBar, login page; polish KPI card design |

### Phase 6 — Production hardening: security, validation, docs discipline
| Commit | Date | Message |
|---|---|---|
| `c6f78c4` | 2026-06-25 | docs: add working rules for commit discipline and safety |
| `cc3e443` | 2026-06-25 | chore: un-track local AI tool config and expand gitignore |
| `af7370c` | 2026-06-25 | fix: add Zod validation schemas to invoice API routes |
| `9bae8ea` | 2026-06-25 | fix: sanitize error responses in Python AI service |
| `e2d1151` | 2026-06-25 | fix: add file magic-byte validation to upload endpoint |
| `3fb6592` | 2026-06-25 | feat: add per-user rate limiting to OCR and chat API routes |
| `dd4f708` | 2026-06-25 | feat: add Next.js health check endpoint |
| `7b55a52` | 2026-06-25 | fix: guard seed script against accidental production run |
| `6816f14` | 2026-06-25 | feat: add LLM model override, request timeout, and DeepSeek provider support |
| `6a93202` | 2026-06-25 | chore: move @types/pg to devDependencies |
| `e6c7aed` | 2026-06-25 | docs: create ai-service/.env.example with all provider configs |
| `6abc1a9` | 2026-06-25 | docs: update README with all 8 demo accounts and current approval flow |

### Phase 7 — Dependency pinning, local port fix
| Commit | Date | Message |
|---|---|---|
| `a56ffcd` | 2026-07-02 | fix: change local Postgres port from 5432 to 5434 to avoid conflicts |
| `b7ffd9e` | 2026-07-02 | chore: pin ai-service deps to compatible-release ranges, bump pydantic |

### Phase 8 — Structured docs/ reference, CLAUDE.md discipline rules committed
| Commit | Date | Message |
|---|---|---|
| `e2abc8e` | 2026-07-15 | docs: add structured docs/ reference and fix stale README port |
| `5123c3c` | 2026-07-15 | chore: gitignore and untrack CLAUDE.md alongside AGENTS.md, memory.md |

### Phase 9 — Invoice workflow overhaul, PIC tracking, admin RBAC, Excel export, chat lockdown
| Commit | Date | Message |
|---|---|---|
| `510f452` | 2026-07-15 | fix: correct stale Postgres port reference in docs (5434 -> 5433) |
| `df8a1d3` | 2026-07-15 | feat: replace invoice approval pipeline with 5-status lifecycle |
| `7c683cc` | 2026-07-15 | feat: add dashboard Excel export via exceljs |
| `c2c5f30` | 2026-07-15 | feat: add admin user management (create user, edit role) |
| `8a3fe53` | 2026-07-15 | feat: remove VENDOR access to the AI chat |
| `d64ed16` | 2026-07-15 | feat: wire up sidebar/topbar for the new routes and permissions |
| `4c533df` | 2026-07-15 | feat: add Export to Excel link and Open Invoices card to dashboard page |

### Phase 10 — Manual-QA bugfixes
| Commit | Date | Message |
|---|---|---|
| `6319844` | 2026-07-15 | fix: load ai-service .env via python-dotenv so LLM API keys are read |
| `3d00050` | 2026-07-15 | fix: add missing PIC dropdown to the upload flow for GA_STAFF |
| `490c219` | 2026-07-15 | fix: invoice list rows now navigate to the full editable detail page |
| `b3c79be` | 2026-07-15 | feat: add Fix & Resubmit form for REVISION invoices |
| `e82d76a` | 2026-07-16 | fix: restrict revision-resubmit to vendor, hide PIC from vendor view |

### Phase 14 — Upload bugfix (stale closure)
Numbered 14, not 11, to avoid colliding with the pre-existing "Phase 11/12/13" tables above (added directly under Code Changes Made, ahead of the `## Commit Log` heading, by an earlier session — a pre-existing structural quirk in this file, left as-is rather than reorganized as part of an unrelated task).
| Commit | Date | Message |
|---|---|---|
| `04750b3` | 2026-07-27 | fix: stale closure sent empty companyId on vendor invoice upload |

### Phase 15 — Branded email template, status-change vendor notification
| Commit | Date | Message |
|---|---|---|
| `4759ea6` | 2026-07-27 | feat: branded HTML email template + notify vendor on status change |

### Phase 16 — Hide app shell during forced password change; lock chat scope
| Commit | Date | Message |
|---|---|---|
| `de78935` | 2026-07-27 | fix: hide app shell during forced password change; lock chat to invoice scope |

### Phase 17 — Invoice status workflow overhaul (17-value enum)
| Commit | Date | Message |
|---|---|---|
| `60635df` | 2026-09-01 | feat: invoice status workflow overhaul (17-value enum + VALID_TRANSITIONS) |

### Phase 18 — Duplicate-invoice auto-rejection, upload-retry orphan fix
| Commit | Date | Message |
|---|---|---|
| `eb2ee04` | 2026-09-02 | feat: duplicate-invoice auto-rejection + fix orphan row on upload retry |

### Phase 19 — Completed deferred Phase 17 frontend, i18n gap-fill, Liquid Glass redesign
| Commit | Date | Message |
|---|---|---|
| `f62cc2d` | 2026-09-02 | refactor: localize hardcoded strings in admin, chat, vendor pages |
| `2247bf5` | 2026-09-02 | feat: add PIC stage transition control, SLA timeline, and stage API |
| `a4b4bc2` | 2026-09-02 | refactor: replace dashboard donut/aging charts with trend + flow charts |
| `73b7f24` | 2026-09-02 | feat: apply Liquid Glass dark-first redesign, rebrand app to VISTA |

### Phase 20 — Multi-file attachments + AI document classification
| Commit | Date | Message |
|---|---|---|
| `0bfd116` | 2026-09-03 | feat: multi-file attachments per invoice with AI document classification |

### Phase 21 — Dashboard widgets, extra filters, stage notification
| Commit | Date | Message |
|---|---|---|
| `63f5dd8` | 2026-09-03 | feat: stage lead-time + by-company dashboard widgets, filters, stage notification |

### Phase 22 — Browser verification, OCR duplicate-check fix
| Commit | Date | Message |
|---|---|---|
| `0a3ad9e` | 2026-09-03 | fix: stop OCR writing invoiceNumber past the duplicate check |

### Phase 23 — Rebrand to SIP
| Commit | Date | Message |
|---|---|---|
| `1765ea7` | 2026-09-03 | refactor: rebrand app from VISTA to SIP (Smart Invoice & Payment) |

### Phase 24 — Whole-repo review remediation (branch `feat/prod-adjustment`)
Six batches from a cross-feature review (10 parallel finders → 8 adversarial verifiers → 32 confirmed findings). Details per batch in Code Changes Made above.

| Commit | Date | Message |
|---|---|---|
| `3e16c1c` | 2026-09-07 | fix: enforce invoice ownership on OCR write path and vendor scoping on dashboard |
| `5119cb7` | 2026-09-07 | fix: unify overdue and open-invoice definitions across dashboard, list, reminders |
| `716cf21` | 2026-09-07 | fix: parse Indonesian amount format and validate OCR output before writing |
| `dd42ae6` | 2026-09-07 | feat: add invoice date/amount constraints, hot-path indexes, and draft flag |
| `4d17da2` | 2026-09-07 | fix: correct payment lifecycle, vendor edit lock, and duplicate auto-reject |
| `0a98636` | 2026-09-07 | fix: duplicate POST conflict, stale file mirror, dashboard stall, audit page guard |
| `85fd149` | 2026-09-07 | docs: record review remediation phase in commit log and DB targeting gotcha |
| `3efe40a` | 2026-09-07 | feat: make seed UAT-ready and add production cutover runbook |
| `42ecc05` | 2026-09-08 | feat: add demo admin and split seed accounts into a four-account demo set |
| `95c41be` | 2026-09-08 | feat: one-click dev sign-in for the four demo accounts |

### Phase 25 — Document-first upload + vendor credential lockdown (branch `feat/document-first-upload`)
Cut fresh from `main`, not from `feat/prod-adjustment` (which was identical to `main` at the time). Four business decisions confirmed by the maintainer before coding, plus six implementation defaults reviewed and adjusted by them — details in Code Changes Made above.

| Commit | Date | Message |
|---|---|---|
| `b4b05c0` | 2026-09-10 | feat: extract bill-to company and PO number, add conservative company matcher |
| `d03f99d` | 2026-09-10 | feat: allow draft invoices without a PO or company, gate the draft to live step |
| `24326e0` | 2026-09-10 | feat: cap and meter document uploads, classify every file, let vendors relabel |
| `dfd829b` | 2026-09-10 | feat: pick the OCR source from classification, resolve bill-to, emit PO number |
| `108b797` | 2026-09-10 | feat: rebuild the upload wizard around documents first |
| `d9f76b6` | 2026-09-10 | feat: vendor accounts get one forced password change, then admin-only credentials |
| `3db6049` | 2026-09-10 | fix: survive a mid-batch upload failure and refuse a live invoice with no documents |

### Uncommitted / in-progress (not part of the log above)
- A stash (`stash@{0}`) exists on `main` titled "WIP on main: e6e09e8 fix: load .env in ai-service via python-dotenv so LLM API keys are read" — not applied to this branch; left untouched pending the user's direction.

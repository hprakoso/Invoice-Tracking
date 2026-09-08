# UAT & Cutover Runbook

**Dibuat:** 2026-09-07 · **Status:** siap dipakai · **Basis:** commit remediasi review (Phase 24, 6 commit)

Dokumen ini adalah **runbook operasional**: cara menyiapkan lingkungan UAT, dan urutan langkah
kalau aplikasi dilanjutkan ke produksi. Berbeda dari `PRODUCTION_PLAN.md`, yang merupakan roadmap
fitur (Fase 1–3) dan sebagian sudah usang.

Semua fakta di sini diverifikasi terhadap kode pada 2026-09-07. Yang belum diverifikasi ditandai
eksplisit.

---

## 0. Tiga keputusan yang harus diambil sebelum apa pun

| # | Keputusan | Kenapa mendesak |
|---|---|---|
| 1 | **Host produksi: tetap Vercel, atau pindah ke Cloud Run?** | Hanya Vercel yang benar-benar terpasang (`vercel.json`). Tidak ada `Dockerfile`, tidak ada `cloudbuild.yaml`, dan `next.config.ts` kosong — tanpa `output: 'standalone'` image container belum bisa dibuat. Pindah host = pekerjaan baru, bukan sakelar konfigurasi. |
| 2 | **Database & storage UAT: proyek Supabase terpisah, atau yang sama?** | Saat ini `.env.local` memakai kredensial Supabase **produksi**. Selama itu tidak dipisah, setiap upload dari mesin dev menulis objek nyata ke bucket produksi. |
| 3 | **Apakah baris negatif di `invoice_items` sah secara bisnis** (nota kredit, retensi)? | Migrasi baru memasang `CHECK (total >= 0)`. Kalau nota kredit disimpan sebagai baris negatif, constraint itu aturan yang salah dan harus dicabut — bukan datanya yang diperbaiki. |

---

## 1. Menyiapkan lingkungan UAT

### 1.1 Matriks variabel environment

Sumber kebenaran nama variabel adalah `.env.example`. Kolom "kalau hilang" diverifikasi dari kode,
bukan dari dokumen.

| Variabel | Wajib? | Kalau hilang |
|---|---|---|
| `DATABASE_URL` | **Ya** | Fallback ke `localhost:5433`. Di produksi artinya gagal konek dengan pesan yang menyesatkan. |
| `NEXTAUTH_SECRET` (atau `AUTH_SECRET`) | **Ya** | `MissingSecret` — gagal total, tidak ada sesi. Gagal tertutup, aman. **Harus beda antar environment**, kalau sama JWT dari UAT bisa dipakai di produksi. |
| `NEXTAUTH_URL` | **Ya** | ⚠️ **Satu-satunya fail-open.** Diam-diam jatuh ke `http://localhost:3000`, dan nilai itu jadi URL tombol di **setiap email notifikasi**. Vendor menerima email dengan tautan ke localhost; tidak ada error, tidak ada log. |
| `AUTH_TRUST_HOST` | **Ya di host non-Vercel** | NextAuth menghitung `trustHost` dari `AUTH_URL`/`AUTH_TRUST_HOST`/`VERCEL`/`CF_PAGES` — `NEXTAUTH_URL` **tidak** termasuk. Di Cloud Run dengan `NODE_ENV=production`, semua request auth gagal `UntrustedHost`: login mati total sejak boot pertama. Tidak terlihat di Vercel karena Vercel menyetel `VERCEL=1` sendiri. |
| `CRON_SECRET` | **Ya** | Route cron balas 503 selamanya, tidak ada reminder terkirim, tanpa alert. Gagal tertutup (sudah diperbaiki di Phase 24). |
| `DIRECT_URL` | Untuk migrasi | Lihat §1.2 — **jebakan utama**. |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Efektif wajib di prod | Kalau salah satu hilang, upload **tetap "berhasil"** tapi menulis ke disk ephemeral. Gagal muncul belakangan, dari instance lain, sebagai ENOENT — baris invoice ada, filenya hilang. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Untuk Postgres hosted | `prisma.ts` membuang `sslmode` dari URL dan hanya mengatur TLS lewat flag ini. Satu-satunya nilai yang didukung adalah `"false"` (TLS tanpa verifikasi sertifikat). |
| `GOOGLE_API_KEY` | Opsional | OCR melempar error yang **diteruskan mentah ke browser** lewat event SSE; chat balas pesan ramah dengan HTTP 200. |
| `GEMINI_MODEL` | Opsional | Default `gemini-2.5-flash`. |
| `RESEND_API_KEY` | Opsional | `sendEmail` return lebih awal — email diam-diam no-op, notifikasi in-app tetap jalan. |
| `RESEND_FROM_EMAIL` | Opsional | Default ke alamat sandbox `onboarding@resend.dev`, yang **hanya terkirim ke pemilik akun Resend**. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Opsional | Seed memakai default `admin@vista.id` / password literal di `prisma/seed.ts`. Setel keduanya untuk UAT. |
| `DEMO_PASSWORD` | Opsional | Password untuk 6 akun demo. Default `demo1234`. |

**Harus berbeda antara UAT dan produksi:** `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET`.

### 1.2 Dua jebakan lingkungan yang aktif sekarang

**(a) Perintah Prisma menargetkan database yang berbeda dari aplikasi.**
`prisma.config.ts:17` memakai `DIRECT_URL ?? DATABASE_URL`. Di `.env.local`, `DATABASE_URL` adalah
docker lokal sementara `DIRECT_URL` adalah Supabase **produksi**. Jadi aplikasi bicara ke lokal,
tapi setiap `prisma migrate` / `db:seed` bicara ke produksi. Percobaan `migrate dev` pada 2026-09-07
melaporkan host Supabase dan menawarkan reset schema-nya.

Perbaiki di sumbernya sebelum UAT — hapus `DIRECT_URL` dari `.env.local` (simpan hanya di
environment deploy), atau balik prioritasnya di `prisma.config.ts`. Selama belum:

```bash
LOCAL_DB=$(grep -m1 "^DATABASE_URL=" .env.local | cut -d= -f2-)
case "$LOCAL_DB" in *localhost:5433*) : ;; *) echo "ABORT"; exit 1;; esac
DIRECT_URL="$LOCAL_DB" DATABASE_URL="$LOCAL_DB" npx prisma migrate deploy
```

**(b) Upload file masuk ke bucket Supabase produksi walau database-nya lokal.**
`fileService.ts` memilih Supabase kalau `SUPABASE_URL` **dan** `SUPABASE_SERVICE_ROLE_KEY` terisi,
tanpa melihat `DATABASE_URL` sama sekali. Untuk UAT: arahkan ke proyek/bucket terpisah, atau
kosongkan keduanya supaya upload jatuh ke disk lokal.

> Catatan: `prisma/seed.ts` sekarang menolak berjalan terhadap host non-lokal kecuali
> `SEED_ALLOW_REMOTE=yes-i-know` disetel. Guard lamanya (`NODE_ENV === 'production'`) tidak pernah
> menyala karena `npx tsx` tidak menyetel `NODE_ENV` — artinya `npm run db:seed` dengan
> `DATABASE_URL` produksi **akan menghapus produksi**.

### 1.3 Menyiapkan database UAT

```bash
# 1. Terapkan seluruh migrasi (14 migrasi)
DIRECT_URL="$UAT_DB" DATABASE_URL="$UAT_DB" npx prisma migrate deploy

# 2. Isi data uji — MENGHAPUS seluruh tabel lebih dulu
SEED_ALLOW_REMOTE=yes-i-know \
DIRECT_URL="$UAT_DB" DATABASE_URL="$UAT_DB" \
ADMIN_PASSWORD='<password-uat>' DEMO_PASSWORD='<password-demo-uat>' \
npm run db:seed
```

### 1.4 Akun dan data uji yang tersedia

Seed menghasilkan **8 akun** (sebelumnya hanya 1, sehingga tidak ada satupun layar role-gated yang
bisa diuji). Empat pertama adalah set demo utama — semuanya memakai `DEMO_PASSWORD` yang sama, jadi
satu kredensial cukup untuk seluruh walkthrough:

| Email | Role | Untuk menguji |
|---|---|---|
| `admin@sip.id` | ADMIN | Bypass transition graph, koreksi status, hard delete |
| `gastaff@sip.id` | GA_STAFF | Antrian GA, PIC, cabang `isEditor` |
| `vendor@sip.id` | VENDOR **A** (PT Maju Jaya Abadi) | Portal vendor, kunci edit vendor |
| `vendor2@sip.id` | VENDOR **B** (CV Teknologi Nusantara) | **Isolasi lintas tenant** — buka id invoice milik Vendor A dari akun ini |

Tiga akun tambahan, ada semata-mata supaya skenario tertentu punya baris awal:

| Email | Role | Untuk menguji |
|---|---|---|
| `gamanager@sip.id` | GA_MANAGER | Log audit, cabang non-editor |
| `nonaktif@sip.id` | GA_STAFF (isActive=false) | Penolakan login akun nonaktif |
| `gantipassword@sip.id` | GA_STAFF (mustChangePassword) | Redirect ganti password wajib |

Di luar itu ada `admin@vista.id`, admin bootstrap, yang memakai **`ADMIN_PASSWORD`** — rahasia yang
berbeda dan jauh lebih panjang. Itulah sebabnya tombol dev di halaman login sekarang menawarkan
`admin@sip.id`, bukan akun bootstrap: tombol yang paling mungkin diklik dulu justru mengisi akun
yang password-nya tidak dipegang siapa pun yang menjalankan demo.

Data invoice: **105 baris** — 100 acak + 5 kasus batas eksplisit.

| Invoice | Untuk menguji |
|---|---|
| `UAT-DUE-TODAY` | Jatuh tempo hari ini **tidak** boleh terhitung terlambat, dan masuk jendela due-soon |
| `UAT-DUE-TOMORROW` | Sisi lain batas |
| `UAT-OVERDUE-1D` | Terlambat paling minimum |
| `UAT-NO-DUEDATE` | Bucket "Tanpa jatuh tempo" di panel aging |
| `UAT-DRAFT` | Draft harus tak terlihat di KPI, list, export, reminder — tapi tetap bisa dibuka lewat id |

Cakupan lain yang sudah dipastikan ada: **17 dari 17 status** (sebelumnya 13), satu vendor nonaktif,
satu perusahaan nonaktif, `picId` menunjuk ke GA_STAFF asli (sebelumnya semua ke admin, sehingga
filter PIC selalu kosong), dan `createdById` tersebar ke tiga akun internal supaya kedua cabang izin
GA bisa dicapai.

**Belum ada di seed** (perlu dibuat manual saat UAT): `InvoiceDocument` (panel dokumen kosong di
semua invoice — butuh upload sungguhan), baris `Notification` dan `AuditLog` (menumpuk sendiri
begitu tester beraksi).

### 1.5 Skenario UAT wajib

Delapan skenario ini memetakan langsung ke perbaikan Phase 24. Yang bertanda ⚠️ adalah regresi yang
pernah benar-benar terjadi.

1. ⚠️ **Batas jatuh tempo.** Buka daftar invoice. `UAT-DUE-TODAY` tidak boleh bertanda Terlambat;
   `UAT-OVERDUE-1D` harus. Angka KPI Overdue harus sama dengan jumlah baris bertanda Terlambat.
2. ⚠️ **Rekonsiliasi dashboard.** Jumlah semua bucket aging harus persis sama dengan Total Tagihan.
   Chip "Terlambat" di panel aging harus sama dengan kartu KPI Overdue.
3. ⚠️ **Filter status.** Filter dashboard ke PAID → Overdue harus 0 dan Total Tagihan harus 0.
4. ⚠️ **Isolasi lintas tenant.** Login `vendor2@sip.id`, buka URL detail invoice milik
   `vendor@sip.id` → harus 403. Dashboard dan export hanya berisi invoice sendiri.
5. ⚠️ **Format uang.** Di layar review OCR, ketik `1.500.000` pada kolom total → tersimpan
   Rp 1.500.000, **bukan** Rp 1,5.
6. **Kunci edit vendor.** Sebagai vendor, coba ubah total invoice berstatus FINANCE_VERIFICATION →
   harus ditolak. Pada status RECEIVED → harus boleh.
7. **Pembayaran.** Tandai lunas dengan jumlah kurang dari total → harus ditolak. Dengan jumlah pas →
   berhasil. Lalu sebagai ADMIN pindahkan statusnya keluar dari PAID → panel Pembayaran harus hilang.
8. **Draft.** Mulai wizard upload, tinggalkan sebelum konfirmasi. Baris itu tidak boleh muncul di
   dashboard, list, export, maupun email reminder.

Cron reminder bisa dipicu manual — jangan menunggu jadwalnya (jitter Vercel sampai 60 menit):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host-uat>/api/cron/reminders
```

---

## 2. Cutover ke produksi

Bagian ini **belum pernah dijalankan** terhadap database produksi. Semua kueri di bawah bersifat
baca-saja kecuali ditandai lain.

### 2.1 Pre-flight — jalankan sebelum jendela maintenance

Migrasi `20260907000000_invoice_integrity_constraints` sengaja **gagal keras** kalau ada data yang
melanggar, alih-alih menimpa data finansial diam-diam. Cari dulu barisnya:

```sql
-- Q1. Pasangan tanggal mustahil. Pakai date_trunc, bukan perbandingan mentah:
-- constraint dipasang SETELAH normalisasi tanggal, jadi pasangan yang hanya beda
-- jam dalam hari yang sama akan sembuh sendiri dan tidak boleh ikut dihitung.
SELECT id, invoice_number, invoice_date, due_date FROM invoices
WHERE date_trunc('day', due_date) < date_trunc('day', invoice_date);

-- Q2. Nominal negatif
SELECT id, invoice_number, total_amount, subtotal, tax_amount, paid_amount FROM invoices
WHERE total_amount < 0 OR subtotal < 0 OR tax_amount < 0 OR paid_amount < 0;

-- Q3. Baris item negatif (lihat keputusan #3 di §0)
SELECT ii.id, i.invoice_number, ii.description, ii.total
FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.total < 0;

-- Q4. Invoice sah yang nomornya kebetulan diawali DRAFT- (akan disembunyikan
-- dari semua KPI oleh backfill is_draft)
SELECT id, invoice_number, status, total_amount FROM invoices WHERE invoice_number LIKE 'DRAFT-%';

-- Q5. Tanggal dengan komponen jam >= 17:00 UTC. Hanya baris ini yang maknanya
-- berubah saat date_trunc dijalankan (17:00Z ke atas = hari berikutnya di WIB).
SELECT id, invoice_number, due_date, paid_date FROM invoices
WHERE due_date::time >= '17:00' OR paid_date::time >= '17:00';

-- Q6. Ukuran tabel — menentukan perlu CONCURRENTLY atau tidak
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables
WHERE relname IN ('invoices','invoice_items','audit_logs','notifications','invoice_stage_history');
```

**Aturan keputusan:** Q1/Q2/Q3 harus kosong sebelum apply. Kalau tidak, perbaiki barisnya lebih
dulu (atau, untuk Q3, cabut constraint-nya kalau nota kredit memang sah). Q4 diperiksa dengan mata;
kalau ada invoice sungguhan yang cocok, tambahkan `AND status = 'RECEIVED'` pada baris 19 migrasi.

### 2.2 Backup dan pre-image

Normalisasi tanggal **menghapus jam aslinya secara permanen**. Rollback schema tidak mengembalikannya.

```sql
-- Jalankan sebagai langkah pertama di jendela maintenance (INI MENULIS)
CREATE TABLE invoices_dates_backup_20260907 AS
SELECT id, invoice_date, due_date, send_date, delivered_date, paid_date FROM invoices;
```

Pastikan juga ada backup/PITR terverifikasi tepat sebelum apply.

### 2.3 Menerapkan migrasi

Prisma **tidak** membungkus migrasi PostgreSQL dalam transaksi secara default, dan file ini tidak
memakai opt-in `BEGIN;`/`COMMIT;`. Kalau CHECK di baris 53 gagal, tiga statement pertama (kolom
baru, backfill draft, normalisasi tanggal) sudah terlanjur commit, migrasi tercatat gagal, dan
**semua deploy berikutnya diblokir** sampai diselesaikan manual.

Dua pilihan:

**Opsi A — tabel kecil (< ~100k baris), paling sederhana.** Terapkan di dalam transaksi eksplisit:

```bash
psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
\i prisma/migrations/20260907000000_invoice_integrity_constraints/migration.sql
COMMIT;
SQL
npx prisma migrate resolve --applied 20260907000000_invoice_integrity_constraints
```

**Opsi B — tabel besar, tanpa memblokir tulis.** Bangun sembilan indeks lebih dulu di luar migrasi,
lalu pasang constraint sebagai `NOT VALID` dan validasi terpisah:

```sql
-- CONCURRENTLY tidak boleh di dalam transaksi; jalankan satu per satu
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_status_due_date_idx ON invoices(status, due_date);
-- ... delapan indeks lainnya, lihat migration.sql baris 74-82

-- Constraint: NOT VALID hanya mengunci sebentar, VALIDATE tidak memblokir tulis
ALTER TABLE invoices ADD CONSTRAINT invoices_due_date_after_invoice_date
  CHECK (due_date IS NULL OR invoice_date IS NULL OR due_date >= invoice_date) NOT VALID;
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_due_date_after_invoice_date;
```

Lalu jalankan sisa migrasi (kolom + dua UPDATE) dan tandai `migrate resolve --applied`.

> `CREATE INDEX` biasa mengambil lock SHARE: baca tetap jalan, tapi **semua INSERT/UPDATE/DELETE
> pada tabel itu memblokir** sampai build selesai, dan kesembilan build berjalan berurutan.
> `audit_logs` dan `notifications` sangat sering ditulis — memblokirnya membekukan seluruh aplikasi.

### 2.4 Rollback

**Rollback hanya mengembalikan schema, bukan data.**

```sql
ALTER TABLE invoices      DROP CONSTRAINT IF EXISTS invoices_due_date_after_invoice_date;
ALTER TABLE invoices      DROP CONSTRAINT IF EXISTS invoices_amounts_non_negative;
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_total_non_negative;
DROP INDEX IF EXISTS invoices_status_due_date_idx, invoices_vendor_id_idx, invoices_company_id_idx,
  invoices_created_at_idx, invoice_stage_history_invoice_id_changed_at_idx,
  audit_logs_entity_type_entity_id_idx, audit_logs_created_at_idx,
  notifications_user_id_is_read_idx, notifications_type_created_at_idx;
ALTER TABLE invoices DROP COLUMN IF EXISTS is_draft;
```

Yang **tidak** kembali: jam pada kolom tanggal (pakai `invoices_dates_backup_20260907`), dan flag
`is_draft` yang sudah terlanjur menyembunyikan baris kalau kolomnya dipertahankan.

Kalau migrasi tercatat gagal:

```bash
# setelah membatalkan manual apa yang sempat masuk
npx prisma migrate resolve --rolled-back 20260907000000_invoice_integrity_constraints
# atau, setelah menyelesaikannya manual
npx prisma migrate resolve --applied     20260907000000_invoice_integrity_constraints
```

### 2.5 Smoke test setelah deploy

1. Login berhasil (kalau gagal `UntrustedHost` → `AUTH_TRUST_HOST` belum diset).
2. Dashboard tampil, jumlah bucket aging = Total Tagihan.
3. Upload satu file, buka lagi dari instance lain (membuktikan storage bukan disk ephemeral).
4. Picu cron manual dengan header Bearer → harus 200, bukan 503, dan baris `notifications` bertambah.
5. Kirim satu email reminder uji → periksa tautan tombolnya menunjuk ke host produksi, bukan
   localhost, dan pengirimnya bukan `onboarding@resend.dev`.
6. `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` → harus kosong.

---

## 3. Item terbuka (bukan blocker UAT)

| Item | Catatan |
|---|---|
| Rotasi password admin | String `dJLrXlooGsBsGcNJ` ada di history git. Untuk demo tidak masalah (keputusan maintainer 2026-09-07); **wajib** diganti sebelum produksi. |
| Agregat KPI campur mata uang | Currency sudah divalidasi, tapi tidak ada pengelompokan per-currency. Aman selama semua IDR. |
| Paginasi `GET /api/invoices` | `items` sudah tidak ikut dikirim; paginasi sungguhan butuh perubahan UI list. |
| Signed URL untuk file | Belum dikerjakan — satu-satunya item §4.1 `PRODUCTION_PLAN.md` yang benar-benar masih terbuka. File masih di-stream lewat function. |
| `maxDuration` hanya di `vercel.json` | Pindah ke `export const maxDuration` di route kalau host berubah, kalau tidak batas 30s/60s hilang diam-diam. |
| CI tidak menjalankan `next build` | Kegagalan build baru ketahuan di Vercel. Pertimbangkan menambah `npm run build` dan job migrasi ke Postgres sekali pakai. |
| Rate limit per-instance | Sudah diterima sebagai risiko di `PRODUCTION_PLAN.md`. Tinjau ulang hanya kalau kuota Gemini benar-benar habis. |
| `seed-demo-users.ts`, `check-demo-users.ts` | Sudah gitignored. Akun demo kini ada di `prisma/seed.ts`, jadi kedua skrip itu bisa dihapus. |

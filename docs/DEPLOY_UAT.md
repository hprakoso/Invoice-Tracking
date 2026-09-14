# Deploy UAT — Render + Supabase (gratis)

**Dibuat:** 2026-09-11 · **Status:** ✅ LIVE di <https://invoice-tracking-uat.onrender.com> · **Biaya:** $0

Dokumen ini melengkapi [`UAT_AND_CUTOVER.md`](./UAT_AND_CUTOVER.md), yang tetap jadi sumber kebenaran
untuk **matriks variabel environment**, **akun uji**, dan **8 skenario UAT wajib**. Di sini hanya
lapisan hosting: kenapa Render, apa yang berubah di repo, dan urutan perintah deploy.

---

## 1. Susunan yang dipilih

| Lapisan | Layanan | Paket | Kenapa |
|---|---|---|---|
| Compute | **Render Web Service** | Free | Satu-satunya dari Netlify/Render/Cloudflare yang menjalankan container Docker dengan proses Node hidup terus |
| Database | **Supabase Postgres** | Free | Postgres gratis Render **kedaluwarsa 30 hari lalu dihapus** — tidak boleh dipakai untuk UAT |
| File storage | **Supabase Storage** | Free | Free tier Render tidak punya disk persisten. `fileService.ts` sudah mendukung Supabase — nol perubahan kode |

Satu project Supabase memberi database **dan** storage sekaligus, dan aplikasi ini sudah terintegrasi
dengan keduanya. Region Singapura (`ap-southeast-1`) tersedia di kedua layanan.

### Kenapa bukan dua yang lain

**Netlify** menjalankan Next.js sebagai serverless function (Lambda). Dua penghalang arsitektural,
bukan soal harga: batas payload ~6 MB mematikan unggahan 10 MB × 10 file yang diizinkan
`src/lib/uploadLimits.ts`, dan batas durasi function memutus stream SSE rute OCR yang dirancang jalan
60 detik+.

**Cloudflare Workers** bukan runtime Node penuh. Prisma 7 di sana masih kena bug Wasm codegen yang
terbuka, dan tidak ada Postgres kelas satu (D1 adalah SQLite, sementara skema ini `provider =
"postgresql"` dengan 15 migrasi). Perlu port besar — bertentangan dengan "perubahan seminimal mungkin".

---

## 2. Batas yang harus diketahui sejak awal

Free tier Render itu nyata, tapi punya tiga plafon yang akan terasa:

| Batas | Angka | Dampak nyata |
|---|---|---|
| **RAM / CPU** | 512 MB / 0.1 CPU | Plafon paling berisiko. `exceljs` menyusun XLSX di memori dan `react-pdf` memuat PDF — export daftar invoice yang panjang bisa OOM. Kalau terjadi: naik ke Starter ($7/bln) atau pindah ke Railway (§6) |
| **Tidur saat idle** | ~15 menit | Penguji pertama setelah jeda menunggu **~50 detik**. Bukan error, hanya lambat. Beri tahu penguji, atau lihat mitigasi di bawah |
| **Tanpa disk persisten** | — | Sudah ditangani: unggahan ke Supabase Storage, bukan disk |

**Mitigasi tidur:** free tier memberi 750 jam instance per bulan, sementara sebulan hanya ~730 jam.
Jadi satu service boleh menyala 24/7 dalam kuota gratis. Ping eksternal tiap 10 menit (mis.
cron-job.org, gratis) menahannya tetap bangun. Untuk sesi UAT terjadwal, menerima cold start saja
biasanya lebih jujur.

**Supabase free:** database 500 MB, storage 1 GB, dan project **dijeda setelah 7 hari tanpa aktivitas**
— bisa dibangunkan lagi dari dashboard. Selama UAT berjalan, aktivitasnya cukup.

---

## 3. Yang berubah di repo

Enam file, tidak ada logika bisnis yang disentuh.

| File | Perubahan | Kenapa |
|---|---|---|
| `next.config.ts` | `output: "standalone"` | Image runtime tidak perlu `node_modules`. Diabaikan `next dev`/`next start` |
| `Dockerfile` | **baru** | Build 3 tahap. Dockerfile biasa, bukan buildpack, jadi image yang sama jalan di Render, Railway, Fly, Cloud Run atau VM — UAT tidak mengunci pilihan produksi |
| `.dockerignore` | **baru** | Menjaga `.env*`, `.git`, `uploads/` keluar dari konteks build |
| `render.yaml` | **baru** | Blueprint: web service Docker, plan free, region Singapura, healthcheck `/api/health` |
| `railway.json` | **baru** | Jalan keluar terdokumentasi kalau 512 MB terbukti kurang (§6) |
| `src/app/(auth)/login/page.tsx` | 8 baris | Tombol login sekali-klik kini muncul juga saat `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` |
| `.env.example` | dokumentasi | Menambah `NEXT_PUBLIC_ENABLE_DEMO_LOGIN`, memperbaiki `AUTH_TRUST_HOST=` → `=true` (§5) |

### Kenapa tombol demo butuh perubahan kode

`page.tsx` memagari blok tombol dengan `process.env.NODE_ENV === 'development'`. Next.js menyulih nilai
itu saat **build**, jadi pada build produksi ekspresinya terlipat jadi `false` dan seluruh markup
dibuang dead-code elimination — diverifikasi: `.next/static/` hasil build produksi tidak mengandung
`gastaff@sip.id` maupun `demo1234`. Tidak ada variabel runtime yang bisa menghidupkannya kembali:

```ts
const demoLoginEnabled =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true'
```

Perilaku produksi tidak berubah selama variabel itu tidak diset.

### Build-time vs runtime

`NEXT_PUBLIC_*` disulih ke bundle klien saat `next build`, **bukan** dibaca saat runtime. Docker
mengisolasi build dari environment host, jadi variabel hanya masuk kalau stage-nya mendeklarasikan
`ARG` — Dockerfile ini sudah melakukannya. Render **otomatis menerjemahkan setiap env var service
menjadi Docker build arg**, jadi pasangannya klop tanpa konfigurasi tambahan. Menyetel
`NEXT_PUBLIC_ENABLE_DEMO_LOGIN` hanya sebagai variabel runtime tidak melakukan apa-apa, tanpa error.

---

## 4. Urutan deploy

### 4.1 Yang harus dilakukan manusia

1. **Supabase** — <https://supabase.com/dashboard>, login GitHub, **New project**, region
   **Southeast Asia (Singapore)**. Simpan password database yang dibuat. Lalu:
   - **Storage → New bucket** → nama persis **`invoices`**, biarkan **private**.
   - **Project Settings → Data API** → salin **Project URL** dan **`service_role` key**.
   - **Project Settings → Database** → salin **Connection string → Transaction pooler**, ganti
     `[YOUR-PASSWORD]` dengan password tadi.
2. **Render** — <https://dashboard.render.com>, login GitHub. Lalu **Account Settings → API Keys →
   Create API Key**, salin nilainya.

Tidak ada kartu kredit di kedua langkah.

### 4.2 Yang dikerjakan otomatis

Blueprint `render.yaml` sudah menetapkan plan, region, healthcheck, dan variabel non-rahasia.
`NEXTAUTH_SECRET` dan `CRON_SECRET` dibangkitkan Render sendiri (`generateValue: true`) sehingga tidak
pernah menyentuh git. Yang bertanda `sync: false` diisi saat deploy pertama.

`NEXTAUTH_URL` baru bisa diisi setelah Render memberi domain, jadi urutannya: deploy → ambil domain →
set `NEXTAUTH_URL` → deploy ulang sekali.

### 4.3 Migrasi dan seed

Image runtime **tidak** memuat CLI Prisma (standalone sengaja ramping), jadi 15 migrasi dijalankan
dari mesin lokal terhadap Supabase:

⚠️ **Migrasi harus lewat port 5432, bukan 6543.** Ini bukan preferensi — `prisma migrate deploy`
terhadap transaction pooler (6543) **menggantung tanpa pesan error** dan tidak membuat satu tabel pun;
dikonfirmasi saat menyiapkan lingkungan ini. Transaction pooler tidak mendukung operasi session-level
dan advisory lock yang dipakai Prisma. Port 5432 pada host pooler yang sama adalah **session pooler**
dan bekerja normal. Runtime aplikasi tetap memakai 6543, yang memang tepat untuk koneksi pendek.

```bash
# 5432 = session pooler → untuk migrasi & seed
UAT_DIRECT='postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
# 6543 = transaction pooler → untuk DATABASE_URL runtime di Render

DATABASE_SSL_REJECT_UNAUTHORIZED=false \
DIRECT_URL="$UAT_DIRECT" DATABASE_URL="$UAT_DIRECT" npx prisma migrate deploy

# ⚠️ MENGHAPUS seluruh tabel lebih dulu. Guard host non-lokal ada di seed.ts:57.
SEED_ALLOW_REMOTE=yes-i-know DATABASE_SSL_REJECT_UNAUTHORIZED=false \
DIRECT_URL="$UAT_DIRECT" DATABASE_URL="$UAT_DIRECT" \
ADMIN_PASSWORD='<rahasia-uat>' DEMO_PASSWORD='<sama-dengan-NEXT_PUBLIC_DEMO_PASSWORD>' \
npm run db:seed
```

`ADMIN_PASSWORD` **harus** diisi: default-nya literal di `prisma/seed.ts:89` yang sudah ada di riwayat
git repo publik ini. Mengisinya membuat default itu tidak pernah terpakai.

> Sertakan `DATABASE_SSL_REJECT_UNAUTHORIZED=false` pada kedua perintah — `prisma.ts` membuang
> `sslmode` dari URL dan hanya mengatur TLS lewat flag itu.

### 4.4 Verifikasi setelah deploy

1. `GET /api/health` → `200 {"status":"ok","app":"ok","db":"ok"}`. Kalau `503`, `DATABASE_URL` salah.
   Cold start pertama bisa ~50 detik — bukan kegagalan.
2. `/login` → empat tombol demo terlihat. Kalau tidak, `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` tidak ikut saat
   **build** — deploy ulang, bukan sekadar ubah variabel.
3. Klik `admin` → masuk dashboard. Gagal `UntrustedHost` berarti `AUTH_TRUST_HOST` belum ada.
4. Unggah satu dokumen, lalu buka lagi setelah deploy ulang — membuktikan file ada di Supabase Storage,
   bukan disk ephemeral.
5. Jalankan 8 skenario di §1.5 `UAT_AND_CUTOVER.md`.

---

## 4.5 Bukti: image ini sudah diuji end-to-end secara lokal

Dijalankan sebelum menyentuh Render sama sekali, supaya kegagalan build tidak ketahuan setelah akun
dibuat. Image yang sama persis (`docker build`, exit 0, 443 MB) dijalankan sebagai container terhadap
Postgres lokal yang terisi penuh — 12 tabel, 8 akun, 107 invoice:

| Yang diuji | Hasil |
|---|---|
| Container boot + koneksi database | `GET /api/health` → `200 {"status":"ok","app":"ok","db":"ok"}` |
| **Tombol demo selamat di build produksi** | Penanda "Demo — login sebagai" dan label `ga_staff` / `vendor A` / `vendor B` ada di HTML — inilah yang dulu hilang terbuang dead-code elimination |
| Login kredensial sungguhan | `POST /api/auth/callback/credentials` → 302, cookie `authjs.session-token` terpasang, sesi `role: ADMIN` |
| Enam endpoint terautentikasi | `/api/dashboard`, `/api/invoices`, `/api/notifications`, `/api/vendors`, `/api/companies`, `/api/audit` → semua 200 |
| Dashboard ter-render | 33.9 KB HTML, `totalInvoices: 104` (107 baris dikurangi draft — sesuai desain) |
| Cron gagal tertutup | Tanpa token → **401**; dengan `Bearer` benar → `200 {"ok":true,...,"notificationsCreated":78}` |
| **Isolasi lintas tenant** | `vendor2@sip.id` membuka invoice milik Vendor A → **403** |

Yang **belum** terbukti dan hanya bisa diuji setelah deploy: persistensi Supabase Storage (butuh
kredensial Supabase) dan perilaku 512 MB / cold start di free tier Render.

---

## 4.6 Hasil verifikasi terhadap deployment sungguhan

Dijalankan terhadap `https://invoice-tracking-uat.onrender.com` setelah deploy pertama — **12 dari 12
lulus**, lalu 3 pemeriksaan storage terpisah.

| Pemeriksaan | Hasil |
|---|---|
| `GET /api/health` | `200 {"status":"ok","app":"ok","db":"ok"}` |
| Tombol demo di build produksi | marker + label `ga_staff` / `vendor A` / `vendor B` ada |
| Login kredensial | sesi `admin@sip.id ADMIN` terbentuk |
| `/api/dashboard` `/api/invoices` `/api/vendors` `/api/companies` `/api/audit` | semua `200` |
| `totalInvoices` | `104` (107 baris seed dikurangi draft) |
| Cron tanpa token | `401` — gagal tertutup |
| Isolasi lintas tenant | `vendor2@sip.id` → invoice Vendor A = **403** |
| **Upload → Supabase Storage** | objek `<invoiceId>/<documentId>.pdf` muncul di bucket, 125 bytes |
| **Baca balik lewat aplikasi** | `200`, `application/pdf`, magic bytes `%PDF-1.4` utuh |
| Hard delete + pembersihan | invoice uji terhapus, jumlah kembali `104` |

Upload diuji lengkap meski `GOOGLE_API_KEY` belum diset: `upload/route.ts:74` menyimpan file **sebelum**
klasifikasi, dan klasifikasi di `:85` dibungkus `try/catch` di `:88` — jadi ketiadaan Gemini menurunkan
dokumen ke tipe `OTHER` tanpa menggagalkan unggahan. Itu membuktikan jalur storage berdiri sendiri.

Saat §4.6 dijalankan, `GOOGLE_API_KEY` dan `RESEND_API_KEY` belum diset — kunci berbiaya tidak disalin
dari `.env.local` tanpa permintaan eksplisit. Keduanya kemudian diaktifkan; lihat §4.7.

---

## 4.7 OCR dan chat aktif; email diuji lalu dimatikan (2026-09-11)

`GOOGLE_API_KEY`, `GEMINI_MODEL`, `RESEND_API_KEY` dan `RESEND_FROM_EMAIL` dipasang di Render. Kedua
kunci divalidasi dengan panggilan sungguhan **sebelum** dipasang; keempat domain Resend berstatus
`verified`, jadi email terkirim ke penerima mana pun, bukan hanya pemilik akun.

`RESEND_API_KEY` kemudian **dicabut lagi** setelah email terbukti bekerja (lihat akhir bagian ini), jadi
environment akhir berisi **13 variabel**.

| Fitur | Bukti |
|---|---|
| **Chat** | "Berapa total invoice PAID?" → `14`. Diverifikasi ke database: `PAID` non-draft = **14**. Tool `query_invoices` benar-benar dipanggil, bukan halusinasi |
| **Klasifikasi dokumen** | PDF invoice diunggah → tipe `INVOICE`, confidence **100** |
| **OCR (SSE)** | 17 event dalam **11,4 detik**, `overallConfidence` 96,3. Semua nilai tepat: subtotal 15.000.000, PPN 1.650.000, total 16.650.000, 2 line item |
| **Resolusi company** | Blok bill-to → `MATCHED` ke `PT Nusantara Gemilang Sejahtera` lewat nama |
| **Email** | Digest "17 invoice sudah jatuh tempo" → status `delivered` di Resend. **Kini dimatikan** — lihat di bawah |

**Stream SSE 11 detik berjalan utuh di Render** — inilah yang tidak bisa dilakukan Netlify (batas durasi
function) maupun Vercel (60 detik di `vercel.json`).

### Yang terlihat seperti bug tapi bukan

OCR **tidak** menulis `invoiceNumber`, `poNumber` dan `companyId` ke database; ketiganya hanya dikirim
sebagai event SSE. Itu disengaja dan dijelaskan di `ocr/route.ts:223-240`: `invoiceNumber` adalah kunci
duplicate-check yang hanya berjalan di `PATCH`, dan menulisnya langsung dari OCR pernah menyebabkan dua
kegagalan nyata (2026-09-03). `poNumber` dan `companyId` ditahan karena keduanya digerbangi
`validateReadyToGoLive` — menulisnya dari OCR akan memuaskan gerbang itu dengan data yang belum
dikonfirmasi manusia. Ketiganya kembali lewat `PATCH` dari langkah konfirmasi.

### Email: terbukti jalan, lalu dimatikan atas permintaan maintainer

Email **tidak urgen untuk UAT**, dan penerima reminder masih alamat seed yang tidak nyata
(`gastaff@sip.id`, `gamanager@sip.id`, `gantipassword@sip.id`). Mengirim ke sana menghasilkan bounce,
dan domain pengirim `ai-dev.tech` juga dipakai untuk email bisnis sungguhan — bounce berulang merusak
reputasi pengirimnya. Jadi setelah dibuktikan bekerja, email dimatikan.

Dimatikan **dua lapis**, karena satu lapis saja tidak cukup di UAT ini:

1. **`reminder_settings.email_enabled = false`** untuk `due_soon` dan `overdue` (kembali ke keadaan
   seed). Keempat jalur pengirim email digerbangi flag per-tipe ini —
   `reminderScheduler.ts:46,81`, `stage/route.ts:92` (`stage_assigned`) dan
   `invoices/[id]/route.ts:406` (`status_changed`) — dan dua yang terakhir sudah `false`.
2. **`RESEND_API_KEY` dicabut dari environment Render.** Lapis pertama saja tidak cukup: halaman
   `/admin/reminders` bisa menyalakan flag itu lagi, dan di UAT **setiap penguji bisa masuk sebagai
   ADMIN lewat tombol sekali-klik**. Tanpa kunci, `email.ts:11` keluar lebih awal apa pun setelannya.

`RESEND_FROM_EMAIL` sengaja ditinggal — bukan rahasia, dan menyalakan email lagi cukup satu variabel.

**Menyalakan kembali:** pasang `RESEND_API_KEY` di Render, lalu nyalakan `email_enabled` pada tipe yang
diinginkan di `/admin/reminders`. Sebelum itu, arahkan penerimanya ke alamat nyata — ubah email akun
lewat `PATCH /api/users/[id]`, atau isi `extraEmails` dan kosongkan `recipientRoles`.

Catatan pengujian: pembuktian di atas memakai `delivered@resend.dev`, alamat uji resmi Resend yang
selalu sukses, justru supaya tidak ada bounce ke alamat palsu.

---

## 5. Satu jebakan yang diperbaiki di `.env.example`

Baris `AUTH_TRUST_HOST=` (kosong) lebih buruk daripada tidak ada. NextAuth menghitung:

```js
config.trustHost ??= !!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== "production")
```

`??` hanya melompati `null`/`undefined`. String kosong bukan keduanya, jadi rantai berhenti di situ dan
menghasilkan `!!"" === false` — mematikan `trustHost` bahkan di development, di mana nilai yang tidak
diset justru menyalakannya. Placeholder-nya kini `AUTH_TRUST_HOST=true`.

---

## 6. Kalau 512 MB terbukti kurang

Gejalanya spesifik: proses mati saat export Excel daftar panjang, atau restart berulang di bawah beban.
Dua jalan keluar, tanpa perubahan kode karena image-nya sama:

- **Render Starter — $7/bln.** RAM tetap 512 MB tapi CPU naik 5× (0.5 vs 0.1) dan tidak tidur. Membantu
  kalau keluhannya lambat, **tidak** membantu kalau keluhannya OOM.
- **Railway — ~$5–12/bln.** `railway.json` sudah ada di repo. RAM naik sesuai pemakaian, ada volume
  persisten (sehingga Supabase Storage jadi opsional), region Singapura. Ini jalan yang dipilih kalau
  yang jadi masalah memang memori.

---

## 7. Yang sengaja belum dikerjakan

| Item | Alasan | Kapan dibereskan |
|---|---|---|
| **Cron reminder harian** | Cron job Render adalah tipe service berbayar. Selama UAT picu manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/reminders` | Sebelum produksi |
| **Migrasi otomatis saat deploy** | Butuh CLI Prisma di image runtime (~+80 MB), dan RAM sedang ketat | Kalau skema sering berubah selama UAT |
| **`bcryptjs` di `devDependencies`** | Diimpor kode runtime (`auth.ts:3` + 3 rute user). Aman di Dockerfile ini karena `npm ci` memasang dev deps dan output tracing menelusuri impor sungguhan — tapi meledak kalau ada yang menambah `--omit=dev` | Pindahkan satu baris ke `dependencies` |
| **Rate limit per-instance** | `rate-limit.ts` menyimpan state di memori. Tidak masalah selama satu instance | Sebelum menaikkan replika |
| **Password admin bootstrap** | Literal di `prisma/seed.ts:89`, ada di riwayat git **repo publik** | **Wajib** rotasi sebelum produksi |
| **Tombol demo di halaman login** | Mengirim kredensial seed dari bundle klien. Aman hanya karena akun-akun itu throwaway | Matikan `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` sebelum produksi |

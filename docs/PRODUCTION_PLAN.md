# Rencana Produksi — Invoice Tracking

**Tanggal:** 2026-07-26
**Status:** Menunggu persetujuan, belum ada kode yang diubah
**Target deploy:** Vercel plan Hobby (Next.js) + Supabase (Postgres + Storage), kemungkinan pindah ke GCP kemudian

---

## 1. Ringkasan Eksekutif

Aplikasi ini dibangun sebagai demo MVP 2 hari dan berjalan baik di laptop. Untuk jadi
production-level di Vercel + Supabase, ada **lima asumsi arsitektur yang tidak berlaku di
serverless** dan harus diganti, bukan ditambal:

| Asumsi MVP | Kenapa gagal di Vercel | Ganti dengan |
|---|---|---|
| File di disk lokal (`uploads/invoices/`) | Filesystem serverless bersifat sementara & tidak dibagi antar instance. Route file sudah sengaja `503` saat `VERCEL=1` | Supabase Storage + signed URL |
| `node-cron` dalam proses Next.js | Tidak ada proses yang hidup terus; scale-to-zero | Vercel Cron → route handler |
| Rate limit `Map` in-memory | Tiap instance punya Map sendiri; limit jadi per-instance | Diterima dulu (lihat §4.3), Upstash bila perlu |
| SSE notifikasi (koneksi terbuka + poll 15 dtk) | Menahan durasi function terus-menerus | Polling dari client |
| AI service Python (Tesseract) | Butuh binary sistem; tidak bisa jalan di Vercel | Gemini vision langsung dari route Next.js |

Di luar itu ada tiga pekerjaan yang muncul dari keputusan bisnis: penyederhanaan role dari 7
menjadi 4 (§4.9), pelacakan pembayaran (§5.3), dan halaman pengaturan reminder (§6.6).

**Estimasi effort: 20 hari kerja (±4 minggu) untuk satu developer.** Rincian di §8.

**Ada satu blocker yang harus diperbaiki lebih dulu:** build di branch `main` sekarang rusak.

---

## 2. Blocker: build gagal di `main`

[`src/lib/db/prisma.ts:11-18`](../src/lib/db/prisma.ts#L11-L18) mendeklarasikan `const url`
dua kali (blok komentar + 3 baris ter-duplikasi saat merge).

```
$ npx tsc --noEmit
src/lib/db/prisma.ts(11,9): error TS2451: Cannot redeclare block-scoped variable 'url'.
src/lib/db/prisma.ts(16,9): error TS2451: Cannot redeclare block-scoped variable 'url'.
```

`next build` di Vercel akan gagal dengan error yang sama. Perbaikannya menghapus 4 baris
duplikat. **Ini langkah pertama, sebelum apa pun.**

Catatan: `npm test` sendiri lolos (35 test, 3 file) karena Vitest tidak melakukan type-check.
Ini alasan bug-nya bisa ter-commit tanpa ketahuan — lihat §7 soal menambahkan `tsc --noEmit`
ke pipeline.

---

## 3. Keputusan yang sudah diambil

| Topik | Keputusan | Konsekuensi |
|---|---|---|
| Hosting | Vercel plan **Hobby**, kemungkinan pindah GCP nanti | Cron **hanya boleh harian** (§4.2). Portabilitas ke GCP: lihat §4.7 |
| OCR & chat | Gemini vision, hapus `ai-service/` Python | Tidak ada service kedua untuk di-deploy/monitor |
| Tier Gemini | **Free tier** (paid belum disetujui manajemen) | Data invoice dipakai Google untuk training — risiko diterima, lihat §5.1 |
| Chatbot | Tool `query_invoices`, **hanya role `GA_MANAGER`**, tanpa embedding | Menyederhanakan banyak hal — lihat §5.2 |
| File storage | Supabase Storage | Free tier 1GB |
| File invoice lama | **Dihapus, seed ulang** | Tidak ada migrasi data — hemat ±0,5 hari |
| Email | Resend | Perlu setup DNS domain — lihat §6.2 |
| Auth | Tetap NextAuth v5 | Effort tambahan 0 |
| "PT" pada 3c/3d | Entitas penerima invoice (*bill-to*), model `Company` baru | Terpisah dari `Vendor` (pengirim) |
| Daftar role | Hanya **4**: `ADMIN`, `GA_MANAGER`, `GA_STAFF`, `VENDOR`. Hapus `FINANCE`, `MANAGER`, `VIEWER` | Refactor ±20 titik + migrasi enum — lihat §4.9 |
| Pelacakan pembayaran | **Opsi B** — status `PAID` + `paid_date` + `paid_amount` | +1,5 hari; chat jadi bisa menjawab "belum dibayar" — lihat §5.3 |
| Yang menandai lunas | `GA_STAFF`, `GA_MANAGER`, `ADMIN` | Vendor tidak bisa menyatakan invoice-nya sendiri lunas |
| Izin `GA_MANAGER` | Sama dengan `GA_STAFF` (buat, upload, ubah status) + chat | Menggantikan `FINANCE` yang dihapus |
| Akses chat | `GA_MANAGER` + `ADMIN` | |
| Reminder | **Halaman pengaturan tersendiri**, diedit ADMIN | Fitur baru (3f) — lihat §6.6 |

---

## 4. Fase 1 — Hardening untuk Vercel + Supabase

### 4.1 File storage → Supabase Storage

**Kondisi sekarang:** [`fileService.ts`](../src/lib/services/fileService.ts) menulis ke
`uploads/invoices/` dan mengembalikan `filePath: ''` kosong saat `VERCEL=1` — artinya di
production file terunggah **hilang tanpa error apa pun**. Route penyajian file
[`[id]/file/route.ts`](../src/app/api/invoices/[id]/file/route.ts) membalas `503`.

**Perubahan:**

- Bucket privat `invoices` di Supabase Storage.
- `saveUploadedFile()` upload via `supabase.storage.from('invoices').upload(path, buffer)`.
- Path objek: `invoices/{invoiceId}.{ext}` — sama dengan skema penamaan sekarang.
- Route file mengembalikan **signed URL** (`createSignedUrl(path, 3600)`) alih-alih mengalirkan
  byte lewat function. Lebih hemat bandwidth dan menghapus seluruh logika path-traversal yang
  sekarang ada.
- Pengecekan otorisasi VENDOR tetap **sebelum** signed URL dibuat — ini yang menjaga vendor
  tidak bisa membuka invoice vendor lain.
- Validasi yang sudah ada (MIME, magic bytes, batas 10MB) **tidak diubah** — sudah benar.

**Migrasi data: tidak ada.** 20 file PDF di `uploads/invoices/` dihapus, `prisma/seed.ts`
dijalankan ulang setelah migrasi schema selesai.

**Sisi yang terpengaruh:** `fileService.ts`, `api/invoices/[id]/file/route.ts`,
`api/invoices/[id]/upload/route.ts`, viewer PDF di halaman detail invoice.

### 4.2 Reminder scheduler → Vercel Cron

**Kondisi sekarang:** [`reminderScheduler.ts`](../src/lib/services/reminderScheduler.ts)
dijalankan `node-cron` tiap jam, di-boot lewat
[`instrumentation.ts`](../src/instrumentation.ts).

**Perubahan:**

- Hapus dependensi `node-cron` + `@types/node-cron`, hapus `instrumentation.ts`.
- Route baru `GET /api/cron/reminders`, dijaga `CRON_SECRET`:
  ```ts
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  ```
- Daftarkan di `vercel.json`:
  ```json
  { "crons": [{ "path": "/api/cron/reminders", "schedule": "0 1 * * *" }] }
  ```

> **Batasan plan Hobby (terkonfirmasi).** Cron di Hobby **hanya boleh sekali sehari** —
> ekspresi yang lebih sering (`0 * * * *`, `*/30 * * * *`) akan **menggagalkan deployment**,
> bukan sekadar diabaikan. Waktu eksekusi juga bisa meleset sampai 60 menit dari jadwal.
> Untuk reminder jatuh tempo, sekali sehari memadai — pengingat H-3 tetap terkirim di hari
> yang benar. Kalau nanti butuh lebih sering, itu alasan konkret untuk naik ke Pro.

Dedup notifikasi 24 jam yang sudah ada tetap dipertahankan supaya cron yang jalan dua kali
tidak mengirim email ganda.

Ambang "3 hari sebelum jatuh tempo" dan daftar penerima **tidak lagi hardcoded** — cron membaca
tabel `ReminderSetting` yang dikelola admin lewat halaman pengaturan (§6.6).

### 4.3 Rate limiting

[`rate-limit.ts`](../src/lib/rate-limit.ts) memakai `Map` proses-lokal. Di Vercel, tiap
instance punya `Map` sendiri, jadi batas 5 req/menit efektif menjadi 5 × jumlah instance.

**Rekomendasi: biarkan dulu**, tambahkan komentar `ponytail:` yang menyatakan batasnya.
Limiter ini melindungi endpoint OCR & chat dari user yang **sudah login dan ter-autentikasi**,
bukan permukaan anonim. Degradasi ke "per instance" masih memblokir penyalahgunaan terburuk.
Upgrade ke Upstash Redis (free tier) kalau kuota Gemini mulai habis lebih cepat dari perkiraan.

Yang **harus** diperbaiki: `setInterval(...).unref()` untuk cleanup tidak pernah jalan di
serverless dan hanya menahan referensi. Ganti dengan pembersihan lazy saat lookup.

### 4.4 SSE notifikasi → polling

[`notifications/stream/route.ts`](../src/app/api/notifications/stream/route.ts) membuka
`ReadableStream` dan polling database tiap 15 detik selamanya. Di Vercel ini menahan eksekusi
function terus-menerus — biaya berjalan tanpa ada pekerjaan nyata.

**Perubahan:** hapus route SSE, ubah
[`useNotificationStream.ts`](../src/hooks/useNotificationStream.ts) menjadi polling
`GET /api/notifications?unreadOnly=true` tiap 60 detik. Fungsional identik dari sisi user.

### 4.5 Koneksi database Supabase

Supabase menyediakan dua endpoint: pooler (PgBouncer, transaction mode) dan koneksi langsung.
Serverless **wajib** lewat pooler — koneksi langsung akan kehabisan slot saat banyak lambda
hidup bersamaan.

- `DATABASE_URL` → connection string **pooler** (runtime aplikasi)
- `DIRECT_URL` → connection string **langsung** (`prisma migrate`)

Konfigurasi SSL eksplisit di `prisma.ts` (`pg.Pool` + opsi `ssl`) **sudah benar** dan
dipertahankan — parameter `sslmode` di URL memang tidak bekerja dengan Prisma v7 +
`adapter-pg`.

### 4.6 Durasi function

`vercel.json` sekarang menyetel `maxDuration: 30` untuk semua route API. Batas plan Hobby
sebenarnya **300 detik** (fluid compute), jadi tidak ada masalah — ekstraksi Gemini untuk satu
PDF berjalan sekitar 5–20 detik dan muat dengan lapang. Naikkan `maxDuration` route OCR ke 60
detik sebagai margin, sisanya biarkan 30.

### 4.7 Portabilitas ke GCP

Karena ada kemungkinan pindah ke GCP, ini yang perlu diketahui sekarang — **tanpa membangun
lapisan abstraksi apa pun untuk itu hari ini:**

| Komponen | Terikat Vercel? | Saat pindah ke GCP |
|---|---|---|
| Next.js app | Tidak | `output: 'standalone'` + Dockerfile → Cloud Run |
| Supabase Postgres & Storage | Tidak | Tidak berubah sama sekali |
| Resend | Tidak | Tidak berubah |
| Gemini | Tidak (sudah Google) | Tidak berubah, bisa pindah ke Vertex AI bila mau |
| **Cron** | **Ya** — `vercel.json` | Cloud Scheduler → HTTP ke route yang sama, header Bearer yang sama |

Karena route cron adalah endpoint HTTP biasa yang dijaga secret, **satu-satunya yang berubah
adalah siapa yang memanggilnya**. Itu perubahan konfigurasi, bukan perubahan kode. Membangun
"scheduler abstraction layer" sekarang hanya menambah kode untuk masalah yang penyelesaiannya
sudah satu file.

Estimasi migrasi ke Cloud Run bila nanti diputuskan: ±1–2 hari (Dockerfile, Cloud Scheduler,
Secret Manager, domain).

### 4.8 Kebersihan lain

- `docker-compose.yml` memakai image `pgvector/pgvector:pg16`. Karena chatbot tidak memakai
  embedding (§5.2), turunkan ke `postgres:16` biasa untuk pengembangan lokal.
- Hapus cast `as any` di [`reminderScheduler.ts:28,44`](../src/lib/services/reminderScheduler.ts#L28)
  dan [`invoices/route.ts:18`](../src/app/api/invoices/route.ts#L18) — gunakan enum Prisma.
- `.gitignore` sudah menutupi `.env*` dan `ai-service/.env` — **tidak ada perubahan
  diperlukan**, cukup diverifikasi ulang sebelum push pertama.

### 4.9 Penyederhanaan role — dikerjakan paling awal

Role yang benar-benar dipakai hanya empat: `ADMIN`, `GA_MANAGER`, `GA_STAFF`, `VENDOR`.
`FINANCE`, `MANAGER`, dan `VIEWER` dihapus.

**`MANAGER` dan `VIEWER` aman dihapus** — keduanya sudah ditandai deprecated dan hanya punya
akses baca yang tumpang tindih dengan role lain.

**`FINANCE` tidak kosong.** Dia sekarang memegang enam tanggung jawab nyata di kode. Berikut
pengalihannya:

| Tanggung jawab `FINANCE` sekarang | Lokasi | Dialihkan ke |
|---|---|---|
| Membuat invoice | [`api/invoices/route.ts:52`](../src/app/api/invoices/route.ts#L52) | `GA_STAFF` (sudah punya) + `GA_MANAGER` (baru) |
| Upload file invoice | [`[id]/upload/route.ts:10`](../src/app/api/invoices/[id]/upload/route.ts#L10) | idem |
| Ubah field & status invoice | [`[id]/route.ts:69-73`](../src/app/api/invoices/[id]/route.ts#L69) | `case 'GA_STAFF'` ditambah fallthrough `case 'GA_MANAGER'` |
| Akses audit log | [`api/audit/route.ts:6`](../src/app/api/audit/route.ts#L6) | `ADMIN` + `GA_MANAGER` |
| Terima email reminder | [`reminderScheduler.ts:44`](../src/lib/services/reminderScheduler.ts#L44) | Tidak lagi hardcoded — diatur admin (§6.6) |
| Akses halaman `/reminders` | [`Sidebar.tsx:20`](../src/components/layout/Sidebar.tsx#L20) | Semua user melihat notifikasinya sendiri (lihat catatan di bawah) |

**Titik yang harus disentuh** (±20 lokasi):

- `prisma/schema.prisma` — enum `Role`
- `src/lib/validations.ts:53` dan `api/users/[id]/route.ts:7` — enum Zod
- `api/chat/route.ts`, `api/invoices/route.ts`, `api/invoices/[id]/{route,upload}.ts`,
  `api/audit/route.ts`, `api/users/route.ts` — daftar `requireRole`
- `Sidebar.tsx` (6 entri menu), `TopBar.tsx` (warna badge), `audit/page.tsx` (warna badge),
  `admin/users/page.tsx` (konstanta `ROLES` + default form `VIEWER`),
  `invoices/page.tsx`, `invoices/upload/page.tsx`, `invoices/[id]/page.tsx`
- `(auth)/login/page.tsx` — hapus `finance@demo.com` dari `DEMO_ACCOUNTS`
- `prisma/seed.ts` — hapus user `manager@`, `finance@`, `viewer@`
- `src/lib/auth/__tests__/rbac.test.ts` — 8 kasus uji memakai role yang dihapus
- `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`

**Fallback default yang berbahaya.** [`Sidebar.tsx:50`](../src/components/layout/Sidebar.tsx#L50)
dan [`TopBar.tsx:63`](../src/components/layout/TopBar.tsx#L63) memakai `?? 'VIEWER'` sebagai
nilai default saat session belum termuat. Setelah `VIEWER` dihapus, fallback ini harus
diganti — **jangan diganti dengan role lain**. Fallback ke role apa pun berarti UI menebak izin
sebelum session ada. Yang benar: tampilkan skeleton/kosong sampai session termuat.

**Migrasi enum Postgres.** Nilai enum tidak bisa di-`DROP` langsung. Urutannya:
1. `UPDATE users SET role = 'GA_STAFF' WHERE role IN ('FINANCE','MANAGER','VIEWER')`
   (atau kosongkan tabel bila memang akan di-seed ulang)
2. Buat tipe enum baru, `ALTER TABLE ... TYPE`, drop tipe lama
3. Seed ulang

Karena data akan di-seed ulang (§4.1), langkah 1 cukup dijalankan sebagai pengaman. **Kalau
nanti sudah ada user produksi nyata, langkah 1 wajib dan harus diputuskan ke role mana tiap
user lama dipetakan.**

> **Catatan — akses halaman `/reminders`.** Halaman ini menampilkan *feed notifikasi milik user
> yang sedang login*, dan API-nya sudah menyaring `where: { userId }` di server. Membatasi
> halaman ini per role tidak menambah keamanan apa pun — hanya menyembunyikan notifikasi dari
> orang yang notifikasinya sendiri. Vendor yang menerima notifikasi `REVISION` justru harus
> bisa membukanya. **Buka untuk semua role**, biarkan penyaringan per-user di server yang
> bekerja.

---

## 5. Fase 2 — Ganti AI service

### 5.1 Ekstraksi invoice (OCR)

**Hapus:** seluruh folder `ai-service/` (Python, venv, Tesseract, PyMuPDF, 6 paket LangChain,
`pgvector`, `psycopg2`).

**Ganti dengan:** `src/lib/ai/extract.ts` memakai SDK `@google/genai`, model
`gemini-3.6-flash`. Gemini menerima PDF **langsung** sebagai `inlineData` base64 (batas 50MB
inline; aplikasi sudah membatasi 10MB), jadi tidak ada langkah render PDF→gambar sama sekali.
Output dipaksa berbentuk JSON lewat `responseSchema`, diturunkan dari `createInvoiceSchema`
yang sudah ada di [`validations.ts`](../src/lib/validations.ts).

**Alur baru** (`POST /api/invoices/[id]/ocr`):
1. Ambil file dari Supabase Storage → buffer
2. Panggil Gemini dengan buffer + prompt ekstraksi + `responseSchema`
3. Validasi respons dengan Zod (jangan percaya output model)
4. Simpan field ke `Invoice` + ganti baris `InvoiceItem`
5. Balas JSON

**Route SSE dihapus.** Animasi "field muncul satu per satu" tetap ada, tapi dijalankan di
client dari respons JSON — stagger 300ms per field adalah efek visual, tidak perlu dikirim
dari server. Ini menghapus satu route streaming, satu abort-timeout handler, dan seluruh
logika `emit()`.

Provider tetap ditukar lewat env var, jadi pindah ke paid tier atau ke Claude Haiku 4.5 nanti
hanya mengubah satu adapter.

**Menangani rate limit free tier.** Free tier punya batas request per menit dan per hari yang
bervariasi per model dan berubah dari waktu ke waktu — angka pastinya harus dicek di halaman
rate limits Gemini saat implementasi, jangan diasumsikan. Desainnya:
- Retry dengan backoff pada HTTP 429.
- Kalau tetap gagal, tampilkan pesan jelas "kuota AI sedang penuh, coba beberapa menit lagi"
  dan **jangan ubah state invoice**. Desain sekarang sudah benar dalam hal ini — status tetap
  `SUBMITTED` apa pun hasil OCR-nya, jadi kegagalan OCR tidak pernah merusak data.
- OCR bisa dijalankan ulang kapan saja oleh user, jadi kegagalan sementara tidak fatal.

> **⚠️ Risiko data yang diterima (bukan diselesaikan).**
> Dokumentasi Gemini menyatakan **data pada free tier dipakai untuk meningkatkan produk
> Google**; data paid tier tidak. Invoice berisi NPWP, nomor rekening bank vendor, dan nama
> PIC. Karena paid tier belum disetujui manajemen, risiko ini **diterima untuk sementara**.
>
> Yang perlu dilakukan:
> 1. **Catat sebagai keputusan sadar**, bukan kelalaian. Idealnya diketahui pihak yang
>    bertanggung jawab atas data vendor.
> 2. **Jangan pakai data invoice produksi selama fase pengembangan** — pakai invoice contoh
>    dari `prisma/seed.ts`.
> 3. Pindah ke paid tier adalah **perubahan satu env var**, bukan proyek. Saat manajemen
>    menyetujui, biayanya ±Rp 75rb/bulan untuk 1.000 invoice.

### 5.2 Chatbot

**Kondisi sekarang:** [`chat_service.py`](../ai-service/app/services/chat_service.py) mengirim
satu string statis `SYSTEM_CONTEXT` ke LLM. String itu **sudah usang** — menyebutkan status
`PENDING_OCR / PENDING_REVIEW / PENDING_APPROVAL / APPROVED / PAID` dan "approval workflow
Finance dan Manager", padahal schema sekarang hanya punya
`SUBMITTED / CANCELLED / REJECTED / VOID / REVISION` dan alur approval sudah dihapus.
Chatbot saat ini secara aktif mengarang tentang alur kerja yang tidak ada.

**Akses: `GA_MANAGER` + `ADMIN`.** Ini menyederhanakan banyak hal sekaligus:
- `POST /api/chat` → `requireRole(['GA_MANAGER', 'ADMIN'])`. Sebelumnya hanya VENDOR yang
  diblokir.
- **Tidak perlu penyaringan per-role di dalam tool.** Kedua role melihat semua invoice, jadi
  tidak ada logika `if role === VENDOR then where.vendorId = ...` di dalam `query_invoices`.
  Satu sumber kebocoran data hilang sebelum sempat ditulis.
- Menu `/chat` disembunyikan dari sidebar untuk role lain, bukan cuma diblokir di API.

ADMIN diikutkan supaya bisa menguji dan menelusuri masalah tanpa meminjam akun GA_MANAGER —
meminjam akun merusak jejak audit.

> **Catatan: `GA_MANAGER` tidak lagi deprecated.** [ARCHITECTURE.md](./ARCHITECTURE.md)
> sekarang menyatakan role ini deprecated karena fungsi approval step-1 sudah dihapus. Setelah
> §4.9, `GA_MANAGER` menjadi role penuh: izin operasional setara `GA_STAFF`, plus akses chat
> dan audit log. ARCHITECTURE.md dan README.md perlu diperbarui.

**Cakupan: seluruh invoice, semua status.** Tool ini bukan khusus urusan pembayaran — chat
bisa memeriksa invoice apa pun yang sudah masuk sistem: `SUBMITTED`, `PAID`, `REVISION`,
`CANCELLED`, `REJECTED`, `VOID`. Parameter `status` bersifat **opsional**; kalau tidak diisi,
tidak ada filter status sama sekali.

**Implementasi:** Gemini diberi satu tool `query_invoices` dengan parameter tetap. Handler tool
menjalankan Prisma. Model **tidak pernah** menulis SQL — ini yang menutup prompt injection.

| Parameter | Isi |
|---|---|
| `mode` | `list` (default) atau `summary` — lihat di bawah |
| `status` | Opsional, satu atau beberapa status. Kosong = semua |
| `dueBefore` / `dueAfter` | Rentang jatuh tempo |
| `invoiceDateBefore` / `invoiceDateAfter` | Rentang tanggal invoice |
| `vendorId` / `companyId` | Saring per vendor pengirim atau PT penerima |
| `search` | Cocokkan nomor invoice |
| `includeItems` | Sertakan baris `InvoiceItem` — untuk pertanyaan tentang produk/jasa |
| `limit` | Default **50**, maksimum 200 |

**Dua mode, dan ini yang membuatnya tetap bekerja saat data membesar.** Dengan 20 invoice demo
apa pun jalan; dengan 5.000 invoice, mengembalikan semua baris ke model akan melewati batas
context dan mahal. Karena itu:

- **`mode: 'list'`** — mengembalikan baris invoice (dibatasi `limit`). Untuk pertanyaan
  spesifik: *"invoice mana dari PT Maju Jaya yang jatuh tempo bulan ini?"*
- **`mode: 'summary'`** — mengembalikan hitungan dan penjumlahan yang **dikerjakan di database**
  (`groupBy` + `_count` + `_sum`), dikelompokkan per status / vendor / PT. Untuk pertanyaan
  agregat: *"total tagihan tahun ini berapa?"*, *"PT mana yang paling banyak invoice
  terbukanya?"*. Hasilnya beberapa baris ringkasan, bukan ribuan baris mentah.

Kalau `mode: 'list'` menemukan lebih banyak data daripada `limit`, respons menyertakan
`totalCount` dan penanda bahwa hasil dipotong — supaya model bilang *"ada 340 invoice, ini 50
teratas"* dan tidak diam-diam menjawab seolah 50 itu seluruhnya.

**Contoh pertanyaan → parameter:**

| Pertanyaan | Parameter |
|---|---|
| "PT mana yang belum dibayar?" | `mode: summary`, `status: [SUBMITTED]`, kelompok per `company` |
| "Produk/jasa apa yang masih menunggak?" | `status: [SUBMITTED]`, `includeItems: true` |
| "Invoice apa saja yang sudah lunas bulan lalu?" | `status: [PAID]`, rentang tanggal |
| "Ada invoice yang perlu revisi?" | `status: [REVISION]` |
| "Total semua invoice tahun ini?" | `mode: summary`, rentang tanggal, tanpa filter status |
| "Invoice dari CV Teknologi Nusantara" | `vendorId`, tanpa filter status |

**Kenapa tanpa embedding / pgvector:** invoice adalah baris terstruktur, bukan teks bebas.
"Invoice mana yang jatuh tempo?" dijawab `WHERE due_date < now()`, bukan pencarian kemiripan
vektor. Embedding hanya menambah tabel, job re-index, dan biaya tanpa menjawab pertanyaan
lebih baik. `pgvector` yang sudah disediakan bisa dibuang.

### 5.3 Pelacakan pembayaran (prasyarat chat)

Contoh pertanyaan *"PT mana yang belum dibayar"* tidak bisa dijawab sistem sekarang — tidak ada
status pembayaran di schema sama sekali. `SUBMITTED` berarti "sudah masuk, hasilnya belum
diketahui", bukan "belum dibayar". Kalau chatbot dibiarkan menjawab dari `SUBMITTED`, jawabannya
akan terdengar meyakinkan tapi salah — dan itu lebih berbahaya daripada tidak menjawab.

**Perubahan schema:**

```prisma
enum InvoiceStatus {
  SUBMITTED
  PAID        // ← baru
  CANCELLED
  REJECTED
  VOID
  REVISION
}

model Invoice {
  // ...
  paidDate   DateTime? @map("paid_date")
  paidAmount Decimal?  @map("paid_amount") @db.Decimal(15, 2)
  paidById   String?   @map("paid_by")     // siapa yang menandai lunas
  paidBy     User?     @relation("PaidBy", fields: [paidById], references: [id])
}
```

**Transisi:** `VALID_TRANSITIONS` di [`validations.ts:62`](../src/lib/validations.ts#L62)
menjadi:
```
SUBMITTED → { PAID, CANCELLED, REJECTED, VOID, REVISION }
REVISION  → { SUBMITTED }
PAID, CANCELLED, REJECTED, VOID → terminal
```

**Siapa yang boleh:** `GA_STAFF`, `GA_MANAGER`, `ADMIN`. Vendor **tidak** — tidak boleh ada
pihak yang menyatakan tagihannya sendiri lunas.

**UI:** tombol "Tandai Lunas" di halaman detail invoice, membuka dialog kecil berisi tanggal
bayar (default hari ini) dan jumlah bayar (default `totalAmount`, bisa diubah untuk pembayaran
sebagian). Menulis `AuditLog` dengan `action: 'invoice.paid'`.

**Efek lanjutan:**
- Scan reminder jatuh tempo harus mengecualikan `PAID` — invoice lunas bukan lagi "terbuka".
  Filter status di cron menjadi `{ in: ['SUBMITTED', 'REVISION'] }` seperti sekarang, dan itu
  otomatis benar karena `PAID` adalah status baru yang terpisah.
- Dashboard bisa menampilkan nilai utang berjalan (`SUM(totalAmount) WHERE status = 'SUBMITTED'`).
- Ekspor Excel mendapat kolom `paid_date` dan `paid_amount`.
- `PAID` menjadi salah satu nilai `status` yang bisa disaring lewat `query_invoices` (§5.2).
  **Ini menambah kemampuan chat, bukan membatasinya** — chat tetap bisa memeriksa seluruh
  invoice tanpa filter status apa pun.

---

## 6. Fase 3 — Fitur baru

### 6.1 (3a) Admin mendaftarkan user baru

**Sebagian besar sudah ada.** [`/admin/users`](../src/app/(dashboard)/admin/users/page.tsx)
sudah punya form create + ganti role, dan
[`POST /api/users`](../src/app/api/users/route.ts) sudah hash bcrypt cost 12, validasi Zod,
dan tulis audit log.

**Yang kurang:**
- Email selamat datang berisi kredensial awal (Resend) — dan **paksa ganti password saat login
  pertama**: kolom `users.must_change_password`, middleware mengalihkan ke `/change-password`
  selama masih `true`.
- Toggle aktif/nonaktif user (`isActive` sudah ada di schema tapi belum bisa diubah dari UI).
- Halaman `/change-password` + `PATCH /api/users/me/password`.

### 6.2 (3b) Reminder email

Utilitas baru `src/lib/email.ts` membungkus Resend. Semua pengiriman lewat `after()` dari
Next.js 16 supaya tidak menahan respons HTTP — tidak perlu queue.

| Pemicu | Penerima default | Isi |
|---|---|---|
| Vendor submit invoice pertama kali | GA_STAFF aktif | Invoice baru masuk, perlu diperiksa |
| Status diubah ke `REVISION` | Vendor pemilik invoice (tetap, tidak bisa diubah) | Perlu revisi + isi kolom komentar |
| Cron harian, jatuh tempo ≤N hari | GA_STAFF + GA_MANAGER | Daftar invoice akan jatuh tempo |
| Cron harian, sudah lewat jatuh tempo | GA_STAFF + GA_MANAGER | Daftar invoice terlambat |
| User baru dibuat | User bersangkutan (tetap) | Kredensial awal |

Kolom "penerima default" berarti nilai awal saat seed — semuanya bisa diubah admin lewat
halaman pengaturan (§6.6), kecuali dua baris yang ditandai "tetap" karena penerimanya memang
ditentukan oleh kejadiannya sendiri.

Setiap email juga tetap menulis baris `Notification` supaya lonceng in-app dan email tidak
berbeda isi.

#### 6.2.1 Setup domain pengirim — elaborasi

**Kenapa perlu.** Tanpa domain terverifikasi, Resend hanya mengizinkan pengiriman dari
`onboarding@resend.dev` **dan hanya ke alamat email pemilik akun Resend**. Tidak bisa kirim ke
vendor atau ke tim GA. Jadi ini memblokir seluruh Fase 3b di dunia nyata.

**Rekomendasi: pakai subdomain, jangan domain utama.**
Contoh `notifikasi.perusahaan.co.id`, bukan `perusahaan.co.id`. Dua alasan:
1. **Reputasi pengiriman terpisah.** Kalau nanti ada bounce tinggi atau laporan spam, yang
   rusak reputasinya subdomain — bukan email korporat Anda.
2. **Tidak menyentuh MX domain utama.** Email Outlook/Gmail kantor tidak berisiko terganggu.

**Langkah:**

1. Buat akun Resend → **Domains → Add Domain** → masukkan subdomain, pilih region terdekat.
2. Resend menghasilkan satu set record DNS. Yang perlu ditambahkan:

   | Tipe | Nama | Nilai | Fungsi |
   |---|---|---|---|
   | `MX` | `send` | `feedback-smtp.<region>.amazonses.com` (priority `10`) | Menerima laporan bounce & komplain |
   | `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | SPF — server mana yang boleh mengirim atas nama domain |
   | `CNAME` | `xxxx._domainkey` (**3 record**) | `xxxx.dkim.amazonses.com` | DKIM — tanda tangan kriptografis tiap email |
   | `CNAME` | `links` | `links1.resend-dns.com` | Opsional — tracking buka/klik |

   Nilai `xxxx` di record DKIM di-generate unik per domain; salin persis dari dashboard.

3. Tambahkan di panel DNS penyedia domain (Cloudflare, Niagahoster, DomaiNesia, dll).
4. Klik **Verify** di Resend. Propagasi DNS umumnya 5–30 menit, kadang sampai beberapa jam.
5. Setelah terverifikasi, set env var:
   `EMAIL_FROM="Invoice System <invoice@notifikasi.perusahaan.co.id>"`

**Kesalahan yang paling sering terjadi:**
- Record dipasang di root domain padahal harusnya di subdomain `send`.
- Panel DNS otomatis menambahkan nama domain di belakang (Cloudflare melakukan ini). Isi kolom
  nama dengan `send` saja — kalau ditulis `send.perusahaan.co.id`, hasilnya jadi
  `send.perusahaan.co.id.perusahaan.co.id` dan verifikasi gagal.
- Nilai TXT SPF disalin dengan tanda kutip ganda berlebih atau terpotong.

**DMARC — opsional tapi disarankan.** TXT di `_dmarc.notifikasi.perusahaan.co.id`:
```
v=DMARC1; p=none; rua=mailto:dmarc@perusahaan.co.id
```
Mulai dengan `p=none` (hanya memantau dan mengirim laporan). Setelah beberapa minggu laporan
bersih, naikkan ke `p=quarantine`. Ini yang menaikkan tingkat email masuk inbox, bukan spam.

**Siapa yang mengerjakan.** Butuh akses panel DNS domain perusahaan — biasanya tim IT/infra,
bukan developer aplikasi. **Jadwalkan lebih awal**, karena verifikasi bisa memakan waktu dan
memblokir Fase 3b.

**Sementara DNS belum siap:** pengembangan tetap bisa jalan penuh dengan
`onboarding@resend.dev` → alamat email Anda sendiri. Seluruh kode email bisa selesai dan
diuji; hanya pengiriman ke penerima nyata yang terblokir.

### 6.3 (3c) Vendor memilih PT tujuan saat submit

```prisma
model Company {          // entitas penerima invoice (bill-to)
  id        String   @id @default(uuid())
  name      String            // "PT Sumber Makmur"
  npwp      String?
  address   String?
  city      String?
  email     String?           // tujuan email penagihan
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  invoices  Invoice[]
  @@map("companies")
}
```

`Invoice` mendapat `companyId String? @map("company_id")` — nullable dulu, lalu di-backfill dan
dijadikan wajib di migrasi kedua. Karena data lama akan di-seed ulang (§4.1), backfill-nya
cukup di `seed.ts`.

UI: `<select>` PT di [halaman upload](../src/app/(dashboard)/invoices/upload/page.tsx), diisi
dari `GET /api/companies`. Wajib untuk role VENDOR. Ditampilkan di halaman detail invoice dan
kolom baru di ekspor Excel.

### 6.4 (3d) Admin/GA Staff mengelola PT

Halaman `/admin/companies` + `GET/POST /api/companies` dan `PATCH/DELETE /api/companies/[id]`,
dibatasi `requireRole(['ADMIN', 'GA_STAFF'])`.

Hapus memakai *soft delete* (`isActive = false`) supaya invoice lama tetap punya referensi PT
yang valid. Setiap perubahan menulis `AuditLog`.

### 6.5 (3e) Data vendor lengkap, diisi admin & diedit vendor

`Vendor` sudah punya `name, npwp, contactName, contactEmail, bankName, bankAccount`.
**Tambahan:** `address`, `city`, `phone`, `bankAccountHolder`, `bankBranch`.

PIC yang "terlibat" bisa lebih dari satu, jadi satu tabel terpisah:

```prisma
model VendorContact {
  id        String  @id @default(uuid())
  vendorId  String  @map("vendor_id")
  name      String
  email     String?
  phone     String?
  role      String?          // "Finance", "Sales", dll
  vendor    Vendor  @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  @@map("vendor_contacts")
}
```

Dua jalur akses, dua tingkat izin:

| Aksi | Siapa | Endpoint |
|---|---|---|
| Buat vendor baru | ADMIN | `POST /api/vendors` + halaman `/admin/vendors` |
| Edit semua field vendor mana pun | ADMIN, GA_STAFF | `PATCH /api/vendors/[id]` |
| Edit **profil sendiri** (alamat, rekening, PIC) | VENDOR | `PATCH /api/vendors/[id]` dengan cek `id === session.user.vendorId` |
| Ubah `name`, `npwp` | **hanya ADMIN** | dikunci dari vendor |

Nama PT dan NPWP dikunci dari vendor karena keduanya dipakai mencocokkan dokumen pajak —
vendor yang mengubahnya sendiri akan memutus jejak audit.

Halaman baru `/vendor/profile` untuk role VENDOR.
[`GET /api/vendors`](../src/app/api/vendors/route.ts) sekarang mengembalikan semua vendor ke
semua user yang login — perlu dibatasi supaya VENDOR hanya melihat dirinya sendiri.

### 6.6 (3f) Halaman pengaturan reminder — fitur baru

Saat ini ambang "3 hari sebelum jatuh tempo" dan penerima notifikasi **hardcoded** di
[`reminderScheduler.ts:23,44`](../src/lib/services/reminderScheduler.ts#L23). Mengubahnya butuh
deploy. Diganti dengan tabel konfigurasi yang diedit admin.

```prisma
model ReminderSetting {
  id             String   @id @default(uuid())
  type           String   @unique   // due_soon | overdue | invoice_submitted | revision_requested
  isActive       Boolean  @default(true) @map("is_active")
  daysBefore     Int?     @map("days_before")      // hanya dipakai due_soon
  recipientRoles Json     @map("recipient_roles")  // ["GA_STAFF","GA_MANAGER"]
  extraEmails    Json     @map("extra_emails")     // ["atasan@perusahaan.co.id"]
  emailEnabled   Boolean  @default(true)  @map("email_enabled")
  inAppEnabled   Boolean  @default(true)  @map("in_app_enabled")
  updatedAt      DateTime @updatedAt @map("updated_at")
  updatedById    String?  @map("updated_by")
  updatedBy      User?    @relation("ReminderUpdatedBy", fields: [updatedById], references: [id])
  @@map("reminder_settings")
}
```

**Halaman `/admin/reminders`** (`requireRole(['ADMIN'])`), satu kartu per jenis reminder:

| Kontrol | Keterangan |
|---|---|
| Aktif / nonaktif | Matikan satu jenis reminder tanpa deploy |
| Hari sebelum jatuh tempo | Hanya untuk `due_soon`. Default 3 |
| Role penerima | Multi-pilih dari 4 role yang tersisa |
| Email tambahan | Daftar alamat di luar sistem (atasan, mailing list) |
| Kirim email / notifikasi in-app | Dua sakelar terpisah — bisa in-app saja tanpa email |

API: `GET /api/admin/reminders` dan `PATCH /api/admin/reminders/[type]`. Setiap perubahan
menulis `AuditLog` — pengaturan yang menentukan siapa diberi tahu soal uang adalah hal yang
perlu jejak audit.

`seed.ts` mengisi empat baris default supaya sistem tetap jalan tanpa konfigurasi manual.

**Batasan yang harus disampaikan di UI.** Karena plan Vercel Hobby membatasi cron **sekali
sehari dengan ketepatan ±60 menit** (§4.2), halaman ini **tidak boleh** menyediakan pengaturan
jam kirim atau frekuensi — janji yang tidak bisa ditepati platform lebih buruk daripada tidak
ada pengaturannya. Cukup tampilkan teks kecil: *"Reminder dikirim sekali sehari pada dini
hari."* Kalau nanti naik ke Pro atau pindah ke GCP, pengaturan frekuensi bisa ditambahkan
karena modelnya sudah siap.

**Jangan dibingungkan dengan halaman `/reminders` yang sudah ada** — itu feed notifikasi milik
user (baca saja). Yang ini `/admin/reminders`, konfigurasi. Beri label menu yang jelas:
"Reminders" vs "Pengaturan Reminder".

---

## 7. Kualitas & rilis

- **Tambahkan `tsc --noEmit` ke pipeline.** Ini yang mencegah kejadian §2 terulang; `npm test`
  sendiri tidak melakukan type-check.
- GitHub Action: `npm ci` → `tsc --noEmit` → `npm run lint` → `npm test` pada setiap PR.
- Test unit baru: parameter tool `query_invoices`, pemilihan penerima email dari
  `ReminderSetting`, validasi `companyId` wajib untuk VENDOR, aturan izin edit profil vendor,
  gating role chat, transisi `SUBMITTED → PAID` dan penolakan `PAID → *`.
- **8 kasus di [`rbac.test.ts`](../src/lib/auth/__tests__/rbac.test.ts) memakai role yang
  dihapus** — harus ditulis ulang dengan 4 role yang tersisa, bukan sekadar dihapus.
- 35 test yang ada harus tetap hijau di setiap tahap.
- Seed sudah dijaga terhadap `NODE_ENV=production` — dipertahankan.

**Variabel environment baru di Vercel:**

```
DATABASE_URL              # Supabase pooler
DIRECT_URL                # Supabase direct (migrasi)
NEXTAUTH_SECRET
NEXTAUTH_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY # server-only, jangan pernah diberi prefix NEXT_PUBLIC_
GEMINI_API_KEY
RESEND_API_KEY
EMAIL_FROM
CRON_SECRET
```

`SUPABASE_SERVICE_ROLE_KEY` melewati semua Row Level Security. Kunci ini **hanya boleh** dipakai
di route handler / server action, tidak pernah di komponen client.

**Urutan rilis:**

1. Blocker `prisma.ts` (§2)
2. **Penyederhanaan role (§4.9)** — dikerjakan lebih dulu dari apa pun yang lain, karena setiap
   fitur baru menyentuh `requireRole`. Mengerjakannya belakangan berarti menulis ulang izin
   yang baru saja ditulis.
3. Sisa Fase 1 (storage, cron, koneksi Supabase)
4. Deploy preview & verifikasi upload + cron benar-benar jalan
5. Fase 2 (Gemini, chat, pelacakan pembayaran)
6. Fase 3 (fitur baru)
7. Produksi

Fase 1 harus terbukti hidup di Vercel sebelum Fase 3 dikerjakan; kalau storage atau cron
bermasalah, lebih baik ketahuan sebelum ada enam fitur menumpuk di atasnya.

---

## 8. Estimasi effort

| Fase | Pekerjaan | Hari |
|---|---|---|
| 0 | Perbaiki build blocker (`prisma.ts`) | 0,5 |
| 1 | **Penyederhanaan role** — enum, ±20 titik, tes, dokumen (§4.9) | 1,0 |
| 1 | Supabase Storage (tanpa migrasi data) | 1,0 |
| 1 | Vercel Cron menggantikan node-cron | 0,5 |
| 1 | SSE → polling, pembersihan rate limit | 0,5 |
| 1 | Koneksi Supabase (pooler/direct) + setup env | 1,0 |
| 1 | Deploy preview & verifikasi end-to-end | 1,0 |
| 2 | Ekstraksi Gemini + hapus `ai-service/` | 2,0 |
| 2 | **Pelacakan pembayaran** — `PAID`, tombol lunas, dashboard (§5.3) | 1,5 |
| 2 | Chatbot + tool `query_invoices` | 1,0 |
| 3a | Email selamat datang, ganti password, toggle aktif | 1,0 |
| 3b | Resend + 5 pemicu email | 1,5 |
| 3c | Model `Company` + pilihan PT saat submit | 1,0 |
| 3d | Halaman & API kelola PT | 1,0 |
| 3e | Data vendor lengkap + `VendorContact` + halaman profil | 2,0 |
| 3f | **Halaman pengaturan reminder** (§6.6) | 1,5 |
| — | Test, dokumentasi, rilis produksi | 2,0 |
| | **Total** | **20 hari** (±4 minggu) |

Naik dari 16 hari karena tiga tambahan: penyederhanaan role (+1), pelacakan pembayaran (+1,5),
dan halaman pengaturan reminder (+1,5). Ketiganya keputusan Anda dan semuanya bernilai —
tapi angkanya bergerak, jadi disampaikan apa adanya.

Fase 2 dan Fase 3 sebagian bisa paralel bila ada dua developer; keduanya bergantung pada
penyederhanaan role selesai lebih dulu. Setup DNS (§6.2.1) dikerjakan tim IT dan bisa berjalan
paralel sejak hari pertama.

---

## 9. Risiko terbuka

| Risiko | Dampak | Status / Mitigasi |
|---|---|---|
| Free tier Gemini memakai data untuk training | NPWP & rekening vendor dipakai Google | **Diterima sementara.** Jangan pakai data produksi saat development; pindah paid tier = 1 env var |
| Rate limit free tier Gemini | OCR gagal saat unggahan menumpuk | Retry + backoff; state invoice tidak berubah saat gagal; user bisa ulang |
| Cron Hobby hanya harian | Reminder tidak bisa per jam | Harian memadai untuk jatuh tempo; jadi alasan konkret naik ke Pro bila perlu |
| Rate limit per-instance di serverless | Batas efektif lebih longgar | Diterima; Upstash bila kuota Gemini cepat habis |
| Domain Resend belum terverifikasi | Email tidak sampai ke penerima nyata | **Blocker Fase 3b** — jadwalkan DNS sejak awal (§6.2.1) |
| Sistem tidak melacak pembayaran | Chatbot tidak bisa jawab "belum dibayar" | **Diselesaikan** — status `PAID` (§5.3) |
| Migrasi enum `Role` | Gagal bila masih ada baris memakai role lama | Data di-seed ulang; `UPDATE` pengaman tetap dijalankan (§4.9) |
| Fallback `?? 'VIEWER'` di Sidebar/TopBar | Role hilang → UI menebak izin sebelum session termuat | Ganti dengan skeleton, bukan role lain (§4.9) |
| Supabase free tier: 1GB storage, 500MB DB | Kehabisan kuota | ±10.000 invoice PDF; pantau, Pro $25/bln bila perlu |
| Kemungkinan pindah GCP | — | Stack sudah portabel; hanya cron yang terikat Vercel (§4.7) |

---

## 10. Yang masih perlu diputuskan

Semua keputusan arsitektur sudah diambil. Sisanya hal operasional yang tidak memblokir mulai
kerja:

1. **Subdomain pengirim email** — nama subdomain, dan siapa PIC yang punya akses panel DNS.
   Diperlukan sebelum Fase 3b, bukan sebelum mulai.
2. **Pembayaran sebagian** — apakah satu invoice bisa dibayar bertahap? Desain sekarang
   menyimpan `paid_amount` sehingga *mencatat* pembayaran sebagian mungkin, tapi statusnya
   langsung `PAID` (terminal). Kalau butuh `PARTIALLY_PAID` sebagai status antara, itu tambahan
   ±0,5 hari. **Asumsi saat ini: tidak perlu** — satu invoice, satu pembayaran.

---

## 11. Ringkasan perubahan role

Referensi cepat setelah §4.9 selesai.

| | ADMIN | GA_MANAGER | GA_STAFF | VENDOR |
|---|:---:|:---:|:---:|:---:|
| Lihat semua invoice | ✅ | ✅ | ✅ | hanya miliknya |
| Buat & upload invoice | ✅ | ✅ | ✅ | hanya miliknya |
| Ubah status invoice | ✅ | ✅ | ✅ | hanya `REVISION → SUBMITTED` |
| **Tandai lunas (`PAID`)** | ✅ | ✅ | ✅ | ❌ |
| Catat `deliveredDate` / PIC | ✅ | ✅ | ✅ | ❌ |
| **Chat AI** | ✅ | ✅ | ❌ | ❌ |
| Audit log | ✅ | ✅ | ❌ | ❌ |
| Kelola user | ✅ | ❌ | ❌ | ❌ |
| Kelola PT (`Company`) | ✅ | ❌ | ✅ | ❌ |
| Kelola data vendor | ✅ | ✅ | ✅ | profilnya sendiri |
| **Pengaturan reminder** | ✅ | ❌ | ❌ | ❌ |
| Feed notifikasi sendiri | ✅ | ✅ | ✅ | ✅ |

Dihapus: `FINANCE`, `MANAGER`, `VIEWER`.

# Deploy ke Railway (UAT)

**Dibuat:** 2026-09-11 · **Status:** konfigurasi siap, menunggu token Railway · **Target:** lingkungan UAT yang bisa dibuka beberapa penguji

Dokumen ini melengkapi [`UAT_AND_CUTOVER.md`](./UAT_AND_CUTOVER.md), yang tetap jadi sumber kebenaran
untuk **matriks variabel environment**, **akun uji**, dan **8 skenario UAT wajib**. Yang ada di sini
hanya lapisan hosting: kenapa Railway, apa yang berubah di repo, dan urutan perintah deploy.

---

## 1. Kenapa Railway (dan kenapa bukan yang lain)

Keputusan diambil setelah membandingkan enam opsi terhadap kebutuhan nyata aplikasi ini: proses Node
yang hidup terus (bukan serverless), Postgres, unggahan file yang harus bertahan, SSE OCR yang bisa
jalan >60 detik, satu variabel `NEXT_PUBLIC_` yang harus ada saat **build**, dan pengguna di Indonesia.

| Platform | Putusan | Biaya UAT | Penghalang utama |
|---|---|---|---|
| **Railway** | **dipilih** | **~$5–12/bln** | Cron-nya menjalankan perintah, bukan URL (lihat §6) |
| Render | layak | $7–25/bln | RAM mentok **512 MB** di Starter — `exceljs` + `react-pdf` + Gemini SDK realistis OOM; free tier tidur 15 menit |
| Fly.io | layak | **~$47/bln** | Managed Postgres mulai $38/bln, ~85% dari tagihan |
| DigitalOcean App Platform | berisiko | $17/bln | **Timeout request 100 detik, tidak bisa diubah** — rute OCR dirancang jalan 60 detik+; **tidak ada volume persisten** |
| Cloudflare Workers | tidak cocok | $5/bln | Prisma 7 di Workers masih kena bug terbuka (Wasm codegen); tidak ada Postgres kelas satu; perlu port besar |
| VPS + Docker Compose | murah | ~$6–12/bln | Paling murah dan paling fleksibel, tapi semua ops (TLS, backup, patching) jadi tanggung jawab sendiri |

Empat alasan Railway menang untuk kondisi sekarang:

1. **Region Singapura** (`asia-southeast1`) — ~25–40 ms dari Jakarta, terbaik di antara semua PaaS di atas.
2. **Volume menghapus ketergantungan Supabase.** `fileService.ts:5` menulis ke
   `join(process.cwd(), 'uploads', 'invoices')` saat Supabase tidak dikonfigurasi. Workdir image ini
   `/app`, jadi volume yang di-mount di `/app/uploads` membuat jalur fallback itu **persisten tanpa
   satu baris perubahan kode** — penting karena kredensial Supabase yang ada sudah tidak valid.
3. **Tidak ada plafon timeout request**, sehingga SSE OCR tidak perlu dipikirkan. Batas 30 dtk/60 dtk
   selama ini hanya hidup di `vercel.json` dan tidak pernah ada di kode.
4. **Bisa didorong dari CLI hampir sepenuhnya**, jadi deploy tidak bergantung pada klik dashboard.

Bukan jalan buntu: custom domain, TLS otomatis, penambahan replika dan region lain tersedia kalau
aplikasi naik ke produksi.

---

## 2. Yang berubah di repo

Lima file, sengaja sekecil mungkin. Tidak ada logika bisnis yang disentuh.

| File | Perubahan | Kenapa |
|---|---|---|
| `next.config.ts` | `output: "standalone"` | Menghasilkan `.next/standalone/server.js` supaya image runtime tidak perlu `node_modules`. Diabaikan oleh `next dev`/`next start`. |
| `Dockerfile` | **baru** | Build 3 tahap. Sengaja Dockerfile biasa, bukan buildpack Railway, supaya image yang sama jalan di Render/Fly/Cloud Run/VM — UAT tidak mengunci pilihan produksi. |
| `.dockerignore` | **baru** | Menjaga `.env*`, `.git`, `uploads/`, `docs/` keluar dari konteks build. |
| `railway.json` | **baru** | Menunjuk builder ke Dockerfile, healthcheck ke `/api/health`, restart `ON_FAILURE`. |
| `src/app/(auth)/login/page.tsx` | 8 baris | Tombol login sekali-klik kini muncul juga saat `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`, bukan hanya saat `next dev`. |
| `.env.example` | dokumentasi | Menambah `NEXT_PUBLIC_ENABLE_DEMO_LOGIN`, dan memperbaiki `AUTH_TRUST_HOST=` → `AUTH_TRUST_HOST=true` (lihat §5). |

### Kenapa tombol demo butuh perubahan kode

`page.tsx` memagari blok tombol dengan `process.env.NODE_ENV === 'development'`. Next.js menyulih
nilai itu saat **build**, jadi pada build produksi ekspresinya terlipat jadi `false` dan seluruh markup
dibuang oleh dead-code elimination — diverifikasi: `.next/static/` hasil build produksi tidak
mengandung `gastaff@sip.id` maupun `demo1234` sama sekali. Tidak ada variabel runtime yang bisa
menghidupkannya kembali. Karena itu gerbangnya sekarang:

```ts
const demoLoginEnabled =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true'
```

Perilaku produksi tidak berubah selama variabel itu tidak diset.

### Konsekuensi build-time yang mudah terlewat

`NEXT_PUBLIC_*` disulih ke bundle klien saat `next build`, **bukan** dibaca saat runtime. Di Railway,
variabel service baru masuk ke build Docker kalau dideklarasikan `ARG` di stage yang membutuhkannya —
Docker mengisolasi build dari environment host secara sengaja. Dockerfile ini sudah mendeklarasikan
keduanya di stage `builder`. Menyetel `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` hanya sebagai variabel runtime
**tidak melakukan apa-apa, tanpa error**.

---

## 3. Variabel environment untuk service aplikasi

Nama dan perilaku "kalau hilang" ada di `.env.example` dan §1.1 `UAT_AND_CUTOVER.md`. Yang khas Railway:

| Variabel | Nilai | Catatan |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Referensi Railway → alamat **jaringan privat**, tidak kena biaya egress |
| `AUTH_TRUST_HOST` | `true` | **Wajib.** Tanpa ini setiap request auth gagal `UntrustedHost` sejak boot pertama |
| `NEXTAUTH_URL` | `https://<domain>.up.railway.app` | Origin publik persis; juga jadi URL tombol di email notifikasi |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | Harus beda dari produksi — sesi adalah JWT stateless |
| `CRON_SECRET` | string acak | Tanpa ini `/api/cron/reminders` balas 503 selamanya |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | *(kosongkan)* | Hanya untuk Supabase. Postgres Railway lewat jaringan privat tidak butuh |
| `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` | `true` | **Build arg**, bukan runtime saja |
| `NEXT_PUBLIC_DEMO_PASSWORD` | sama dengan `DEMO_PASSWORD` saat seed | **Build arg.** Kalau beda, tombol demo gagal login |
| `GOOGLE_API_KEY` | kunci AI Studio | Opsional — tanpa ini OCR dan chat mati, sisanya jalan |
| `RESEND_API_KEY` | kunci Resend | Opsional — tanpa ini email no-op, notifikasi in-app tetap jalan |

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` **sengaja dikosongkan**, supaya unggahan jatuh ke
volume. Mengisi salah satunya saja tidak akan gagal secara mencolok — unggahan tetap "berhasil" ke
disk ephemeral dan baru terlihat rusak belakangan sebagai ENOENT.

---

## 4. Urutan deploy

Prasyarat: `RAILWAY_API_TOKEN` (token **akun**, bukan project token) dari
<https://railway.com/account/tokens>.

```bash
export RAILWAY_API_TOKEN=...

# 1. Project + Postgres
railway init --name invoice-tracking-uat --json
railway add --database postgres --json

# 2. Service aplikasi dari direktori ini
railway add --service app --json

# 3. Volume untuk unggahan — /app adalah workdir image
railway volume add --service app --mount-path /app/uploads --json

# 4. Variabel (lihat §3). NEXT_PUBLIC_* ikut terbawa ke build lewat ARG.
railway variables --service app \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set 'AUTH_TRUST_HOST=true' \
  --set "NEXTAUTH_SECRET=$(openssl rand -base64 32)" \
  --set "CRON_SECRET=$(openssl rand -hex 16)" \
  --set 'NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true' \
  --set 'NEXT_PUBLIC_DEMO_PASSWORD=<sama-dengan-DEMO_PASSWORD>'

# 5. Domain, lalu isi NEXTAUTH_URL dengan hasilnya dan deploy
railway domain --service app --port 3000
railway variables --service app --set 'NEXTAUTH_URL=https://<domain>'
railway up --service app --ci
```

### Migrasi dan seed

Image runtime **tidak** memuat CLI Prisma (standalone sengaja ramping), jadi 15 migrasi dijalankan
dari mesin lokal lewat TCP proxy publik Railway — bukan alamat `.internal`, yang hanya hidup di dalam
jaringan Railway:

```bash
UAT_DB=$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)

DIRECT_URL="$UAT_DB" DATABASE_URL="$UAT_DB" npx prisma migrate deploy

# ⚠️ MENGHAPUS seluruh tabel lebih dulu. Guard host non-lokal ada di seed.ts:57.
SEED_ALLOW_REMOTE=yes-i-know \
DIRECT_URL="$UAT_DB" DATABASE_URL="$UAT_DB" \
ADMIN_PASSWORD='<rahasia-uat>' DEMO_PASSWORD='<sama-dengan-NEXT_PUBLIC_DEMO_PASSWORD>' \
npm run db:seed
```

`ADMIN_PASSWORD` **harus** diisi: default-nya adalah literal di `prisma/seed.ts:89` yang sudah ada di
riwayat git publik. Mengisinya membuat default itu tidak pernah terpakai.

### Verifikasi setelah deploy

1. `GET /api/health` → `200 {"status":"ok","app":"ok","db":"ok"}`. Kalau `503`, `DATABASE_URL` salah.
2. Buka `/login` → empat tombol demo terlihat. Kalau tidak, `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` tidak ikut
   saat build (bukan masalah runtime) — deploy ulang, jangan hanya ubah variabel.
3. Klik `admin` → masuk dashboard. Kalau gagal dengan `UntrustedHost`, `AUTH_TRUST_HOST` belum ada.
4. Unggah satu dokumen, lalu **redeploy** dan buka lagi — membuktikan volume persisten, bukan disk ephemeral.
5. Jalankan 8 skenario di §1.5 `UAT_AND_CUTOVER.md`.

---

## 5. Satu jebakan yang diperbaiki di `.env.example`

Baris `AUTH_TRUST_HOST=` (kosong) lebih buruk daripada tidak ada sama sekali. NextAuth menghitung:

```js
config.trustHost ??= !!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== "production")
```

`??` hanya melompati `null`/`undefined`. String kosong **bukan** keduanya, jadi rantai berhenti di
situ dan menghasilkan `!!"" === false` — mematikan `trustHost` bahkan di development, di mana nilai
yang tidak diset justru akan menyalakannya. Placeholder-nya kini `AUTH_TRUST_HOST=true`.

---

## 6. Yang sengaja belum dikerjakan

| Item | Alasan | Kapan dibereskan |
|---|---|---|
| **Cron reminder harian** | Cron Railway menjalankan *start command* sebuah service dan menunggunya keluar; ia tidak memanggil URL, jadi blok `crons` di `vercel.json` mati di sini. Untuk UAT rute ini bisa dipicu manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/reminders` | Sebelum produksi — tambah service `curlimages/curl` kecil, atau cron eksternal |
| **Migrasi otomatis saat deploy** | Butuh CLI Prisma di image runtime (~+80 MB). Selama UAT skema stabil dan langkah manual sekali cukup | Kalau skema sering berubah selama UAT |
| **`bcryptjs` ada di `devDependencies`** | Diimpor kode runtime (`auth.ts:3` dan 3 rute user). Build ini aman karena `npm ci` memasang dev deps dan output tracing menelusuri impor sungguhan — tapi tetap salah tempat, dan akan meledak kalau ada yang menambahkan `--omit=dev` | Pindahkan satu baris ke `dependencies` |
| **Satu instance saja** | Volume Railway hanya bisa menempel ke satu instance, dan `rate-limit.ts` menyimpan state di memori per proses | Sebelum menaikkan replika: pindah ke object storage + limiter bersama |
| **Password admin bootstrap** | Literal di `prisma/seed.ts:89`, sudah ada di riwayat git publik | **Wajib** rotasi sebelum produksi |
| **Tombol demo di halaman login** | Mengirim kredensial seed dari bundle klien. Aman hanya karena akun-akun itu memang throwaway | Matikan `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` sebelum produksi |

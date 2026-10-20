# Panduan Deploy Cloudflare D1 + R2 Backend (Jira Mini)

Hanya butuh 3 langkah singkat via terminal:

### 1. Buat Database D1 & R2 Bucket
Buka terminal di folder `C:\KERJAAN\Project\jira-mini\cloudflare`:

```bash
# 1. Login ke Cloudflare (jika belum)
npx wrangler login

# 2. Buat database D1
npx wrangler d1 create jira-db

# 3. Buat bucket R2 untuk foto evidence
npx wrangler r2 bucket create jira-evidence
```

### 2. Update `wrangler.toml` & Jalankan Schema
* Salin `database_id` hasil perintah create D1 ke dalam file `wrangler.toml`.
* Eksekusi schema tabel:
```bash
npx wrangler d1 execute jira-db --file=./schema.sql --remote
```

### 3. Deploy Worker API
```bash
npx wrangler deploy
```

Setelah deploy, kamu akan mendapatkan URL Worker seperti:
`https://jira-mini-backend.yourname.workers.dev`

Tinggal masukkan URL tersebut ke menu **Cloudflare Sync** di web Jira Mini.

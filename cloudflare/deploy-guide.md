# Panduan Deploy Cloudflare Backend (Jira Mini)

Akun Cloudflare: `30a697e36a3b4e6299a11a61da9b5906`
R2 Bucket: `jira-mini`

### 1. Buat Database D1
Bucket R2 `jira-mini` sudah ada. Sekarang tinggal buat database D1:
```bash
cd C:\KERJAAN\Project\jira-mini\cloudflare

# Buat database D1
npx wrangler d1 create jira-db
```

### 2. Pasang Database ID ke `wrangler.toml` & Jalankan Schema
Salin `database_id` hasil perintah di atas ke file `wrangler.toml`, lalu inisialisasi tabel:
```bash
npx wrangler d1 execute jira-db --file=./schema.sql --remote
```

### 3. Deploy Worker API
```bash
npx wrangler deploy
```

Setelah deploy, salin URL Worker (misal: `https://jira-mini-backend.xxx.workers.dev`) dan masukkan ke menu **Cloud Sync > ⚡ Cloudflare D1 + R2** di aplikasi Jira Mini.

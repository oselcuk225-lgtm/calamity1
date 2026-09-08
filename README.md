# CALAMITY License Server (Vercel + Neon)

CS2 cheati (CALAMITY) için **key/lisans yönetim sistemi**. Site (kullanıcı paneli + admin paneli) + REST API içerir. **Vercel** (serverless) üzerinde çalışır, veritabanı **Neon Postgres**.

## Özellikler

- **Kullanıcı sistemi**: Kayıt / giriş (bcrypt şifre + JWT oturum)
- **Admin paneli** (aynı sitede, admin hesabıyla otomatik görünür): kullanıcı yönetimi, key üretme/atama/iptal
- **Key türleri**: `day` (gün) / `week` (hafta) / `month` (ay) / `year` (yıl) / `unlimited` (sınırsız)
- **Kullanıcı paneli**: key aktivasyon, kendi key'lerini görüntüleme
- **Loader API**: `activate` ve `validate` endpoint'leri loader'a bağlanır
- **HWID koruması**: key ilk aktivasyonda makineye bağlanır; farklı HWID reddedilir

## Deploy — Vercel (Ana Akış)

### 1. Neon (Postgres) oluştur
1. [neon.tech](https://neon.tech) → hesap aç
2. Yeni project oluştur → **Connection string** kopyala
   - `postgresql://user:pass@ep-xxx-xxx.ap-1.aws.neon.tech/dbname?sslmode=require`
   - **Not**: Vercel'de değil Neon'da oluşturulur, bağımsız çalışır.

### 2. Vercel'e projeyi yükle
1. `LicenseServer/` klasörünü bir GitHub repo'suna push et
   - kökte şunlar olmalı: `api/`, `public/`, `src/`, `server.js`, `vercel.json`, `package.json`
2. [vercel.com](https://vercel.com) → **New Project** → repo'yu seç (framework: *Other*)
3. **Environment Variables** ekle:
   | Ad | Değer |
   |---|---|
   | `DATABASE_URL` | Neon connection string |
   | `ADMIN_USER` | ilk admin kullanıcı adı |
   | `ADMIN_PASS` | ilk admin şifresi |
   | `JWT_SECRET` | uzun rastgele anahtar |
4. **Deploy** → bitince sana `https://projen.vercel.app` verir

### 3. İlk admin
Şema ilk istekte tabloları oluşturur ve `ADMIN_USER`/`ADMIN_PASS`'ten ilk **admin** hesabını açar. Siteye gir:
- Kullanıcı paneli: `https://projen.vercel.app/`
- Admin paneli: `https://projen.vercel.app/admin`

### 4. Yerel test (isteğe bağlı)
```bash
cd LicenseServer
npm install
cp .env.example .env   # DATABASE_URL / admin / secret doldur
npm start              # http://localhost:3000
```

## API Uç Noktaları

### Auth
| Metot | Yol | Açıklama |
|---|---|---|
| POST | `/api/auth/register` | Kayıt `{username, password}` |
| POST | `/api/auth/login` | Giriş `{username, password}` → token |
| GET | `/api/auth/me` | Token sahibi + kendi key'leri (Bearer token) |

### Admin (Bearer token + admin rolü)
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/api/admin/stats` | Genel istatistik (toplam/aktif/iptal key, kullanıcı) |
| GET | `/api/admin/users` | Kullanıcı listesi (+key sayısı) |
| POST | `/api/admin/users` | Kullanıcı ekle `{username, password, role?}` |
| PATCH | `/api/admin/users/:id` | Rol değiştir `{role: user|admin|banned}` |
| DELETE | `/api/admin/users/:id` | Kullanıcı sil |
| POST | `/api/admin/keys` | Key üret `{duration_type, value?, count?, userId?}` |
| GET | `/api/admin/keys` | Tüm key'ler (sahip adıyla) |
| PATCH | `/api/admin/keys/:id/revoke` | Key iptal / geri al |

### Loader (cheat loader'ı bu çağırır)
| Metot | Yol | Açıklama |
|---|---|---|
| POST | `/api/license/activate` | Key aktifleştir `{key, hwid}` (kullanıcı token'ı) |
| POST | `/api/license/validate` | Key doğrula `{key, hwid}` → loader açılır/kapanır |
| POST | `/api/license/hwid` | HWID üret `{mac}` → sha256 hash |

## Loader'a Bağlama

Loader (C++), `calamity.dll`'i enjekte etmeden önce:

1. Makine HWID'sini oku, isteğe bağlı `/api/license/hwid` ile hash üret
2. Kullanıcının key'ini al
3. `POST https://projen.vercel.app/api/license/validate` → `{key, hwid}` çalıştır
   - `ok:true` → devam, enjekte et
   - `ok:false` → `error` mesajını göster, durdur

`validate` herkese açıktır (loader token taşımaz); güvenliği key'i bilmek + HWID eşleşmesi sağlar.

## Key Üretme Örneği (curl)

```bash
TOKEN=$(curl -s -X POST https://projen.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SIFRE"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 5 adet aylık key üret
curl -X POST https://projen.vercel.app/api/admin/keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"duration_type":"month","count":5}'
```

## Production Notları

- **CORS**: `server.js` içinde `*` açık — Vercel domain'inin key'i aynı origin'de; loader CORS'a takılmaz (sunucu tarafı istek). Gerekirse domain'e daralt.
- **DATABASE_URL**: Neon "pooled" connection string (port 5432, `-pooler` host) kullanman daha iyidir — serverless bağlantı havuzu için.
- **Yedek**: Neon dashboard'dan **Branch + Point-in-Time** yedeğini kullan.
- **Ban**: kullanıcı rolünü `banned` yapınca login engellenir.
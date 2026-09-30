# Lig & Eleme Takip

Turnuva takip uygulaması: oyuncular, çift devreli lig fikstürü, puan durumu, eleme braketi ve oyuncu istatistikleri.
Sunucu veya derleme gerektirmez — saf HTML/CSS/JS, veriler tarayıcının `localStorage`'ında tutulur.

## Özellikler

- **Oyuncular** — ekle / yeniden adlandır / sil (bağlı maçlar da temizlenir), aynı isim engellenir
- **Oyuncu profili** — sıra, puan, galibiyet %, set/oyun averajı, form (son 5), galibiyet serisi, en farklı galibiyet/yenilgi,
  rakip bazlı karşılaştırma tablosu ve tüm maç geçmişi
- **Fikstür** — dairesel (Berger) yöntemle turlara bölünmüş tek veya çift devreli lig; tek sayıda oyuncuda bay geçme
- **Puan durumu** — puan, set ve oyun averajı; eşitlikte ikili averaj (head-to-head) ile çözüm
- **Eleme** — standart seri başı eşleşmesi (1-8, 4-5, 2-7, 3-6), eksik seri başı yerine **BAY**, tur tur ilerleme, şampiyon/ikinci
- **Skor girişi — iki mod** (maç ekranından anında değiştirilir, tercih hatırlanır):
  - **Hızlı giriş** — maç bittikten sonra: her setin oyun skorunu tek dokunuşla gir (3-0 / 3-1 / 3-2)
  - **Detaylı giriş** — oynarken: her oyunun sayısını gir (5-0 … 5-4), 3 oyunda set kendiliğinden kapanır, "son oyunu geri al" var
  - İki mod aynı maçta karışık kullanılabilir; detaylı girilen setlerin oyun skorları saklanır ve her yerde gösterilir
- **Fikstür görünümü** — turlara göre veya **oyunculara göre** (her oyuncunun adı altında kendi maçları; tarih atanmaz)
- **Veri** — JSON yedek alma / yükleme, skorları temizleme, tam sıfırlama; eski kayıtlar otomatik göç eder

## Skorlama sistemi

| Birim | Kural | Uygulamaya girilir mi? |
|---|---|---|
| Oyun | 5 sayıya oynanır | sadece detaylı modda |
| Set | 3 oyunu ilk alan kazanır → 3-0, 3-1, 3-2 | ✅ her iki modda |
| Maç | 2 seti ilk alan kazanır (best of 3) | otomatik |

Puanlama varsayılanı galibiyet 2 / mağlubiyet 0, lig çift devreli, elemeye ilk 8.
Hepsi **Ayarlar** sekmesinden değiştirilebilir (set başına 1–5 oyun, maç başına 1–5 set).

## Yerel çalıştırma

```bash
cd public && python3 -m http.server 4173
```

Ardından http://localhost:4173 adresini aç. Bu haliyle uygulama **yerel modda** çalışır (bulut API'si yok).
`public/index.html` dosyasını doğrudan çift tıklayarak da açabilirsin (klasik `<script>` etiketleri, ES modülü yok).
API'yi de çalıştırmak için aşağıdaki "Yerel geliştirme" bölümüne bak.

## Ortak tablo (Cloudflare Pages + D1)

**Siteyi açan herkes aynı tabloyu görür.** Kod girmek, link paylaşmak, hesap açmak yok —
adres tek başına yeterli. Veriler Cloudflare D1'de durur.

- **Okuma herkese açık** — adresi açan herkes fikstürü, puan durumunu, istatistikleri görür.
- **Yazma PIN ister** — PIN **sunucuda** doğrulanır (PBKDF2-SHA256, 120k tur). Doğru PIN 12 saatlik
  imzalı token verir; 8 hatalı denemede 10 dakika kilit.
- **İlk açılışta kurulum** — ortak tablo henüz yoksa ilk giren kişi turnuva adı + PIN belirler.
  Bir kez yapılır; sonra gelen herkes doğrudan tabloyu görür.
- **Çevrimdışı çalışır** — bağlantı yokken skorlar yerel kaydedilir, kuyruğa girer, bağlantı gelince gönderilir.
- **Aynı anda birden fazla kişi skor girebilir** — sunucuya tüm state değil sadece değişen parça (patch)
  gider; farklı maçları girenler birbirini ezmez.
- **Canlı takip** — 8 saniyede bir sürüm yoklanır, değişiklik varsa ekran kendiliğinden güncellenir.
- Tema ve giriş modu **cihaza özeldir**, paylaşılmaz.

Birden fazla turnuva gerekirse: sağ üstteki rozet → "Farklı bir turnuva" → kod. O turnuvanın adresi
`.../#/t/KOD` olur. Ortak tablo her zaman sade adreste kalır.

### Kurulum (tek seferlik)

```bash
npm i -D wrangler          # Node 22+ gerekir
npx wrangler login
npx wrangler d1 create lig
```

Çıkan `database_id` değerini `wrangler.toml` içine yapıştır. Sonra şemayı ve gizli anahtarı kur:

```bash
npx wrangler d1 execute lig --remote --file=./schema.sql
npx wrangler pages secret put AUTH_SECRET
```

`AUTH_SECRET` uzun ve rastgele olmalı (`openssl rand -hex 32`). Token imzası bununla üretilir —
değiştirirsen herkesin yazma oturumu düşer.

### Yayına alma

GitHub reposunu Cloudflare Pages'e bağla (Workers & Pages → Create → Pages → Connect to Git).
Build komutu **yok**, output dizini **`public`**. Ayarlardan D1 binding'ini (`DB` → `lig`) ve
`AUTH_SECRET`'i production ortamına ekle. Sonrası `git push` ile otomatik deploy.

### Yerel geliştirme (API dahil)

```bash
echo 'AUTH_SECRET="yerel-test"' > .dev.vars
npx wrangler d1 execute lig --local --file=./schema.sql
npx wrangler pages dev --port 8788
```

Sadece arayüzle uğraşıyorsan `cd public && python3 -m http.server 4173` yeterlidir (uygulama yerel modda çalışır).

### API

| Yöntem | Yol | Yetki | Açıklama |
|---|---|---|---|
| POST | `/api/tournaments` | — | Turnuva oluşturur, token döner |
| GET | `/api/tournaments/:kod` | — | State'i döner |
| GET | `/api/tournaments/:kod/version` | — | Yoklama için sürüm numarası |
| POST | `/api/tournaments/:kod/auth` | PIN | Token verir |
| POST | `/api/tournaments/:kod/patch` | Token | Patch uygular, yeni state döner |

Sunucu oyun kurallarını bilmez; yalnızca patch uygular ve boyut/oturum doğrular. Kural mantığı
tek yerde — `public/js/rules.js` — durur.

## Dosya yapısı

```
public/                     ← yayınlanan tek klasör
  index.html
  assets/styles.css         arayüz
  assets/icon.svg
  js/util.js                kaçış, toast, dialog yardımcıları
  js/store.js               durum, localStorage, sürüm göçü, yedekleme, patch üretimi
  js/sync.js                bulut turnuvası: token, patch kuyruğu, yoklama, çevrimdışı
  js/rules.js               set/oyun kuralları ve skor doğrulama
  js/schedule.js            round-robin fikstür üretimi
  js/standings.js           puan durumu, ikili averaj, oyuncu istatistikleri
  js/playoffs.js            eleme braketi ve seri başı düzeni
  js/ui.js                  render katmanı
  js/app.js                 olay bağlama ve komutlar
functions/api/              Cloudflare Pages Function (turnuva API'si)
schema.sql                  D1 şeması
wrangler.toml               Cloudflare yapılandırması (public/ dışında → servis edilmez)
```

## Veri uyarısı

**Yerel modda** veriler yalnızca kullandığın tarayıcıda saklanır; tarayıcı verisini silmek uygulamayı da siler.
**Bulut turnuvasında** veriler D1'de durur, tarayıcıdaki kopya önbellektir. Her iki durumda da
**Ayarlar → Yedek Al** ile JSON yedeği almak en garantisi.

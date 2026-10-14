<p align="right"><a href="CONTRIBUTING.md">English</a> · <b>Türkçe</b></p>

# Katkı

Yardım etmek istediğin için teşekkürler. Kayıtlar, fikirler, kural şablonları, çeviriler ve kod hoş karşılanır; ilk katkı güler yüzle incelenir.

## Başlamadan önce

- **Küçük düzeltmeler** (yazım hatası, daha açık bir ileti, başarısız bir test): doğrudan pull request aç.
- **Büyük değişiklikler** (yeni bir özellik, yeni bir kural, kemerin komut okuma biçiminde değişiklik): önce bir kayıt (issue) aç; zaman harcamadan önce biçimde anlaşalım.
- **Güvenlik sorunları:** herkese açık kayıt açma; [SECURITY.md](SECURITY.md) dosyasına bak.

## Kurulum

```sh
git clone https://github.com/OzcanOrhanDemirci/Mode_Code.git
cd Mode_Code
npm ci
npm run check   # tip denetimi, biçim denetimi, testler, derleme
```

Node.js 22.13 ya da sonrası. `npm test` her şeyi Claude Code olmadan ve ağa çıkmadan çalıştırır. Eklentiyi gerçek bir oturumda denemek için derle ve Claude Code'u `claude --plugin-dir dist/plugin` ile başlat.

## Kodun düzeni

[docs/architecture.md](docs/architecture.md) dosyasına bak. Kısaca: her karar `src/core` içinde (saf, Node API'si yok, çünkü eklenti Node olmadan çalışır); eklenti, hook ve komut satırı onu yalnız uyarlar.

## Değişiklik kuralları

- **Testler değişiklikle birlikte gelir.** Bir hata düzeltmesi, o hatayı yakalayacak testi ekler.
- **Emniyet kemeri testleri zararsız örnek kullanır.** Riskli bir komutu çalıştıran test asla yazılmaz; kemere komutlar yalnız sorulur. Yeni kural testleri küçük ve odaklı olur.
- **Kişinin gördüğü her ileti İngilizce ve Türkçe vardır** (`src/core/i18n`). Bir anahtar eksikse tip denetimi başarısız olur; `npm test` yer tutucuları denetler. Sade cümleler, her cümlede tek fikir, uzun çizgi yok, teknik terim geçtiği yerde açıklanır.
- **Telemetri yok, ağ çağrısı yok;** tartışmadan yeni çalışma zamanı bağımlılığı yok. Pakete giren kodun lisansı izinli listede olmalı (derleme denetler).
- **Ayarlar geriye uyumlu kalır.** Yeni bir ayarın varsayılanı olur; eski bir ayar dosyası çalışmaya devam eder.
- **Renk tek başına anlam taşımaz.** Her durumun bir simgesi ve bir kelimesi var; düz metin kipi okunur kalmalı.

## Commit'ler

- [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`; İngilizce, emir kipinde ("add", "added" değil), commit başına tek değişiklik.
- **Her commit'i imzala** (`git commit -s`). Bu, [Developer Certificate of Origin](https://developercertificate.org/) beyanıdır: değişikliği sen yazdın ya da projenin lisansıyla sunma hakkın var. Ayrı bir CLA yok.
- Katkılar Apache-2.0 ile lisanslanır (lisansın 5. bölümü).

## Pull request'ler

- Odaklı tut; neyin neden değiştiğini ve nasıl sınadığını yaz.
- `npm run check` kendi makinende geçmeli; CI onu Windows, macOS ve Linux'ta çalıştırır.
- Ana dal yalnız pull request ile değişir ve tek commit olarak birleştirilir.

## Çeviriler

Yeni bir dil eklemek için `src/core/i18n/en-ui.ts`, `en-tui.ts` ve `en.ts` içindeki metinleri yeni bir dil dosyasına kopyala, dili `LANGUAGES` listesine ekle ve anahtar kelime ifadelerini `src/core/keywords.ts` içine ekle. Eksik anahtarları tip sistemi söyler.

Katkıda bulunan herkese teşekkürler; katkıda bulunanların adı sürüm notlarında geçer.

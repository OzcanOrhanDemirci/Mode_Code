<p align="right"><a href="CONTRIBUTING.md">English</a> · <b>Türkçe</b></p>

# Katkı

Yardım etmek istediğin için teşekkürler. Kayıtlar, fikirler, kural şablonları, çeviriler, kendi platformundaki denemeler ve kod hoş karşılanır; ilk katkı güler yüzle ve özenle incelenir.

## Başlamadan önce

- **Küçük düzeltmeler** (yazım hatası, daha açık bir ileti, başarısız bir test): doğrudan pull request aç.
- **Büyük değişiklikler** (yeni bir özellik, yeni bir kural, kemerin komut okuma biçiminde değişiklik): önce bir kayıt (issue) aç; zaman harcamadan önce biçimde anlaşalım.
- **Henüz iş olmayan sorular ve fikirler:** [Tartışmalar](https://github.com/OzcanOrhanDemirci/Mode_Code/discussions).
- **Güvenlik sorunları:** herkese açık kayıt açma; [SECURITY.md](SECURITY.md) dosyasına bak.

## İlk katkın

1. [good first issue](https://github.com/OzcanOrhanDemirci/Mode_Code/labels/good%20first%20issue) ya da [help wanted](https://github.com/OzcanOrhanDemirci/Mode_Code/labels/help%20wanted) etiketli bir kayıt seç ve bir yorumla üstlendiğini söyle; böylece kimse aynı işi iki kez yapmaz.
2. Depoyu çatalla (fork) ve bir dal aç: `git switch -c fix/daha-acik-kota-iletisi`.
3. Değişikliği testiyle birlikte yap ve `npm run check` çalıştır.
4. İmzalı commit at (`git commit -s`, bkz. [Commit'ler](#commitler)) ve bir pull request aç; şablon neyin neden değiştiğini ve nasıl sınadığını sorar.

Birkaç gün içinde cevap alırsın. Bir değişikliğin daha çalışmaya ihtiyacı varsa inceleme tam olarak neyin ve neden gerektiğini söyler.

## Kurulum

```sh
git clone https://github.com/OzcanOrhanDemirci/Mode_Code.git
cd Mode_Code
npm ci
npm run check   # tür denetimi, biçim denetimi, derleme, testler
```

Node.js 22.13 ya da sonrası. `npm test` her şeyi Claude Code olmadan ve ağa çıkmadan çalıştırır. Eklentiyi gerçek bir oturumda denemek için derle ve Claude Code'u `claude --plugin-dir dist/plugin` ile başlat ya da `node dist/cli.mjs try` çalıştır.

| Komut                    | Ne yapar                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `npm run check`          | bir pull request'in geçmesi gereken her şey: türler, biçim, derleme, testler                      |
| `npm test`               | testler (önce derle: bazıları `dist/` içindeki programları çalıştırır)                            |
| `npm run format`         | kodu Prettier ile biçimlendirir                                                                   |
| `npm run test:installer` | tek satırlık kurulumu, bu derlemenin ürettiği pakete karşı, sende olan her kabukta çalıştırır     |
| `npm run test:av`        | antivirüsü açık Windows'ta: deponun ve derlemenin hiçbir dosyası tehdit sayılmıyor                |
| `npm run screenshots`    | bir ekranı değiştirdikten sonra README resimlerini kontrol merkezinin kendisinden yeniden çizer   |
| `npm run mo-art`         | Mo'yu değiştirdikten sonra Mo'nun resimlerini (README, docs/mo.md, sosyal önizleme) yeniden çizer |
| `npm run verify`         | makinende çalışabilen her test katmanı, her biri tek satır ([docs/testing.md](docs/testing.md))   |

## Kodun düzeni

[docs/architecture.md](docs/architecture.md) dosyasına bak. Kısaca: her karar `src/core` içinde (saf, Node API'si yok, çünkü eklenti Node olmadan çalışır); eklenti, hook ve komut satırı onu yalnız uyarlar.

| Klasör                      | İçinde ne var                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/core`                  | kararlar: emniyet kemeri, kabuk ayrıştırıcıları, modlar, anahtar kelimeler, kota, kural şablonları, iletiler |
| `src/mod`                   | Claude Code'un içinde çalışan eklenti                                                                        |
| `src/hook`                  | güvenlik ağı hook programı                                                                                   |
| `src/node`                  | makineye dokunan her şey: dosyalar, git, kurulum, oturum dizini                                              |
| `src/cli`                   | `mode-code` komutu                                                                                           |
| `src/tui`                   | kontrol merkezi                                                                                              |
| `test`                      | katmanlara göre testler ([docs/testing.md](docs/testing.md))                                                 |
| `install.sh`, `install.ps1` | tek satırlık kurulum betikleri                                                                               |

## Değişiklik kuralları

- **Testler değişiklikle birlikte gelir.** Bir hata düzeltmesi, o hatayı yakalayacak testi ekler.
- **Emniyet kemeri testleri zararsız örnek kullanır.** Riskli bir komutu çalıştıran test asla yazılmaz; kemere komutlar yalnız sorulur. Yeni kural testleri küçük ve odaklı olur.
- **Kişinin gördüğü her ileti İngilizce ve Türkçe vardır** (`src/core/i18n`). Bir anahtar eksikse tür denetimi başarısız olur; `npm test` yer tutucuları denetler. Sade cümleler, her cümlede tek fikir, uzun çizgi yok, teknik terim geçtiği yerde açıklanır.
- **Telemetri yok, ağ çağrısı yok;** tartışmadan yeni çalışma zamanı bağımlılığı yok. Pakete giren kodun lisansı izinli listede olmalı (derleme denetler).
- **Ayarlar geriye uyumlu kalır.** Yeni bir ayarın varsayılanı olur; eski bir ayar dosyası çalışmaya devam eder.
- **Renk tek başına anlam taşımaz.** Her durumun bir simgesi ve bir kelimesi var; düz metin kipi okunur kalmalı.
- **`install.ps1` ASCII kalır.** Windows PowerShell 5.1, bayt sırası işareti olmayan bir betiği sistemin kod sayfasıyla okur; bu yüzden Türkçe iletileri Türkçe harflerin `\u` kaçışlarıyla yazılır. `install.sh` ise `shellcheck --shell=sh` denetiminden geçmelidir.

## Kural şablonları

Bir kural şablonu, Claude'un okuduğu birkaç satırdır (projenin `CLAUDE.md` dosyasında işaretli bir blokta); bazılarında yalnız sıkılaştıran kemer ayarları da vardır. [src/core/templates.ts](src/core/templates.ts) içinde durur: İngilizce ve Türkçe olarak bir `id`, bir ad, tek satırlık bir açıklama ve birkaç kural içeren bir kayıt ekle; `test/core/templates.test.ts` içine bir durum ekle. İyi şablonlar kısa, somut ve kendi türündeki çoğu proje için doğrudur.

## Çeviriler

Yeni bir dil eklemek için `src/core/i18n/en-ui.ts`, `en-tui.ts` ve `en.ts` içindeki metinleri yeni bir dil dosyasına kopyala, dili `LANGUAGES` listesine ekle ve anahtar kelime ifadelerini `src/core/keywords.ts` içine ekle. Eksik anahtarları tür sistemi söyler. Sonra dilini kontrol merkezinde görmek için `npm run screenshots` çalıştır.

## Commit'ler

- [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`; İngilizce, emir kipinde ("add", "added" değil), commit başına tek mantıksal değişiklik: tek başına derlenir ve testleri geçer; bir değişiklik, testleri ve belgesiyle birlikte tek commit'tir.
- Konu satırı en çok 72 karakterdir. Gövde, değişikliğin neden gerektiğini, sorunun nasıl bulunduğunu, neyin değiştiğini ve hangi testin bunu koruduğunu en çok 72 karakterlik satırlarla anlatır.
- **Her commit'i imzala** (`git commit -s`). Bu, [Developer Certificate of Origin](https://developercertificate.org/) beyanıdır: değişikliği sen yazdın ya da projenin lisansıyla sunma hakkın var. Ayrı bir CLA yok. Her pull request'te bir denetim imzayı arar.
- Katkılar Apache-2.0 ile lisanslanır (lisansın 5. bölümü).

### Yapay zekâ desteği

Yapay zekâ araçları kullanabilirsin; imzanın da söylediği gibi her satırın sorumluluğu sende kalır. Bunu, imzanın üstüne aracın adını yazan bir `Assisted-by:` satırıyla belirt:

```
Assisted-by: Claude Code
Signed-off-by: Adın Soyadın <sen@example.com>
```

İmzayı yalnız bir insan atar. Bu proje Claude Code ile geliştiriliyor: commit'leri `Assisted-by: Claude Code` taşır; `15fbce7`'ye kadarki commit'ler aynı anlama gelen `Co-Authored-By: Claude` ve `Claude-Session` satırlarını taşır.

## Pull request'ler

- Odaklı tut; neyin neden değiştiğini ve nasıl sınadığını yaz.
- `npm run check` kendi makinende geçmeli; CI onu Windows, macOS ve Linux'ta çalıştırır, kurulumu da üçünde sınar.
- Ana dal yalnız pull request ile değişir ve başlığı pull request'in başlığı olan tek bir commit olarak birleştirilir.

## Sürümler

Bakımcılar bir sürüm etiketiyle yayın yapar; neyin denetlenip yayınlandığını [docs/release.md](docs/release.md) anlatır.

Katkıda bulunan herkese teşekkürler; katkıda bulunanların adı sürüm notlarında geçer.

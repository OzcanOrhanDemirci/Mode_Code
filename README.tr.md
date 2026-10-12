<p align="right"><a href="README.md">English</a> · <b>Türkçe</b></p>

# terminal-code

**Claude Code için yerel bir yol arkadaşı: Claude Code'un içinde bir emniyet kemeri ve davranış katmanı, terminalinde bir kontrol merkezi.** Her şey kendi makinende kalır. Telemetri yok.

[![Lisans: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js 22.13 ve sonrası](https://img.shields.io/badge/node-%E2%89%A522.13-brightgreen.svg)

> **Ad geçici.** İlk herkese açık sürümden önce değişecek; [marka politikası](TRADEMARK.md) nihai adı da kapsıyor.

## İçindekiler

- [Ne yapar](#ne-yapar)
- [Neden](#neden)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Gereksinimler](#gereksinimler)
- [Kontrol merkezi](#kontrol-merkezi)
- [Anahtar kelimeler](#anahtar-kelimeler)
- [Emniyet kemeri](#emniyet-kemeri)
- [Gizlilik ve güvenlik](#gizlilik-ve-güvenlik)
- [Sınırlar](#sınırlar)
- [Sık sorulanlar](#sık-sorulanlar)
- [Yol haritası](#yol-haritası)
- [Katkı](#katkı)
- [Lisans](#lisans)

## Ne yapar

**Claude Code'un içinde** (Claude Code'un kendi sürecinde çalışan bir eklenti ve güvenlik ağı olarak küçük bir hook programı):

- **Emniyet kemeri.** Her kabuk komutunu ve dosya yazmayı çalışmadan önce okur, riskli olanları durdurur: ev klasörünü silmek, korunan bir dala zorla push, hook'ları kapatmak, Claude Code ayarlarını değiştirmek, hafızanın geçmişini yeniden yazmak, paket yayınlamak. Kural kural engeller, sana sorar ya da not düşer. Bütün izin modlarında çalışır, "bypass permissions" dahil.
- **Anahtar kelimeler.** Mesajını `devam`, `manuel devam`, `sohbet`, `kota 40`, `toparla`, `dur`, `durum` ya da `yardım` ile bitir (İngilizceleri de geçerli), araç Claude'a ne demek istediğini tam olarak söyler. `projem devam kota 40` o projede, haftalık kotanın %40'ına kadar otonom çalışır.
- **Kota bekçisi.** Claude Code'un bildirdiği 5 saatlik ve haftalık pencereleri okur; bütçende işi toparlar, sınırda durdurur ve iş otonomsa pencere sıfırlandıktan bir dakika sonra kendiliğinden sürdürür.
- **Alt satırlar.** Her cevabın altında: hafıza deposu itildi mi, bir şey değişti mi, gerektiğinde kota. Git'ten, turun araç çağrılarından ve ölçülen kotadan hesaplanır, asla tahmin edilmez.
- **Sessiz uzun iş.** Claude Code'un "kullanıcı uzun süredir haber alamadı" hatırlatmalarını dışarıda bırakır; uzun otonom iş ekranını durum satırlarıyla doldurmaz.

**Terminalinde** (`terminal-code`): yedi kategorili, Türkçe ve İngilizce bir kontrol merkezi.

|                 |                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ana ekran**   | Koruma durumu, kota, bugün, çalışan oturumlar ve sen yokken olanlar                                                                         |
| **Projeler**    | Çalıştığın her klasör: oturumlar, tokenler, git durumu                                                                                      |
| **Oturumlar**   | Bu makinedeki her oturum, aranabilir; birini sırları maskeleyerek Markdown olarak dışa aktar                                                |
| **Ölçüm**       | Kota pencereleri, güne ve modele göre token, önbellek isabeti, araç hata oranları                                                           |
| **Güvenlik**    | Her korumanın çalışıp çalışmadığı, 39 kemer kuralı, yakaladıkları, bir sınayıcı, hafızadaki sırlar                                          |
| **Claude Code** | Kurulumunun salt okunur haritası: talimat dosyaları ve hafıza sınırı, ayar kaynakları, hook'lar, izin kuralları, MCP sunucuları, eklentiler |
| **Ayarlar**     | Aracın kendi ayarları, yerinde düzenlenir                                                                                                   |

## Neden

Yazarın Windows 11 makinesinde, Claude Code 2.1.296 ve Node.js 24.15 ile ölçüldü:

- **Kayıtlardan token saymak, dikkatsiz yapılınca şişirir.** Claude Code her içerik bloğu için ayrı satır yazar ve mesajın kullanımını her birinde tekrarlar: 88.038 asistan satırında 39.572 ayrı API mesajı vardı. Dizin her mesajı bir kez sayar.
- **Geçmiş hızlı.** 660 kayıt dosyası (2,8 GB, alt ajanlar dahil) ilk seferde 5,5 saniyede dizinlenir; sonraki güncelleme yaklaşık 25 ms sürer. Claude Code eski kayıtları sildikten sonra da (varsayılan 30 gün) rakamlar dizinde kalır.
- **Güvenlik ağı ucuz.** Hook programı Windows'ta denetlenen her araç çağrısına yaklaşık 0,1 saniye ekler; bunun çoğu Node.js'in açılışı. Claude Code'un içinde eklenti aynı çağrıyı süreç içinde denetler.
- **Düz izin kuralları farklı yazımları kaçırır.** `Bash(git push --force*)` gibi bir kural `git -C . push --force` ile eşleşmez; kemer komutu git'in okuduğu gibi okur.

## Hızlı başlangıç

Paket henüz npm'de değil (nihai ad belli değil); kaynaktan kur:

```sh
git clone https://github.com/OzcanOrhanDemirci/terminal-code.git
cd terminal-code && npm ci && npm run build
node dist/cli.mjs install
```

Kurulum önce yapacağı her değişikliği gösterir ve hiçbir şeyi değiştirmeden önce bir kez sorar. Sonra yeni bir Claude Code oturumu başlat; kontrol merkezini `node dist/cli.mjs` ile aç.

Kaldırmak için: `node dist/cli.mjs uninstall` (ayarlarını ve geçmişini de silmek için `--purge` ekle). Kaldırma, kurulumun kaydettiğini tam olarak geri alır.

## Gereksinimler

- **Node.js 22.13 ya da sonrası** (oturum dizini Node'un yerleşik SQLite'ını kullanır).
- Güvenlik ağı hook'u için **Claude Code 2.1.295 ya da sonrası**; süreç içi eklenti **2.1.290 ve sonrasında** çalışır. Daha eski bir Claude Code'da kemeri ve anahtar kelimeleri hook tek başına yürütür.
- Windows, macOS ya da Linux. Windows 11'de geliştirildi ve sınandı.

## Kontrol merkezi

`terminal-code` açar. Üç sütun: geldiğin yer, bulunduğun yer ve seçili olan. Her ekranın bir adresi var (`security/rules`, `measure/quota`); `terminal-code open <adres>` de aynı adresi alır.

```
terminal-code › Ana ekran                                             🛡 çalışıyor  hafta %27  5s %21
╭──────────────────╮╭───────────────────────────────╮╭─────────────────────────────────────────────╮
│▸ Ana ekran 1 ye… ││▸ Genel bakış                  ││ Genel bakış                                 │
│  Projeler        ││  Sen yokken olanlar         1 ││ Her şeyin durumu tek bakışta.               │
│  Oturumlar       ││                               ││                                             │
│  Ölçüm           ││                               ││ Koruma                                      │
│  Güvenlik bugün… ││                               ││ ✓ çalışıyor · her şey çalışıyor             │
│  Claude Code     ││                               ││                                             │
│  Ayarlar         ││                               ││ Kota                                        │
│                  ││                               ││ 5 saatlik     ██▏    %21 · 3 sa 50 dk sonra │
│                  ││                               ││                      sıfırlanır             │
│                  ││                               ││ Haftalık      ██▊     %27 · 6 gün sonra     │
│                  ││                               ││                      sıfırlanır             │
╰──────────────────╯╰───────────────────────────────╯╰─────────────────────────────────────────────╯
Adres: home/overview
↑↓ gez  → aç  ← geri  1-7 kategoriler  / süz  Ctrl+K git  ? yardım  q çık
```

<sub>Projenin kendi sınama düzeneğiyle örnek veriden çizildi.</sub>

Tuşlar her yerde aynı: `↑↓` gez, `→` aç, `←` geri, `1`-`7` kategoriye atla, `/` listeyi süz, `Ctrl+K` adıyla herhangi bir ekrana git (iki dilde de), `?` terimlerin açıklandığı yardım, `q` çık. Üç görünüm seviyesi (Sade, Önerilen, Ayrıntılı) neyin gösterildiğini değiştirir, neyin korunduğunu asla. Düz metin (çerçevesiz, ASCII simgeler) ve yüksek kontrast Ayarlar › Erişilebilirlik altında.

Her şey komut olarak da var; her biri sürümlü `--json` çıktısı verir:

```sh
terminal-code status            # ne kurulu ve çalışıyor, kota, bugün
terminal-code doctor            # her özelliğin sağlığı ve bozuk olanın nasıl düzeleceği
terminal-code tokens --by model # güne, modele ya da klasöre göre token
terminal-code belt test --command "git clean -f"   # kemerin ne yapacağı; hiçbir şey çalıştırılmaz
```

Bütün komutlar: [docs/cli.md](docs/cli.md).

## Anahtar kelimeler

Bir anahtar kelime ancak mesajın tamamıysa ya da mesajı bitiriyorsa sayılır; cümlenin içinde sıradan bir kelimedir. Büyük küçük harf ve aksan önemsenmez; `termınal devam` da çalışır. `dur` ve `toparla` yalnız mesajın tamamıysa sayılır, kazara tetiklenmez.

| Anahtar | Türkçe                    | İngilizce           | Claude'a söylenen                                                       |
| ------- | ------------------------- | ------------------- | ----------------------------------------------------------------------- |
| devam   | `devam`, `terminal devam` | `continue`          | Otonom çalış; yalnız senin vermen gereken bir kararda dur               |
| manuel  | `manuel terminal devam`   | `manual … continue` | Adım adım; ne yapacağını söyle ve bekle                                 |
| sohbet  | `sohbet`                  | `chat`              | Yalnız konuşma; "devam" diyene kadar proje ve hafızaya yazma reddedilir |
| kota    | `kota 40`, `kota +8`      | `quota 40`          | Haftalık bütçe: %40 ya da şu anki ölçümün 8 puan üstü                   |
| toparla | `toparla`                 | `wrap up`           | Adımı tutarlı bir yere getir, commit et, raporla, dur                   |
| dur     | `dur`                     | `stop`              | Hemen dur; zamanlayıcıları ve ajanları durdur                           |
| durum   | `durum`                   | `status`            | Durmadan nerede olduğunu söyle                                          |
| yardım  | `yardım`                  | `help`              | Anahtar kelimeleri ve kuralları özetle                                  |

Projelerine Ayarlar › Projeler ve anahtar kelimeler altından ad ver; kendi ifadelerini ayar dosyasına ekleyebilirsin. Ayrıntı: [docs/keywords.md](docs/keywords.md).

## Emniyet kemeri

Dokuz grupta 39 kural: git, dosyalar ve diskler, kendini koruma, Claude Code yapılandırması, kendiliğinden başlayan şeyler, yayınlama, Docker (sunucular için isteğe bağlı paket), sırlar ve kemerin izleyemediği komutlar. Her kural engeller, sorar, not düşer ya da izin verir; bunu kural kural değiştirebilirsin. **Kilitli kurallar** korumanın kendisini korur (Claude Code ayarların, aracın kendi dosyaları, hafıza klasörün, hook'lar): sıkılaştırılabilir, asla gevşetilemez; sohbette onay vermek onları değiştirmeye yetmez.

Kemer bash, PowerShell ve cmd sözdizimini okur; `sudo`, `env`, `bash -c` ve yorumlayıcıların içine bakar; `git -C`, `-c` ve takma adları izler; çalışırken üretilen kodu güvenli kanıtlanmış saymaz, sorar. Eklenti sana sorduğunda verdiğin karar yalnız o çağrıyı kapsar.

Ayrıntı: [docs/safety-belt.md](docs/safety-belt.md).

## Gizlilik ve güvenlik

- **Hiçbir şey makinenden çıkmaz.** Telemetri yok, analitik yok, kendi ağ bağlantısı yok.
- **Ne okur:** Claude Code'un ayar dosyalarını ve kayıtlarını (salt okunur), hafıza klasörlerini (git durumu ve sır taraması için).
- **Ne yazar:** kendi veri klasörünü (`~/.terminal-code`) ve kurulumda senin onayınla Claude Code kullanıcı ayarlarına dört hook kaydı (yedeği alınır). Eklenti Claude Code'un kendi `claude plugin` komutuyla kurulur.
- **Ne saklar:** sayılar (token, araç sayısı, süre) ve kısa metinler (oturum başlıkları, ilk istemler); sırlar yazılmadan önce maskelenir.
- **Kaldırma:** `terminal-code uninstall` kurulumun kaydettiğini tam olarak geri alır. Bir korumayı azaltan komutlar bir Claude Code oturumunun içinden çalışmayı reddeder.

Bir güvenlik açığı mı buldun? Lütfen gizli bildir: [SECURITY.md](SECURITY.md).

## Sınırlar

- **Yerel Windows'ta kemer bir kaza önleyicidir, güvenlik sınırı değildir.** Claude Code'un kum havuzu orada çalışmaz ve bir betik, tek bir komutun yapamadığını yapabilir. Gözetimsiz otonom iş için kum havuzunun bir katman eklediği WSL2, macOS ya da Linux kullan.
- **Eklenti Claude Code'un erken erişimdeki mod API'sini kullanır**; sürümler arasında değişebilir. Yüklenmediğinde kemeri hook yürütmeye devam eder; kontrol merkezi hangi özelliklerin duraklatıldığını söyler.
- **Kota rakamları Claude Code'dan gelir**; eklenti her cevaptan sonra kaydeder. Eklenti olmadan kota ölçümü olmaz; token kota değildir.
- **Eklentinin çizdiği alt satırlar** Claude Code'un gösterdiği biçimde cevabın altında bir bildirim olarak görünür. Cevabın içinde olmalarını istiyorsan (o zaman telefonuna ve dışa aktarmalara da ulaşırlar) "Denetlenir" kipini seç: satırları Claude yazar, bir hook denetler.

## Sık sorulanlar

**Claude Code'un çalışma biçimini değiştirir mi?** Yalnız gördüğün yerlerde: kemerin kararları, bir anahtar kelimenin eklediği bağlam, alt satırlar ve durum satırı. Herhangi bir özelliği Ayarlar › Özellikler altından kapatabilirsin; kemer kalır.

**Claude Code'u yavaşlatır mı?** Hook, Windows'ta denetlenen her araç çağrısına yaklaşık 0,1 saniye ekler (başka sistemlerde daha az); eklentinin denetimi süreç içinde yapılır.

**Claude onu kapatabilir mi?** Kendi başına hayır: Claude Code ayarlarını, bu aracın dosyalarını değiştirmek ya da eklentisini kaldırmak kilitli kurallardır; korumayı azaltan komutlar yalnız kendi terminalinden çalışır.

**Claude masaüstü uygulamasıyla çalışır mı?** Eklenti ve hook'lar, Claude Code kullanıcı ayarlarınla nerede çalışıyorsa orada yüklenir; kontrol merkezi bir terminal programıdır.

## Yol haritası

- Kodla uygulanan modlar ve mod akışları (araştırma, plan, onay, kod)
- WSL2'de, bitti tanımıyla tam otonom çalışma
- Sıkıştırmadan önce oturum devir notları, kota geçmişi, sabah raporu
- Makineler arası ayar ve geçmiş eşitleme (yalnız ekleme, makine başına)
- Daha çok kural şablonu (Flutter, herkese açık depolar, üretim sunucuları)
- Nihai adla, kaynağı doğrulanabilir biçimde npm'de yayın

## Katkı

Katkılar hoş karşılanır: kayıtlar, fikirler, kural şablonları, çeviriler, kod. Lütfen [CONTRIBUTING.tr.md](CONTRIBUTING.tr.md) dosyasını oku; commit'ler [Developer Certificate of Origin](https://developercertificate.org/) altında imzalanır (`git commit -s`). Katılarak [Davranış Kuralları](CODE_OF_CONDUCT.md)'nı kabul etmiş olursun.

## Lisans

[Apache Lisansı 2.0](LICENSE). [NOTICE](NOTICE) dosyası her kopyayla birlikte gider. Ad ve logo [marka politikası](TRADEMARK.md) kapsamında. Pakete dahil üçüncü taraf kodu: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Anthropic tarafından yapılmadı. Claude ve Claude Code, Anthropic'in markalarıdır; neyle çalıştığını söylemek için anılır. [Ink](https://github.com/vadimdemedes/ink), [React](https://react.dev), [esbuild](https://esbuild.github.io), [TypeScript](https://www.typescriptlang.org) ve Node.js'in yerleşik SQLite'ı üzerine kuruldu.

<p align="right"><a href="README.md">English</a> · <b>Türkçe</b></p>

# terminal-code

**Claude Code için yerel bir yol arkadaşı: Claude Code'un içinde bir emniyet kemeri ve davranış katmanı, terminalinde bir kontrol merkezi.** Her şey kendi makinelerinde kalır ya da yalnız senin gönderdiğin yere gider. Telemetri yok.

[![Lisans: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js 22.13 ve sonrası](https://img.shields.io/badge/node-%E2%89%A522.13-brightgreen.svg)

<!-- name:temporary -->

> **Ad geçici.** İlk herkese açık sürümden önce değişecek; [marka politikası](TRADEMARK.md) nihai adı da kapsıyor.

<!-- /name:temporary -->

## İçindekiler

- [Ne yapar](#ne-yapar)
- [Neden](#neden)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Gereksinimler](#gereksinimler)
- [Kontrol merkezi](#kontrol-merkezi)
- [Anahtar kelimeler](#anahtar-kelimeler)
- [Emniyet kemeri](#emniyet-kemeri)
- [Gizlilik ve güvenlik](#gizlilik-ve-güvenlik)
- [Nasıl test ediliyor](#nasıl-test-ediliyor)
- [Sınırlar](#sınırlar)
- [Sık sorulanlar](#sık-sorulanlar)
- [Yol haritası](#yol-haritası)
- [Katkı](#katkı)
- [Lisans](#lisans)

## Ne yapar

**Claude Code'un içinde** (Claude Code'un kendi sürecinde çalışan bir eklenti ve güvenlik ağı olarak küçük bir hook programı):

- **Emniyet kemeri.** Her kabuk komutunu ve dosya yazmayı çalışmadan önce okur, riskli olanları durdurur: ev klasörünü silmek, korunan bir dala zorla push, hook'ları kapatmak, Claude Code ayarlarını değiştirmek, hafızanın geçmişini yeniden yazmak, paket yayınlamak. Kural kural engeller, sana sorar ya da not düşer. Bütün izin modlarında çalışır, "bypass permissions" dahil.
- **Anahtar kelimeler.** Mesajını `devam`, `manuel devam`, `sohbet`, `kota 40`, `toparla`, `dur`, `durum` ya da `yardım` ile bitir (İngilizceleri de geçerli), araç Claude'a ne demek istediğini tam olarak söyler. `projem devam kota 40` o projede, haftalık kotanın %40'ına kadar otonom çalışır.
- **Modlar**, kodla uygulanır: 💬 sohbet, 🔍 araştırma, 📐 plan ve 🔨 kod. Sohbet, araştırma ve plan; geçici klasör, çalışma klasörü ya da plan dosyası dışında hiçbir şeyi değiştirmez: bir kabuk komutunun çalıştırdığı her program sınıflandırılır (yalnız okur, adı verilen dosyaları yazar, klasöründe bir şeyi değiştirir, dışarıya uzanır, bilinmiyor) ve sınıflandırılamayan reddedilir, nedeni söylenir. Claude Code'un kendi plan modu 📐 plana köprülenir.
- **Oturum kontrolleri.** Mod ve çalışma biçimi (manuel, otonom, tam otonom) istemin üstündeki şeritte hep görünür ve tek adımda değişir: şeride tıkla, `/3` (plan) ya da `/7` (otonom) yaz ya da kelimeyi tek başına yaz. `/2 önbelleğe bak` modu değiştirip metni gönderir; `/devam` devam edilebilecek her projeyi ve klasörü listeler; `/kota` bütçe sorar; `/9` akış; `/0` hepsini gösterir. Claude çalışırken de anında etkili olurlar: fren. Yeni bir oturum, klasörü en son bıraktığın gibi açılır. Bkz. [docs/modes.md](docs/modes.md#session-controls).
- **Akışlar.** Bir görevi `akış` ile bitir; 🔍 araştırma ▶ 📐 plan → ⏸ onay → 🔨 kod olarak yürür. Hiçbir adım atlanmaz ve her birini kod denetler: bulguları var olan kaynaklara dayanan bir rapor, kabul ölçütleri ve doğrulama komutları olan bir plan, bir iletişim kutusunda (ya da Claude Code'un plan penceresinde) senin onayın ve eklenti çalıştırdığında geçen doğrulama komutları. Akışlar duraklatılır, yeni bir oturumda sürer ve kontrol merkezinde görünür. Ayrıntı: [docs/modes.md](docs/modes.md) (İngilizce).
- **Tam otonom.** Bir görevi `projem tam otonom kota +10` ile bitir; sen yokken sonuna kadar yürür: doğrulama komutları yalnız artan bir plan, her adım için geri dönebileceğin bir commit üzerinde bir kilometre taşı, her birinin bağımsız incelemesi (isteğini ve farkı gören, sohbeti asla görmeyen ayrı bir model çağrısı) ve ancak her doğrulama komutu geçtiğinde sayılan bir bitiş. Hiçbir şey sorulmaz: sana ait olanlar (korunan dallara push, birleştirme, sürüm, kemerin soracakları) birebir komutuyla kaydedilip koşunun raporunda bekler. Yalnız kodun önce ölçtüğü bir sınırın içinde başlar: Windows'ta, Windows'a geri dönüş yolu olmayan bir WSL2 dağıtımı; her yerde, Claude Code'un sıkı biçimdeki kum havuzu. Sen açana kadar kapalı. Ayrıntı: [docs/autonomy.md](docs/autonomy.md) (İngilizce).
- **Hafıza ve devir notları.** `terminal-code memory setup`, Claude Code'un hafızasının nerede duracağını sorar: bu bilgisayarda, GitHub'ında özel bir depoda ya da ikisinde. İstersen git'i ve GitHub CLI'ı kurar, giriş yaptırır, özel depoyu adlandırıp açar, var olan hafızanı yanında getirir, her değişikliği gösterip bir kez sorar. Bundan sonra hafıza her oturum başında çekilir, onu değiştiren bir turdan sonra gönderilir; sır içeriyor gibi görünen dosya bekletilir. `devir` (ya da `handoff`) yazınca Claude o hafızaya bir devir notu yazar; notlar sıkıştırmadan önce ve oturum biterken de yazılır, sonraki oturum (bu bilgisayarda ya da başkasında) oradan sürer. Bir süre yokken, sabah raporu neler olduğunu söyler. Ayrıntı: [docs/memory.md](docs/memory.md) (İngilizce).
- **Bilgisayarlar arası eşitleme.** `terminal-code sync setup`, terminal-code'un ayarlarını, geçmişini ve devir notlarını çalıştığın bilgisayarlar arasında, adını senin koyduğun GitHub'ındaki özel bir depo ya da başka bir servisin eşitlediği bir klasör üzerinden paylaştırır. Her bilgisayar orada yalnız kendi klasörüne yazar. Bir ayarın en yeni değişikliği her bilgisayarda geçerli olur; ama bir korumayı azaltacak olanı seni bekler. Zaten kendin eşitlediğin bir hafıza olduğu gibi kullanılır: terminal-code yalnız değişiklikleri alır, kaydetmek ve göndermek sende kalır. Ayrıntı: [docs/sync.md](docs/sync.md) (İngilizce).
- **Kota bekçisi.** Claude Code'un bildirdiği 5 saatlik ve haftalık pencereleri okur; bütçende işi toparlar, sınırda durdurur ve iş otonomsa pencere sıfırlandıktan bir dakika sonra kendiliğinden sürdürür.
- **Alt satırlar.** Her cevabın altında: hafıza deposu itildi mi, bir şey değişti mi, gerektiğinde kota. Git'ten, turun araç çağrılarından ve ölçülen kotadan hesaplanır, asla tahmin edilmez.
- **Sessiz uzun iş.** Claude Code'un "kullanıcı uzun süredir haber alamadı" hatırlatmalarını dışarıda bırakır; uzun otonom iş ekranını durum satırlarıyla doldurmaz.

**Terminalinde** (`terminal-code`): yedi kategorili, Türkçe ve İngilizce bir kontrol merkezi; bir de kurulumu ve çevresindeki makineyi sınayıp güvenle onarabileceğini onaran bakım denetimi (`terminal-code doctor`).

|                 |                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ana ekran**   | Koruma durumu, kota, bugün, çalışan oturumlar ve sen yokken olanlar                                                                                                                                                       |
| **Projeler**    | Çalıştığın her klasör: oturumlar, tokenler, git durumu; her akış, adımları, her denetimin bulduğu ve dosyaları                                                                                                            |
| **Oturumlar**   | Bu makinedeki her oturum, aranabilir; birini sırları maskeleyerek Markdown olarak dışa aktar                                                                                                                              |
| **Ölçüm**       | Kota pencereleri, güne ve modele göre token, önbellek isabeti, araç hata oranları                                                                                                                                         |
| **Güvenlik**    | Her korumanın çalışıp çalışmadığı, 39 kemer kuralı, yakaladıkları, bir sınayıcı, hafızadaki sırlar                                                                                                                        |
| **Claude Code** | Kurulumunun salt okunur haritası: talimat dosyaları ve hafıza sınırı, ayar kaynakları, hook'lar, izin kuralları, MCP sunucuları, eklentiler; ve kural şablonları (herkese açık depo, üretim sunucusu, Flutter, tek dal …) |
| **Ayarlar**     | Aracın kendi ayarları, yerinde düzenlenir                                                                                                                                                                                 |

### Claude Code'un içinde

Gerçek bir Claude Code oturumundan alındı (Windows, Claude Code 2.1.296; oturum İngilizceydi). Kemer, izlenmeyen dosyaları silen bir temizlikten önce soruyor:

```
● Bash(git clean -f)
  ⎿  Waiting…
──────────────────────────────────────────────────────────────────────────────
 ☐ Safety belt
│ The safety belt stopped a Bash call. Deletes untracked files (git clean -f): git clean -f Allow it this once?
❯ 1. Allow once
  2. Block
```

Bir cevabın altındaki satırlar, Claude Code'un kendi modlarının yanında oturumun modu ve ipucu satırının sonunda kota:

```
● ready
  Memory pushed: No (the memory repository has no remote branch)
  Changes made: No
✻ Baked for 1s
──────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle) · 🛡 5h 31% · week 28%        autonomous
```

Türkçe kurulumda aynı satırlar "Hafıza İtildi", "İşlem Yapıldı", "otonom" ve "5s %31 · hafta %28" olarak görünür.

Bir akışın planı onay bekliyor: eklenti onu önce denetledi; akışı kod adımına yalnız kişinin cevabı geçirir (oturum İngilizceydi):

```
● terminal-code - flow_step (MCP)(step: "plan")
──────────────────────────────────────────────────────────────────────────────
 ☐ Plan
│ The plan is ready: 1 step, verified by `cat hello.txt`, `git status --short`.
│ Plan: …/flows/20261013-0044-plan-a-tiny-change-add/plan.md. Approve it?
❯ 1. Approve, start coding
  2. Change the plan
  3. Pause the flow
```

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

Hiçbir şey kurmadan önce denemek için `node dist/cli.mjs try` çalıştır: her şey yüklü tek bir Claude Code oturumu başlatır ve Claude Code yapılandırmanda hiçbir şeyi değiştirmez.

Kurulum önce yapacağı her değişikliği gösterir ve hiçbir şeyi değiştirmeden önce bir kez sorar. Sonra yeni bir Claude Code oturumu başlat; kontrol merkezini `node dist/cli.mjs` ile aç.

Kaldırmak için: `node dist/cli.mjs uninstall` (ayarlarını ve geçmişini de silmek için `--purge` ekle). Kaldırma, kurulumun kaydettiğini tam olarak geri alır.

## Gereksinimler

- **Node.js 22.13 ya da sonrası** (oturum dizini Node'un yerleşik SQLite'ını kullanır).
- Güvenlik ağı hook'u için **Claude Code 2.1.295 ya da sonrası**; süreç içi eklenti **2.1.290 ve sonrasında** çalışır. Daha eski bir Claude Code'da kemeri ve anahtar kelimeleri hook tek başına yürütür.
- Windows, macOS ya da Linux. Windows 11'de geliştirildi; testler Windows ve Linux'ta (Node.js 22 ve 24) ve macOS'ta (Node.js 24) geçiyor.

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
terminal-code report --week     # olanlar: oturumlar, tokenler, kemer, kota
terminal-code tokens --by model # güne, modele ya da klasöre göre token
terminal-code belt test --command "git clean -f"   # kemerin ne yapacağı; hiçbir şey çalıştırılmaz
```

Bütün komutlar: [docs/cli.md](docs/cli.md).

## Anahtar kelimeler

Bir görev taşıyan anahtar kelime, mesajın tamamıysa ya da mesajı bitiriyorsa sayılır; cümlenin içinde sıradan bir kelimedir. Modu ya da çalışma biçimini değiştiren kelimeler (`plan`, `kod`, `otonom` …) ile `dur` ve `toparla` yalnız mesajın tamamıysa sayılır: gündelik kelimelerdir ve kazara tetiklenmezler. Büyük küçük harf ve aksan önemsenmez; `termınal devam` da çalışır. Her birinin bir `/` komutu da var (`/1` … `/9`, `/0`, `/devam`, `/kota`).

| Anahtar    | Türkçe                                                 | İngilizce                                           | Claude'a söylenen                                                                           |
| ---------- | ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| devam      | `devam`, `terminal devam`                              | `continue`                                          | Otonom çalış; yalnız senin vermen gereken bir kararda dur                                   |
| manuel     | `manuel terminal devam`, tek başına `manuel`           | `manual … continue`, tek başına `manual`            | Adım adım: mesajın istediğini yap, söyle, bekle. Tek başına: yalnız çalışma biçimi          |
| otonom     | `otonom` (mesajın tamamı)                              | `autonomous`, `auto`                                | Yalnız çalışma biçimi: adımlar arasında sormadan ilerle                                     |
| sohbet     | `sohbet`                                               | `chat`                                              | Yalnız konuşma; "devam" diyene kadar proje ve hafızaya yazma reddedilir                     |
| kota       | `kota 40`, `kota +8`                                   | `quota 40`                                          | Haftalık bütçe: %40 ya da şu anki ölçümün 8 puan üstü                                       |
| toparla    | `toparla`                                              | `wrap up`                                           | Adımı tutarlı bir yere getir, commit et, raporla, dur                                       |
| dur        | `dur`                                                  | `stop`                                              | Hemen dur; zamanlayıcıları ve ajanları durdur                                               |
| durum      | `durum`                                                | `status`                                            | Durmadan nerede olduğunu söyle                                                              |
| yardım     | `yardım`                                               | `help`                                              | Anahtar kelimeleri ve kuralları özetle                                                      |
| modlar     | `araştırma`, `plan`, `kod`, `serbest` (mesajın tamamı) | `research`, `plan`, `code`, `free`                  | Mod değiştir; bir akış sürerken akışı duraklatıp geç                                        |
| akış       | `akış`, `akış plan`, `akış araştırma`, `akış iptal`    | `flow`, `flow plan`, `flow research`, `flow cancel` | Mesajdaki görevle bir akış başlat ya da akışı bitir                                         |
| onay       | `onay`                                                 | `approve`                                           | Onay bekleyen planı onayla (yalnız mesajın tamamıysa)                                       |
| tam otonom | `terminal tam otonom kota +10`, `tam otonom iptal`     | `myproject full auto quota +10`, `full auto cancel` | Görevi sormadan sonuna kadar yürüt (bütçe gerekir; [docs/autonomy.md](docs/autonomy.md))    |
| devir      | `devir`, `terminal devir`                              | `handoff`, `myproject handoff`                      | Claude sonraki oturum için hafızana bir devir notu yazar ([docs/memory.md](docs/memory.md)) |

Projelerine Ayarlar › Projeler ve anahtar kelimeler altından ad ver; kendi ifadelerini ayar dosyasına ekleyebilirsin. Ayrıntı: [docs/keywords.md](docs/keywords.md).

## Emniyet kemeri

Dokuz grupta 39 kural: git, dosyalar ve diskler, kendini koruma, Claude Code yapılandırması, kendiliğinden başlayan şeyler, yayınlama, Docker (sunucular için isteğe bağlı paket), sırlar ve kemerin izleyemediği komutlar. Her kural engeller, sorar, not düşer ya da izin verir; bunu kural kural değiştirebilirsin. **Kilitli kurallar** korumanın kendisini korur (Claude Code ayarların, aracın kendi dosyaları, hafıza klasörün, hook'lar): sıkılaştırılabilir, asla gevşetilemez; sohbette onay vermek onları değiştirmeye yetmez.

Kemer bash, PowerShell ve cmd sözdizimini okur; `sudo`, `env`, `bash -c` ve yorumlayıcıların içine bakar; `git -C`, `-c` ve takma adları izler; çalışırken üretilen kodu güvenli kanıtlanmış saymaz, sorar. Eklenti sana sorduğunda verdiğin karar yalnız o çağrıyı kapsar.

Ayrıntı: [docs/safety-belt.md](docs/safety-belt.md).

## Gizlilik ve güvenlik

- **Sen göndermedikçe hiçbir şey makinenden çıkmaz.** Telemetri yok, analitik yok. Hafıza ve eşitleme yalnız senin kurduğun yere gider: git ve GitHub CLI ile kendi özel depona ya da seçtiğin bir klasöre. Yaptığı tek model çağrısı, tam otonom bir koşunun kilometre taşlarının bağımsız incelemesidir; Claude Code'un kendi istemcisiyle, oturumunun zaten kullandığı sağlayıcıya gider.
- **Ne okur:** Claude Code'un ayar dosyalarını ve kayıtlarını (salt okunur), hafıza klasörlerini (git durumu ve sır taraması için).
- **Ne yazar:** kendi veri klasörünü (`~/.terminal-code`) ve kurulumda senin onayınla Claude Code kullanıcı ayarlarına dört hook kaydı (yedeği alınır). Eklenti Claude Code'un kendi `claude plugin` komutuyla kurulur.
- **Ne saklar:** sayılar (token, araç sayısı, süre) ve kısa metinler (oturum başlıkları, ilk istemler); sırlar yazılmadan önce maskelenir.
- **Kaldırma:** `terminal-code uninstall` kurulumun kaydettiğini tam olarak geri alır. Bir korumayı azaltan komutlar bir Claude Code oturumunun içinden çalışmayı reddeder.

Bir güvenlik açığı mı buldun? Lütfen gizli bildir: [SECURITY.md](SECURITY.md).

## Nasıl test ediliyor

Bir ajanla makinen arasında duran bir araç güveni kanıtla kazanmalı. Kodun kendisiyle ilgili kurallardan gerçek Claude Code oturumlarına kadar on iki katman var; her biri neyi kanıtladığını ve neyi kanıtlayamadığını söylüyor ([docs/testing.md](docs/testing.md), İngilizce). 2026-10-13 ölçümü:

- Windows, Linux ve macOS'ta, Node.js 22 ve 24 ile ve bir WSL2 dağıtımında **684 test**; koda dönüşen satırlarda ortalama satır kapsamı **%93,8**, her dosya bir tabana bağlı.
- **Yanlış alarm da hata sayılır.** 197 günlük komut her platformda kemerden tek bir soru sorulmadan geçmek, 162 okuma komutu da sohbet, araştırma ve plan modunda çalışmak zorunda. Yazarın son 30 gününde (36.658 araç çağrısı) kemer günde 4,4 kez sorardı.
- **Testlerin kendisi de test ediliyor.** Mutasyon testi karar veren koda, kemere, modlara, tam otonoma, hafızanın eşitlemesine ve bilgisayarlar arası eşitlemeye 2.078 küçük, bilerek yapılmış değişiklik uygular; testler 2.078'ini de yakalıyor. Bakım denetimi bir deneme ortamını 13 şekilde bozar; 13'ünü de fark etmesi ve onarılabilecek olanları onarması gerekir.
- **Gerçek motorun içinde.** Eklenti Claude Code'un kendi test takımıyla, her gece en yeni Claude Code sürümüne karşı ve gerçek başsız oturumlarda sınanıyor.
- **Testler gerçek hatalar buldu**, her biri düzeltildi ve bir testle düzeltilmiş kalıyor: Windows kısa adlarıyla (`TERMIN~1`) ya da sonda bir noktayla erişilebilen korumalı dosyalar, macOS'ta ev klasörü altındaki her özyinelemeli silmenin engellenmesi, `__proto__` sözcüğünde ayrıştırıcının çökmesi.

Kendi makinende `terminal-code doctor` aynı denetimleri yapar: Node.js, Claude Code ve ayarları, hook'lar ve eklenti, Git Bash, PowerShell ve zsh, terminal, dosya sistemi, git ve aracın kendi verisi. Güvenle onarabileceğini onarır, önce yedek alır, sonra yeniden denetler, sana kalanı tam olarak söyler. `npm run verify` bir makinede çalışabilen her katmanı koşar ve her katman için tek satır yazar.

## Sınırlar

- **Yerel Windows'ta kemer bir kaza önleyicidir, güvenlik sınırı değildir.** Claude Code'un kum havuzu orada çalışmaz ve bir betik, tek bir komutun yapamadığını yapabilir. Bu yüzden tam otonom yalnız WSL2 içinde (interop kapalı ve hiçbir Windows sürücüsü bağlı olmayan bir dağıtımda) ya da Claude Code'un kum havuzu sıkı biçimdeyken macOS ve Linux'ta çalışır; başlangıç denetimleri bunu ilk adımdan önce ölçer.
- **Eklenti Claude Code'un erken erişimdeki mod API'sini kullanır**; sürümler arasında değişebilir. Yüklenmediğinde kemeri hook yürütmeye devam eder; kontrol merkezi hangi özelliklerin duraklatıldığını söyler.
- **Kota rakamları Claude Code'dan gelir**; eklenti her cevaptan sonra kaydeder. Eklenti olmadan kota ölçümü olmaz; token kota değildir.
- **Eklentinin çizdiği alt satırlar** konuşmanın değil, cevabın çiziminin parçasıdır: model onları okumaz, dışa aktarılan kayıtta yer almazlar. Cevapların içine yazılmalarını istiyorsan "Denetlenir" kipini seç: satırları Claude yazar, bir hook denetler.

## Sık sorulanlar

**Claude Code'un çalışma biçimini değiştirir mi?** Yalnız gördüğün yerlerde: kemerin kararları, bir anahtar kelimenin eklediği bağlam, alt satırlar ve durum satırı. Herhangi bir özelliği Ayarlar › Özellikler altından kapatabilirsin; kemer kalır.

**Claude Code'u yavaşlatır mı?** Hook, Windows'ta denetlenen her araç çağrısına yaklaşık 0,1 saniye ekler (başka sistemlerde daha az); eklentinin denetimi süreç içinde yapılır.

**Claude onu kapatabilir mi?** Kendi başına hayır: Claude Code ayarlarını, bu aracın dosyalarını değiştirmek ya da eklentisini kaldırmak kilitli kurallardır; korumayı azaltan komutlar yalnız kendi terminalinden çalışır.

**Claude masaüstü uygulamasıyla çalışır mı?** Eklenti ve hook'lar, Claude Code kullanıcı ayarlarınla nerede çalışıyorsa orada yüklenir; kontrol merkezi bir terminal programıdır.

## Yol haritası

Sıradakiler, bu sırayla:

- **Yayın:** nihai adla, kaynağı doğrulanabilir biçimde npm'de.

Önceki yol haritasından tamamlananlar: bilgisayarlar arası eşitleme ve sahibinin eşitlediği hafıza ([docs/sync.md](docs/sync.md)), devir notları ve sabah raporuyla hafızanın kurulumu ve eşitlenmesi ([docs/memory.md](docs/memory.md)), bitti tanımıyla, WSL2'de tam otonom çalışma ([docs/autonomy.md](docs/autonomy.md)), modlar ve akışlar ([docs/modes.md](docs/modes.md)), kural şablonları (yedi tane), kota geçmişi, günlük ve haftalık rapor, bakım denetimi (`doctor`) ve [docs/testing.md](docs/testing.md) belgesinde anlatılan test süreci.

## Katkı

Katkılar hoş karşılanır: kayıtlar, fikirler, kural şablonları, çeviriler, kod. Lütfen [CONTRIBUTING.tr.md](CONTRIBUTING.tr.md) dosyasını oku; commit'ler [Developer Certificate of Origin](https://developercertificate.org/) altında imzalanır (`git commit -s`). Katılarak [Davranış Kuralları](CODE_OF_CONDUCT.md)'nı kabul etmiş olursun.

## Lisans

[Apache Lisansı 2.0](LICENSE). [NOTICE](NOTICE) dosyası her kopyayla birlikte gider. Ad ve logo [marka politikası](TRADEMARK.md) kapsamında. Pakete dahil üçüncü taraf kodu: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Anthropic tarafından yapılmadı. Claude ve Claude Code, Anthropic'in markalarıdır; neyle çalıştığını söylemek için anılır. [Ink](https://github.com/vadimdemedes/ink), [React](https://react.dev), [esbuild](https://esbuild.github.io), [TypeScript](https://www.typescriptlang.org) ve Node.js'in yerleşik SQLite'ı üzerine kuruldu.

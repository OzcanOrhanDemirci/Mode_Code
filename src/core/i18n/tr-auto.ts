// SPDX-License-Identifier: Apache-2.0
/** Turkish messages of full autonomy and the parallel agents' page. */
import type { enAuto } from './en-auto.js';

export const trAuto: Record<keyof typeof enAuto, string> = {
  'kw.kind.fullAuto': 'tam otonom',

  // ── tam otonom, bir çalışma biçimi ──
  'full.card': 'Tam otonom hiçbir şey sormaz. Geri dönüşü olmayan işi yapmaz: komutuyla sana bırakır.',
  'full.guard.ask':
    '🤖 Tam otonom kimseye sormaz: kişi hiçbir şey sorulmamasını seçti. Onun kayıtlı kararlarına göre (hafıza, projenin kilitleri, commit kuralı) karar ver ya da geri alınabilir, güvenli varsayılanı seç, cevabında hangisi olduğunu söyle ve devam et.',
  'full.guard.plan': '🤖 Tam otonomda plan modu yok: plan modu kişinin onayını bekler ve kimseye sorulmaz. Planı cevabında yap ve işe devam et.',
  'full.notify.done': 'Tam otonom bitti: {task}',
  'full.notify.waiting': 'Tam otonom durdu; {n} adım seni bekliyor: {task}',
  'full.notify.flagged': "Tam otonom durdu: Anthropic'in güvenlik denetimi bir cevabı durdurdu. Oturum seni bekliyor.",

  // ── Çalışma › Paralel ajanlar ──
  'page.agents': 'Paralel ajanlar',
  'desc.agents': "Paralel ajanlar: Claude'un kaç ajan başlatacağı, her oturumda şeritten sen belirlersin. Burada açılana kadar kapalı.",
  'set.agents.confirm':
    "Bu açıkken her oturum ajanlar kapalı başlar: sen şeritten ayarlayana kadar Claude ajan başlatmaz (aşağıdaki salt okuyan yardımcılar hariç). Açmak için Enter'a bir kez daha bas.",
  'set.agents.modes': 'Şeritte',
  'set.agents.mode.off': 'Kapalı: Claude ajan başlatmaz, işi kendisi yapar.',
  'set.agents.mode.free': 'Aynı anda en çok N: ne zaman başlatacağına Claude karar verir; ayar sen değiştirene kadar kalır.',
  'set.agents.mode.assigned': 'Sonraki isteğin için tam N, yazarsan her birinin kendi görevi, türü ve modeliyle; ajanlar bitince mod kendiliğinden kapanır.',
  'set.agents.note':
    "Her oturum ajanlar kapalı başlar. Ultracode ve Claude Code'un iş akışları kendi ajanlarını yönetir: ultracode açıkken mod kenara çekilir, kapanınca geri döner.",
  'set.agents.sessions': 'Bu bilgisayardaki Claude Code oturumları',
  'set.agents.sessionsNone': 'Çalışan yok.',
  'set.agents.sessionsUnread': "Okunamadı: bu Claude Code'da 'claude agents' komutu yok.",
};

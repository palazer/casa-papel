import type { Messages } from '../en'

/** A day of the month the way it is said, "ayın 5'i": the ending follows the number. */
const DAY_ENDING: Record<number, string> = { 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u' }
const TENS_ENDING: Record<number, string> = { 10: 'u', 20: 'si', 30: 'u' }

export const app: Messages['app'] = {
  screen: { statement: 'Bilanço', grid: 'Tablo', payments: 'Ödemeler', trends: 'Grafikler', household: 'Hane', data: 'Veriler', guide: 'Kılavuz' },
  settings: 'Ayarlar',
  done: { all: 'Tamam', none: 'Henüz tamamlanmadı', some: (done, total) => `${done}/${total} tamam` },
  rule: {
    shareOfIncome: (share) => `gelirin ${share} kadarı`,
    shareOfOwnIncome: (share) => `kendi gelirinin ${share} kadarı`,
    shareOfRow: (share, row) => `${row != null ? `"${row}" satırının` : 'artık olmayan bir gelir satırının'} ${share} kadarı`,
    shareOfRest: (share) => `geriye kalanın ${share} kadarı`,
    rest: 'geriye kalan',
    idle: 'hiçbir şey; geriye kalanı başka bir hesap alıyor',
    none: 'henüz kural yok',
    fixed: 'sabit bir tutar',
  },
  householdCurrency: (code) => `${code} (hanenin para birimi)`,
  onlyPlusMinus: 'Bir tutarda yalnızca + ve - kullanılabilir.',
  notANumber: 'Bu, okuyabildiğim bir sayı değil.',
  ordinalDay: (day) => `ayın ${day}'${day % 10 === 0 ? TENS_ENDING[day] ?? 'u' : DAY_ENDING[day % 10]}`,
  broken: {
    title: 'Bu ekranda bir şey bozuldu',
    text: 'Verilerin bu tarayıcıda güvende. Devam etmek için sayfayı yeniden yükle. Tekrar ederse verilerini Veriler ekranından dışa aktar ve aşağıdaki mesajı bildir.',
    reload: 'Yeniden yükle',
  },
}

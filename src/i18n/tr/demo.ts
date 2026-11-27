import type { Messages } from '../en'

/**
 * The demo household's names in Turkish. The people and the dog keep their names; things, accounts, rows and items
 * are named the way the app names them in Turkish ("Daire – Kira", "Seyahat – Ayrılan"). The format is the Turkish one.
 */
export const demo: Messages['demo'] = {
  household: 'Demo hane',
  locale: 'tr-TR',
  entity: { sam: 'Sam', alex: 'Alex', robin: 'Robin', biscuit: 'Biscuit', car: 'Araba', flat: 'Daire' },
  account: { main: 'Ana hesap', savings: 'Birikim', invest: 'Endeks fonu', card: 'Kredi kartı' },
  category: { housing: 'Konut', living: 'Yaşam', transport: 'Ulaşım', family: 'Aile ve evcil hayvanlar', fun: 'Eğlence', personal: 'Kişisel', transfers: 'Transferler' },
  row: {
    samSalary: 'Sam – Maaş', alexSalary: 'Alex – Maaş', childBenefit: 'Robin – Çocuk yardımı', otherIncome: 'Diğer gelir',
    rent: 'Daire – Kira', utilities: 'Daire – Faturalar', groceries: 'Market', transport: 'Toplu taşıma', carInsurance: 'Araba – Sigorta',
    dog: 'Biscuit – Masraflar', childcare: 'Robin – Çocuk bakımı', subscriptions: 'Abonelikler', health: 'Sağlık', samPersonal: 'Sam – Kişisel',
    alexPersonal: 'Alex – Kişisel', travel: 'Seyahat', clothing: 'Giyim', cardPayment: 'Kredi kartı – Ödeme',
    toSavings: 'Birikime aktarılan', toInvestment: 'Yatırıma aktarılan', travelAlloc: 'Seyahat – Ayrılan', clothingAlloc: 'Giyim – Ayrılan',
    pocketSam: 'Sam – Harçlık', pocketAlex: 'Alex – Harçlık',
  },
  item: {
    rent: 'Kira', streaming: 'Yayın aboneliği', cloudStorage: 'Bulut depolama', concertTickets: 'Konser biletleri', books: 'Kitaplar', gym: 'Spor salonu',
    weekendInLisbon: 'Lizbon\'da hafta sonu', runningShoes: 'Koşu ayakkabısı', soldOldBike: 'Eski bisiklet satıldı', winterCoat: 'Kışlık mont',
  },
  schedule: { rent: 'Kira', carInsurance: 'Araba sigortası', streaming: 'Yayın aboneliği', dogTax: 'Köpek vergisi', quarterly: 'Üç ayda bir: Oca, Nis, Tem, Eki', yearlyInMarch: 'Her yıl Mart ayında' },
  pool: { travel: 'Seyahat', clothing: 'Giyim' },
  method: { debit: 'Otomatik ödeme', standing: 'Düzenli transfer', transfer: 'Elle transfer', card: 'Kredi kartı', mainAccountNote: 'Ana hesap' },
}

import type { Messages } from '../en'

export const store: Messages['store'] = {
  setupStep: { income: 'Gelir', expenses: 'Giderler', savings: 'Birikim', virtual: 'Sanal hesaplar', investments: 'Yatırımlar', debts: 'Krediler ve kartlar' },
  suggestedAccount: {
    main: 'Gelirinin yattığı, faturalarının çıktığı hesap: ayın parası buradan geçer.',
    savings: 'Ayın geriye kalanının gidebileceği yer. Sanal hesaplar bunun içinde durur.',
  },
  change: {
    nothing: 'yok',
    figures: (before, after) => `${before} → ${after}`,
    amountChanges: (name, span, months) => `"${name}", ${span}: ${months} ayda değişiyor`,
    amountEach: (name, span, by, more, months) => `"${name}", ${span}: ${months} ayın her birinde ${by} ${more ? 'fazla' : 'az'}`,
    amountFrom: (name, from, figures) => `"${name}", ${from} ayından itibaren: ${figures}`,
    amount: (name, span, figures) => `"${name}", ${span}: ${figures}`,
    balance: (name, span, figures) => `"${name}", ${span} sonunda: ${figures}`,
    netWorth: (span, figures) => `Net varlık, ${span} sonunda: ${figures}`,
    sums: (span) => `Ayın toplamları, ${span}`,
    andMore: (n) => `ve ${n} tane daha`,
  },
  otherChanges: (n) => `ve ${n} başka değişiklik: adlar, ayarlar, notlar ya da düzenli kalemler`,
}

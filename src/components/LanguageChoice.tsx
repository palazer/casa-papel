import { Segmented } from './Segmented'
import { LANGUAGES, chooseLanguage, lang, txt, type Lang } from '@/i18n'

/**
 * The device's language (DESIGN.md §13): each option in its own words, whatever the page speaks, so it can be found
 * by someone who reads neither. Choosing the other one stores it on the device and loads the page again.
 */
export function LanguageChoice() {
  return (
    <Segmented
      label={txt.common.language} value={lang}
      options={LANGUAGES.map((l) => ({ value: l.lang, label: l.name }))}
      onChange={(to) => { if (to !== lang) chooseLanguage(to as Lang) }}
    />
  )
}

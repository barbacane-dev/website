import en from './translations/en.json';
import fr from './translations/fr.json';
import de from './translations/de.json';
import es from './translations/es.json';

export const LOCALES = ['en', 'fr', 'de', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};

const translations: Record<Locale, typeof en> = {
  en,
  fr,
  de,
  es,
};

function getNestedValue(obj: unknown, keys: string[]): unknown {
  let result = obj;
  for (const k of keys) {
    if (result && typeof result === 'object' && k in result) {
      result = (result as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return result;
}

/**
 * Get translation function for a specific locale
 * Returns a function that retrieves nested translation keys
 */
export function useTranslations(locale: Locale) {
  const dict = translations[locale] || translations[DEFAULT_LOCALE];

  /**
   * Get a translation by dot-notation key path
   * Example: t('home.hero.title') returns "Your spec is your"
   */
  return function t(key: string): string {
    const keys = key.split('.');
    let result: unknown = getNestedValue(dict, keys);

    // Fallback to English if key not found
    if (result === undefined) {
      result = getNestedValue(translations[DEFAULT_LOCALE], keys);
    }

    return typeof result === 'string' ? result : key;
  };
}

/**
 * Get locale from URL path
 */
export function getLocaleFromUrl(url: URL): Locale {
  const [, locale] = url.pathname.split('/');
  if (LOCALES.includes(locale as Locale)) {
    return locale as Locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Check if a locale is valid
 */
export function isValidLocale(locale: string): locale is Locale {
  return LOCALES.includes(locale as Locale);
}

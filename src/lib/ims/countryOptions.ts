import { getAlpha2Codes } from 'i18n-iso-countries';

export interface CountryOption {
  id: string;
  name: string;
}

interface CountryDisplayNames {
  of(code: string): string | undefined;
}

function createDisplayNames(locale: string): CountryDisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return null;
  }
}

export function getCountryOptions(
  locale = 'en-AU',
  displayNames: CountryDisplayNames | null = createDisplayNames(locale),
): CountryOption[] {
  return Object.keys(getAlpha2Codes())
    .map(code => {
      const countryName = displayNames?.of(code);
      return { id: code, name: countryName && countryName !== code ? `${countryName} (${code})` : code };
    })
    .sort((left, right) => left.name.localeCompare(right.name, locale));
}
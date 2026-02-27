// Maps common country names to ISO 3166-1 alpha-2 codes
const COUNTRY_CODES: Record<string, string> = {
  "united states": "US", "usa": "US", "us": "US",
  "united kingdom": "GB", "uk": "GB",
  "canada": "CA",
  "australia": "AU",
  "germany": "DE",
  "france": "FR",
  "india": "IN",
  "pakistan": "PK",
  "brazil": "BR",
  "netherlands": "NL",
  "spain": "ES",
  "italy": "IT",
  "japan": "JP",
  "china": "CN",
  "south korea": "KR",
  "sweden": "SE",
  "switzerland": "CH",
  "israel": "IL",
  "singapore": "SG",
  "ireland": "IE",
  "new zealand": "NZ",
  "united arab emirates": "AE", "uae": "AE",
  "saudi arabia": "SA",
  "mexico": "MX",
  "argentina": "AR",
  "colombia": "CO",
  "chile": "CL",
  "nigeria": "NG",
  "south africa": "ZA",
  "egypt": "EG",
  "turkey": "TR",
  "poland": "PL",
  "ukraine": "UA",
  "romania": "RO",
  "portugal": "PT",
  "czech republic": "CZ",
  "austria": "AT",
  "belgium": "BE",
  "denmark": "DK",
  "norway": "NO",
  "finland": "FI",
  "indonesia": "ID",
  "philippines": "PH",
  "malaysia": "MY",
  "thailand": "TH",
  "vietnam": "VN",
  "bangladesh": "BD",
  "russia": "RU",
  "hong kong": "HK",
  "taiwan": "TW",
};

function toFlagEmoji(code: string): string {
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

/**
 * Convert a country name to a flag emoji.
 * Falls back to a globe emoji if the country is unknown.
 */
export function countryFlag(country: string): string {
  const normalized = country.trim().toLowerCase();
  const code = COUNTRY_CODES[normalized];
  if (code) return toFlagEmoji(code);

  // Try if it's already a 2-letter code
  if (/^[a-zA-Z]{2}$/.test(country.trim())) {
    return toFlagEmoji(country.trim().toUpperCase());
  }

  return "🌐";
}

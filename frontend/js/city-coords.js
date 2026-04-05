export const CITY_COORDS = {
  // IATA codes
  MAD: { lat: 40.4983, lng: -3.5676 },  BOG: { lat: 4.7016,  lng: -74.1469 },
  MEX: { lat: 19.4363, lng: -99.0721 }, GDL: { lat: 20.5218, lng: -103.3110 },
  VER: { lat: 19.1438, lng: -96.1873 }, CUN: { lat: 21.0365, lng: -86.8771 },
  OAX: { lat: 17.0000, lng: -96.7266 }, MID: { lat: 20.9370, lng: -89.6576 },
  MTY: { lat: 25.7785, lng: -100.1068 }, PBC: { lat: 19.1581, lng: -98.3714 },
  LIM: { lat: -12.0219, lng: -77.1143 }, MIA: { lat: 25.7959, lng: -80.2870 },
  BCN: { lat: 41.2974, lng: 2.0833 },   MDE: { lat: 6.1676,  lng: -75.4231 },
  CTG: { lat: 10.4424, lng: -75.5130 },

  // City names — lowercase normalized
  madrid:            { lat: 40.4168,  lng: -3.7038 },
  bogotá:            { lat: 4.7110,   lng: -74.0721 },
  bogota:            { lat: 4.7110,   lng: -74.0721 },
  cdmx:              { lat: 19.4326,  lng: -99.1332 },
  "ciudad de méxico":{ lat: 19.4326,  lng: -99.1332 },
  "ciudad de mexico":{ lat: 19.4326,  lng: -99.1332 },
  "mexico city":     { lat: 19.4326,  lng: -99.1332 },
  "mexico":          { lat: 19.4326,  lng: -99.1332 },
  veracruz:          { lat: 19.1738,  lng: -96.1342 },
  acayucan:          { lat: 17.9491,  lng: -94.9148 },
  guadalajara:       { lat: 20.6597,  lng: -103.3496 },
  barcelona:         { lat: 41.3851,  lng: 2.1734 },
  miami:             { lat: 25.7617,  lng: -80.1918 },
  lima:              { lat: -12.0464, lng: -77.0428 },
  cancún:            { lat: 21.1619,  lng: -86.8515 },
  cancun:            { lat: 21.1619,  lng: -86.8515 },
  oaxaca:            { lat: 17.0669,  lng: -96.7203 },
  mérida:            { lat: 20.9674,  lng: -89.5926 },
  merida:            { lat: 20.9674,  lng: -89.5926 },
  monterrey:         { lat: 25.6866,  lng: -100.3161 },
  puebla:            { lat: 19.0414,  lng: -98.2063 },
  cartagena:         { lat: 10.3910,  lng: -75.4794 },
  medellin:          { lat: 6.2442,   lng: -75.5812 },
  medellín:          { lat: 6.2442,   lng: -75.5812 },
};

/** Normalize a string for lookup: lowercase, strip accents, drop "airport"/"intl" suffixes */
function normalize(s) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip diacritics
    .replace(/\b(international|intl|airport|aeropuerto|aeroport)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveCoords(name) {
  if (!name) return null;
  const raw = name.trim();
  // 1. Exact IATA (uppercase)
  const iata = CITY_COORDS[raw.toUpperCase()];
  if (iata) return iata;
  // 2. Exact lowercase
  const exact = CITY_COORDS[raw.toLowerCase()];
  if (exact) return exact;
  // 3. Normalized (strips accents + airport words)
  const norm = normalize(raw);
  if (CITY_COORDS[norm]) return CITY_COORDS[norm];
  // 4. Scan all keys normalized (handles stored keys with accents vs typed without)
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (normalize(key) === norm) return coords;
  }
  return null;
}

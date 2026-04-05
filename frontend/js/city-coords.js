// Static fast-path for common IATA codes and city names.
// resolveCoords() falls back to the /api/geocode endpoint for anything not listed.
const CITY_COORDS = {
  // IATA codes
  MAD: { lat: 40.4983, lng: -3.5676 },  BOG: { lat: 4.7016,  lng: -74.1469 },
  MEX: { lat: 19.4363, lng: -99.0721 }, GDL: { lat: 20.5218, lng: -103.3110 },
  VER: { lat: 19.1438, lng: -96.1873 }, CUN: { lat: 21.0365, lng: -86.8771 },
  OAX: { lat: 17.0000, lng: -96.7266 }, MID: { lat: 20.9370, lng: -89.6576 },
  MTY: { lat: 25.7785, lng: -100.1068 }, LIM: { lat: -12.0219, lng: -77.1143 },
  MIA: { lat: 25.7959, lng: -80.2870 }, BCN: { lat: 41.2974, lng: 2.0833 },
  MDE: { lat: 6.1676,  lng: -75.4231 }, CTG: { lat: 10.4424, lng: -75.5130 },
};

// In-browser cache so we don't re-fetch the same place name twice
const _apiCache = new Map();

function _staticLookup(name) {
  const up  = name.trim().toUpperCase();
  const low = name.trim().toLowerCase();
  return CITY_COORDS[up] || CITY_COORDS[low] || null;
}

/**
 * Resolve a place name to {lat, lng}.
 * Returns a Promise — checks static dict first, then /api/geocode.
 */
export async function resolveCoords(name) {
  if (!name) return null;
  const hit = _staticLookup(name);
  if (hit) return hit;

  const key = name.trim().toLowerCase();
  if (_apiCache.has(key)) return _apiCache.get(key);

  try {
    const r = await fetch(`./api/geocode?q=${encodeURIComponent(name.trim())}`);
    if (!r.ok) { _apiCache.set(key, null); return null; }
    const coords = await r.json();
    _apiCache.set(key, coords);
    return coords;
  } catch {
    _apiCache.set(key, null);
    return null;
  }
}

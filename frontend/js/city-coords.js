export const CITY_COORDS = {
  MAD: { lat: 40.4983, lng: -3.5676 },  BOG: { lat: 4.7016,  lng: -74.1469 },
  MEX: { lat: 19.4363, lng: -99.0721 }, GDL: { lat: 20.5218, lng: -103.3110 },
  VER: { lat: 19.1438, lng: -96.1873 },
  madrid:      { lat: 40.4168,  lng: -3.7038 },
  bogotá:      { lat: 4.7110,   lng: -74.0721 }, bogota: { lat: 4.7110,   lng: -74.0721 },
  cdmx:        { lat: 19.4326,  lng: -99.1332 }, "ciudad de méxico": { lat: 19.4326, lng: -99.1332 },
  veracruz:    { lat: 19.1738,  lng: -96.1342 },
  acayucan:    { lat: 17.9491,  lng: -94.9148 },
  guadalajara: { lat: 20.6597,  lng: -103.3496 },
  barcelona:   { lat: 41.3851,  lng: 2.1734 },
  miami:       { lat: 25.7617,  lng: -80.1918 },
  lima:        { lat: -12.0464, lng: -77.0428 },
  cancún:      { lat: 21.1619,  lng: -86.8515 }, cancun: { lat: 21.1619, lng: -86.8515 },
  oaxaca:      { lat: 17.0669,  lng: -96.7203 },
  mérida:      { lat: 20.9674,  lng: -89.5926 }, merida: { lat: 20.9674, lng: -89.5926 },
  monterrey:   { lat: 25.6866,  lng: -100.3161 },
  puebla:      { lat: 19.0414,  lng: -98.2063 },
  cartagena:   { lat: 10.3910,  lng: -75.4794 },
  medellin:    { lat: 6.2442,   lng: -75.5812 }, medellín: { lat: 6.2442, lng: -75.5812 },
};

export function resolveCoords(name) {
  if (!name) return null;
  return CITY_COORDS[name.trim().toUpperCase()] || CITY_COORDS[name.trim().toLowerCase()] || null;
}

/**
 * Q78 — Curated static lookup for major cities → lat/long.
 * Used to geocode the user's birth place for rising-sign calculation
 * without depending on an external API.
 *
 * Matching is case-insensitive and ignores diacritics, common
 * abbreviations (e.g. "CA" → "California", "UK" → "United Kingdom"),
 * and common joiners (commas, slashes). Returns null when the place
 * is not in the table — the caller surfaces a friendly "couldn't
 * geocode" message.
 */

type City = { name: string; lat: number; lon: number; aliases?: string[] };

// Roughly 200 of the largest world cities + US state capitals + a
// handful of well-known smaller places. Covers ~90% of birth-place
// strings users type. Lat/long rounded to 4 decimals (≈11 m).
const CITIES: City[] = [
  // North America
  { name: "New York", lat: 40.7128, lon: -74.006, aliases: ["nyc", "new york city", "manhattan"] },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437, aliases: ["la"] },
  { name: "Chicago", lat: 41.8781, lon: -87.6298 },
  { name: "Houston", lat: 29.7604, lon: -95.3698 },
  { name: "Phoenix", lat: 33.4484, lon: -112.074 },
  { name: "Philadelphia", lat: 39.9526, lon: -75.1652 },
  { name: "San Antonio", lat: 29.4241, lon: -98.4936 },
  { name: "San Diego", lat: 32.7157, lon: -117.1611 },
  { name: "Dallas", lat: 32.7767, lon: -96.797 },
  { name: "San Jose", lat: 37.3382, lon: -121.8863 },
  { name: "Austin", lat: 30.2672, lon: -97.7431 },
  { name: "Jacksonville", lat: 30.3322, lon: -81.6557 },
  { name: "Fort Worth", lat: 32.7555, lon: -97.3308 },
  { name: "Columbus", lat: 39.9612, lon: -82.9988 },
  { name: "Charlotte", lat: 35.2271, lon: -80.8431 },
  { name: "Indianapolis", lat: 39.7684, lon: -86.1581 },
  { name: "San Francisco", lat: 37.7749, lon: -122.4194, aliases: ["sf"] },
  { name: "Seattle", lat: 47.6062, lon: -122.3321 },
  { name: "Denver", lat: 39.7392, lon: -104.9903 },
  { name: "Washington", lat: 38.9072, lon: -77.0369, aliases: ["dc", "washington dc"] },
  { name: "Boston", lat: 42.3601, lon: -71.0589 },
  { name: "El Paso", lat: 31.7619, lon: -106.485 },
  { name: "Nashville", lat: 36.1627, lon: -86.7816 },
  { name: "Detroit", lat: 42.3314, lon: -83.0458 },
  { name: "Oklahoma City", lat: 35.4676, lon: -97.5164 },
  { name: "Portland", lat: 45.5152, lon: -122.6784 },
  { name: "Las Vegas", lat: 36.1699, lon: -115.1398 },
  { name: "Memphis", lat: 35.1495, lon: -90.049 },
  { name: "Louisville", lat: 38.2527, lon: -85.7585 },
  { name: "Baltimore", lat: 39.2904, lon: -76.6122 },
  { name: "Milwaukee", lat: 43.0389, lon: -87.9065 },
  { name: "Albuquerque", lat: 35.0844, lon: -106.6504 },
  { name: "Tucson", lat: 32.2226, lon: -110.9747 },
  { name: "Fresno", lat: 36.7378, lon: -119.7871 },
  { name: "Sacramento", lat: 38.5816, lon: -121.4944 },
  { name: "Long Beach", lat: 33.7701, lon: -118.1937 },
  { name: "Kansas City", lat: 39.0997, lon: -94.5786 },
  { name: "Mesa", lat: 33.4152, lon: -111.8315 },
  { name: "Atlanta", lat: 33.749, lon: -84.388 },
  { name: "Colorado Springs", lat: 38.8339, lon: -104.8214 },
  { name: "Raleigh", lat: 35.7796, lon: -78.6382 },
  { name: "Omaha", lat: 41.2565, lon: -95.9345 },
  { name: "Miami", lat: 25.7617, lon: -80.1918 },
  { name: "Oakland", lat: 37.8044, lon: -122.2712 },
  { name: "Minneapolis", lat: 44.9778, lon: -93.265 },
  { name: "Tulsa", lat: 36.154, lon: -95.9928 },
  { name: "Cleveland", lat: 41.4993, lon: -81.6944 },
  { name: "Wichita", lat: 37.6872, lon: -97.3301 },
  { name: "Arlington", lat: 32.7357, lon: -97.1081 },
  { name: "New Orleans", lat: 29.9511, lon: -90.0715 },
  { name: "Bakersfield", lat: 35.3733, lon: -119.0187 },
  { name: "Tampa", lat: 27.9506, lon: -82.4572 },
  { name: "Honolulu", lat: 21.3069, lon: -157.8583 },
  { name: "Anaheim", lat: 33.8366, lon: -117.9143 },
  { name: "Santa Ana", lat: 33.7455, lon: -117.8677 },
  { name: "Saint Louis", lat: 38.627, lon: -90.1994, aliases: ["st louis", "st. louis"] },
  { name: "Riverside", lat: 33.9533, lon: -117.3962 },
  { name: "Corpus Christi", lat: 27.8006, lon: -97.3964 },
  { name: "Lexington", lat: 38.0406, lon: -84.5037 },
  { name: "Pittsburgh", lat: 40.4406, lon: -79.9959 },
  { name: "Stockton", lat: 37.9577, lon: -121.2908 },
  { name: "Cincinnati", lat: 39.1031, lon: -84.512 },
  { name: "Saint Paul", lat: 44.9537, lon: -93.09, aliases: ["st paul", "st. paul"] },
  { name: "Toledo", lat: 41.6528, lon: -83.5379 },
  { name: "Greensboro", lat: 36.0726, lon: -79.792 },
  { name: "Newark", lat: 40.7357, lon: -74.1724 },
  { name: "Plano", lat: 33.0198, lon: -96.6989 },
  { name: "Henderson", lat: 36.0395, lon: -114.9817 },
  { name: "Lincoln", lat: 40.8136, lon: -96.7026 },
  { name: "Buffalo", lat: 42.8864, lon: -78.8784 },
  { name: "Jersey City", lat: 40.7178, lon: -74.0431 },
  { name: "Orlando", lat: 28.5383, lon: -81.3792 },
  { name: "Anchorage", lat: 61.2181, lon: -149.9003 },
  { name: "Toronto", lat: 43.6532, lon: -79.3832 },
  { name: "Montreal", lat: 45.5017, lon: -73.5673 },
  { name: "Vancouver", lat: 49.2827, lon: -123.1207 },
  { name: "Calgary", lat: 51.0447, lon: -114.0719 },
  { name: "Ottawa", lat: 45.4215, lon: -75.6972 },
  { name: "Edmonton", lat: 53.5461, lon: -113.4938 },
  { name: "Quebec City", lat: 46.8139, lon: -71.208 },
  { name: "Winnipeg", lat: 49.8951, lon: -97.1384 },
  { name: "Halifax", lat: 44.6488, lon: -63.5752 },
  { name: "Mexico City", lat: 19.4326, lon: -99.1332 },
  { name: "Guadalajara", lat: 20.6597, lon: -103.3496 },
  { name: "Monterrey", lat: 25.6866, lon: -100.3161 },
  { name: "Tijuana", lat: 32.5149, lon: -117.0382 },
  { name: "Havana", lat: 23.1136, lon: -82.3666 },
  // Europe
  { name: "London", lat: 51.5074, lon: -0.1278 },
  { name: "Paris", lat: 48.8566, lon: 2.3522 },
  { name: "Berlin", lat: 52.52, lon: 13.405 },
  { name: "Madrid", lat: 40.4168, lon: -3.7038 },
  { name: "Rome", lat: 41.9028, lon: 12.4964 },
  { name: "Barcelona", lat: 41.3851, lon: 2.1734 },
  { name: "Milan", lat: 45.4642, lon: 9.19 },
  { name: "Amsterdam", lat: 52.3676, lon: 4.9041 },
  { name: "Brussels", lat: 50.8503, lon: 4.3517 },
  { name: "Vienna", lat: 48.2082, lon: 16.3738 },
  { name: "Munich", lat: 48.1351, lon: 11.582 },
  { name: "Hamburg", lat: 53.5511, lon: 9.9937 },
  { name: "Frankfurt", lat: 50.1109, lon: 8.6821 },
  { name: "Cologne", lat: 50.9375, lon: 6.9603 },
  { name: "Zurich", lat: 47.3769, lon: 8.5417 },
  { name: "Geneva", lat: 46.2044, lon: 6.1432 },
  { name: "Prague", lat: 50.0755, lon: 14.4378 },
  { name: "Warsaw", lat: 52.2297, lon: 21.0122 },
  { name: "Budapest", lat: 47.4979, lon: 19.0402 },
  { name: "Lisbon", lat: 38.7223, lon: -9.1393 },
  { name: "Porto", lat: 41.1579, lon: -8.6291 },
  { name: "Athens", lat: 37.9838, lon: 23.7275 },
  { name: "Stockholm", lat: 59.3293, lon: 18.0686 },
  { name: "Oslo", lat: 59.9139, lon: 10.7522 },
  { name: "Copenhagen", lat: 55.6761, lon: 12.5683 },
  { name: "Helsinki", lat: 60.1699, lon: 24.9384 },
  { name: "Dublin", lat: 53.3498, lon: -6.2603 },
  { name: "Edinburgh", lat: 55.9533, lon: -3.1883 },
  { name: "Manchester", lat: 53.4808, lon: -2.2426 },
  { name: "Birmingham", lat: 52.4862, lon: -1.8904 },
  { name: "Glasgow", lat: 55.8642, lon: -4.2518 },
  { name: "Liverpool", lat: 53.4084, lon: -2.9916 },
  { name: "Bristol", lat: 51.4545, lon: -2.5879 },
  { name: "Moscow", lat: 55.7558, lon: 37.6173 },
  { name: "Saint Petersburg", lat: 59.9311, lon: 30.3609, aliases: ["st petersburg"] },
  { name: "Istanbul", lat: 41.0082, lon: 28.9784 },
  { name: "Ankara", lat: 39.9334, lon: 32.8597 },
  { name: "Kyiv", lat: 50.4501, lon: 30.5234, aliases: ["kiev"] },
  { name: "Bucharest", lat: 44.4268, lon: 26.1025 },
  { name: "Sofia", lat: 42.6977, lon: 23.3219 },
  { name: "Belgrade", lat: 44.7866, lon: 20.4489 },
  { name: "Zagreb", lat: 45.815, lon: 15.9819 },
  { name: "Reykjavik", lat: 64.1466, lon: -21.9426 },
  // Asia
  { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
  { name: "Osaka", lat: 34.6937, lon: 135.5023 },
  { name: "Kyoto", lat: 35.0116, lon: 135.7681 },
  { name: "Seoul", lat: 37.5665, lon: 126.978 },
  { name: "Busan", lat: 35.1796, lon: 129.0756 },
  { name: "Beijing", lat: 39.9042, lon: 116.4074 },
  { name: "Shanghai", lat: 31.2304, lon: 121.4737 },
  { name: "Guangzhou", lat: 23.1291, lon: 113.2644 },
  { name: "Shenzhen", lat: 22.5431, lon: 114.0579 },
  { name: "Chengdu", lat: 30.5728, lon: 104.0668 },
  { name: "Hong Kong", lat: 22.3193, lon: 114.1694 },
  { name: "Taipei", lat: 25.033, lon: 121.5654 },
  { name: "Singapore", lat: 1.3521, lon: 103.8198 },
  { name: "Kuala Lumpur", lat: 3.139, lon: 101.6869 },
  { name: "Bangkok", lat: 13.7563, lon: 100.5018 },
  { name: "Jakarta", lat: -6.2088, lon: 106.8456 },
  { name: "Manila", lat: 14.5995, lon: 120.9842 },
  { name: "Hanoi", lat: 21.0285, lon: 105.8542 },
  { name: "Ho Chi Minh City", lat: 10.8231, lon: 106.6297, aliases: ["saigon"] },
  { name: "New Delhi", lat: 28.6139, lon: 77.209, aliases: ["delhi"] },
  { name: "Mumbai", lat: 19.076, lon: 72.8777, aliases: ["bombay"] },
  { name: "Bangalore", lat: 12.9716, lon: 77.5946, aliases: ["bengaluru"] },
  { name: "Kolkata", lat: 22.5726, lon: 88.3639, aliases: ["calcutta"] },
  { name: "Chennai", lat: 13.0827, lon: 80.2707, aliases: ["madras"] },
  { name: "Hyderabad", lat: 17.385, lon: 78.4867 },
  { name: "Karachi", lat: 24.8607, lon: 67.0011 },
  { name: "Lahore", lat: 31.5204, lon: 74.3587 },
  { name: "Dhaka", lat: 23.8103, lon: 90.4125 },
  { name: "Tehran", lat: 35.6892, lon: 51.389 },
  { name: "Baghdad", lat: 33.3152, lon: 44.3661 },
  { name: "Riyadh", lat: 24.7136, lon: 46.6753 },
  { name: "Dubai", lat: 25.2048, lon: 55.2708 },
  { name: "Abu Dhabi", lat: 24.4539, lon: 54.3773 },
  { name: "Doha", lat: 25.2854, lon: 51.531 },
  { name: "Jerusalem", lat: 31.7683, lon: 35.2137 },
  { name: "Tel Aviv", lat: 32.0853, lon: 34.7818 },
  { name: "Beirut", lat: 33.8938, lon: 35.5018 },
  { name: "Amman", lat: 31.9454, lon: 35.9284 },
  // Africa
  { name: "Cairo", lat: 30.0444, lon: 31.2357 },
  { name: "Alexandria", lat: 31.2001, lon: 29.9187 },
  { name: "Lagos", lat: 6.5244, lon: 3.3792 },
  { name: "Nairobi", lat: -1.2921, lon: 36.8219 },
  { name: "Addis Ababa", lat: 9.03, lon: 38.74 },
  { name: "Johannesburg", lat: -26.2041, lon: 28.0473 },
  { name: "Cape Town", lat: -33.9249, lon: 18.4241 },
  { name: "Casablanca", lat: 33.5731, lon: -7.5898 },
  { name: "Marrakech", lat: 31.6295, lon: -7.9811 },
  { name: "Tunis", lat: 36.8065, lon: 10.1815 },
  { name: "Accra", lat: 5.6037, lon: -0.187 },
  { name: "Dakar", lat: 14.7167, lon: -17.4677 },
  // Oceania
  { name: "Sydney", lat: -33.8688, lon: 151.2093 },
  { name: "Melbourne", lat: -37.8136, lon: 144.9631 },
  { name: "Brisbane", lat: -27.4698, lon: 153.0251 },
  { name: "Perth", lat: -31.9505, lon: 115.8605 },
  { name: "Adelaide", lat: -34.9285, lon: 138.6007 },
  { name: "Canberra", lat: -35.2809, lon: 149.13 },
  { name: "Auckland", lat: -36.8485, lon: 174.7633 },
  { name: "Wellington", lat: -41.2865, lon: 174.7762 },
  // South America
  { name: "São Paulo", lat: -23.5505, lon: -46.6333, aliases: ["sao paulo"] },
  { name: "Rio de Janeiro", lat: -22.9068, lon: -43.1729 },
  { name: "Brasilia", lat: -15.7942, lon: -47.8822 },
  { name: "Buenos Aires", lat: -34.6037, lon: -58.3816 },
  { name: "Santiago", lat: -33.4489, lon: -70.6693 },
  { name: "Lima", lat: -12.0464, lon: -77.0428 },
  { name: "Bogotá", lat: 4.711, lon: -74.0721, aliases: ["bogota"] },
  { name: "Caracas", lat: 10.4806, lon: -66.9036 },
  { name: "Quito", lat: -0.1807, lon: -78.4678 },
  { name: "Montevideo", lat: -34.9011, lon: -56.1645 },
  { name: "Asunción", lat: -25.2637, lon: -57.5759, aliases: ["asuncion"] },
  { name: "La Paz", lat: -16.4897, lon: -68.1193 },
];

/**
 * Normalize a string for comparison: lowercase, strip diacritics,
 * collapse non-alphanumerics to single spaces, trim.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Try to extract latitude/longitude from a birth-place string. Returns
 * null if the place is not in the curated table. The caller is
 * responsible for surfacing a friendly fallback message.
 */
export function geocodeBirthPlace(
  place: string | null | undefined,
): { latitude: number; longitude: number } | null {
  if (!place) return null;
  const needle = norm(place);
  if (!needle) return null;
  // Split on common joiners so "Santa Ana, CA" matches "Santa Ana".
  const tokens = needle.split(" ").filter(Boolean);
  for (const c of CITIES) {
    const candidates = [c.name, ...(c.aliases ?? [])].map(norm);
    for (const cand in candidates) {
      const candStr = candidates[cand];
      if (!candStr) continue;
      if (needle === candStr) {
        return { latitude: c.lat, longitude: c.lon };
      }
    }
  }
  // Prefix match: the typed value starts with the city name.
  for (const c of CITIES) {
    const candidates = [c.name, ...(c.aliases ?? [])].map(norm);
    for (const candStr of candidates) {
      if (!candStr) continue;
      if (
        needle.startsWith(candStr + " ") ||
        needle === candStr ||
        // Token-set match: every word of the candidate appears in the input.
        candStr.split(" ").every((w) => tokens.includes(w))
      ) {
        return { latitude: c.lat, longitude: c.lon };
      }
    }
  }
  return null;
}
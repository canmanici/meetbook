# Location & Maps Plan

> Everything geospatial in one place: privacy blurring, Turkey geofence, place search,
> midpoint suggestions, deep links, and mobile location handling.

## 1. Location Privacy Model (read security doc §4 first)

| Data | Stored as | Exposed to others as |
|---|---|---|
| Book location | true `geography` + `public_location` (static ~1 km grid snap) | blurred point + distance rounded to 0.5 km |
| User GPS fix | `user_locations`, 30-day TTL | never |
| Meetup place | exact point | exact point — **but only to the two participants**, and only because they chose it |

**Static blur, computed once at write time:**
```python
def blur(lat: float, lng: float, grid: float = 0.01) -> tuple[float, float]:
    """Snap to ~1.1 km grid. Static: same input -> same output, so repeated
    queries can never be averaged to recover the true point."""
    return round(lat / grid) * grid, round(lng / grid) * grid
```

## 2. Turkey Geofence

Two layers (cheap check first):
1. **Bounding box** in Python: `35.8 <= lat <= 42.1 and 25.7 <= lng <= 44.8` → instant
   rejection of nonsense.
2. **Real polygon**: a migration loads a Turkey GeoJSON boundary into
   `country_boundaries`; validation runs `ST_Contains(boundary, point)`. The bbox alone
   would accept points in Greece, Cyprus, Syria, etc.

Applied to: meetup points (hard reject), book locations (hard reject), search centers (clamp).

## 3. Place Search (Google Places via backend proxy)

- The app calls **our** `/places/*` endpoints; the Google key lives only on the server.
- Caching (Redis): autocomplete 24 h (key: normalized query + coarse location),
  details 7 d, nearby 6 h (coords rounded to ~100 m for cache hits).
- Cost controls: per-user rate limit 60/min, daily global quota alarm at 80%,
  autocomplete fires after 3 typed chars + 300 ms debounce (mobile side).
- Safety mapping: Google `types` → our categories. `cafe|library|book_store|
  shopping_mall|university|transit_station|restaurant` → `verified_public`;
  anything residential/unknown → `warning`.

## 4. Midpoint & Suggestions

1. Take each participant's most recent `user_locations` fix (< 24 h old); fall back to
   city center if absent.
2. Midpoint: `ST_LineInterpolatePoint(ST_MakeLine(a, b), 0.5)` (geometry cast).
3. Query `/places/nearby` around the midpoint for safe categories, 2 km radius.
4. Return 3–5 POIs. **Response contains POIs only — never the inputs**, so neither user
   learns the other's location (only roughly that the midpoint is between them, which they
   already know from the distance shown on the book).

## 5. Mobile Location Handling (`expo-location`)

- Ask **when-in-use** permission only, at the moment of need (first search / meetup
  picker), with a pre-permission explainer screen — not at app launch.
- Graceful denial path: user picks a city manually; search uses city center; meetup
  picker starts at city center. The app must remain fully usable without GPS.
- Accuracy: `Location.Accuracy.Balanced` is enough (~100 m); we blur to 1 km anyway —
  don't burn battery on `Highest`.
- Each fix used for search/suggestions is POSTed once to `user_locations` (for midpoint
  computation) and never streamed.

## 6. Map Rendering & Picker (react-native-maps)

- Provider: Google on Android, Apple on iOS (default `react-native-maps` behavior). One
  map component, themed pins from the design system.
- Meetup picker interactions: drag pin / tap-to-place / search → each updates one shared
  `selectedPoint` state; reverse-geocode label shown under the pin; inline validation chip
  (green "Public place ✓" / amber "Unrecognized place — warning will apply" / red "Outside Turkey").
- Nearby-books map: clustered blurred pins; tapping opens a bottom-sheet card, never a callout with an address.

## 7. Opening the Confirmed Meetup in a Maps App

Order of attempts (first `Linking.canOpenURL` success wins):

| Provider | URL |
|---|---|
| Google Maps app | `comgooglemaps://?q={lat},{lng}` (iOS) / `geo:{lat},{lng}?q={lat},{lng}({label})` (Android) |
| Google Maps web | `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}` |
| Yandex Maps | `yandexmaps://maps.yandex.ru/?pt={lng},{lat}&z=16&l=map` ← **note: lng,lat order!** |
| Apple Maps (iOS fallback) | `http://maps.apple.com/?ll={lat},{lng}&q={label}` |
| Universal fallback | copy address + coordinates to clipboard, show toast |

iOS requires `LSApplicationQueriesSchemes` entries (`comgooglemaps`, `yandexmaps`) in
`app.json` for `canOpenURL` to work.

## 8. Common Pitfalls (learn these now, debug less later)

- **PostGIS order is (lng, lat)** — `ST_MakePoint(longitude, latitude)`. Most map SDKs use
  (lat, lng). This is the #1 geospatial bug; write helpers so raw order appears in exactly one file.
- `geography` distances are meters; `geometry` distances are degrees. We use `geography` for distance.
- `ST_DWithin(geography, ...)` uses the spatial index; `ST_Distance(...) < x` does not. Always filter with `ST_DWithin`.
- Yandex deep links take `pt=lng,lat` — reversed from Google/Apple.

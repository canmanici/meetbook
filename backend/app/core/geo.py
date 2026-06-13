"""Geospatial helpers shared by modules that store `geography(Point, 4326)` columns.

PostGIS point order is (lng, lat) — the #1 geospatial bug per LOCATION_AND_MAPS_PLAN.md.
This module is the only place that raw coordinate order should appear; everywhere else
works with explicit `lat`/`lng` floats or values produced by `make_point`/read via
`ST_Y`/`ST_X`.
"""

from geoalchemy2.elements import WKTElement

# Turkey bounding box — cheap pre-check before the country_boundaries polygon
# (ST_Contains) lookup in ExchangeRepository.is_in_turkey.
_TR_LAT_MIN = 35.8
_TR_LAT_MAX = 42.1
_TR_LNG_MIN = 25.7
_TR_LNG_MAX = 44.8

# Simplified Turkey mainland boundary, hand-drawn from coastline/border reference
# points. Coarse but keeps Istanbul/Ankara/Antalya inside while keeping nearby
# Greek territory (e.g. Rhodes at ~36.43N 28.22E) outside. Seeded into
# `country_boundaries` by migration d4e5f6a7b8c9; reused by tests to seed the
# same row against the test database (create_all doesn't run data migrations).
TURKEY_BOUNDARY_WKT = (
    "POLYGON((28.6 36.6, 30.5 36.2, 32.0 36.0, 34.5 36.7, 36.2 36.0, 38.0 37.0, "
    "42.0 37.2, 44.0 37.3, 44.8 39.7, 43.5 40.0, 43.0 41.5, 39.0 41.0, 36.0 41.2, "
    "35.0 42.0, 31.5 41.3, 29.0 41.0, 27.5 41.7, 26.0 41.0, 26.0 40.0, 26.5 39.0, "
    "26.5 38.0, 27.0 37.0, 28.6 36.6))"
)


def in_turkey_bbox(lat: float, lng: float) -> bool:
    """Cheap rejection of coordinates clearly outside Turkey."""
    return _TR_LAT_MIN <= lat <= _TR_LAT_MAX and _TR_LNG_MIN <= lng <= _TR_LNG_MAX


def blur(lat: float, lng: float, grid: float = 0.01) -> tuple[float, float]:
    """Snap to a ~1.1 km grid. Static: same input -> same output, so repeated
    queries can never be averaged to recover the true point."""
    return round(lat / grid) * grid, round(lng / grid) * grid


def make_point(lat: float, lng: float) -> WKTElement:
    """Build a `geography(Point, 4326)` value from (lat, lng)."""
    return WKTElement(f"POINT({lng} {lat})", srid=4326, extended=True)

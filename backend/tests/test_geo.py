from app.core.geo import blur, in_turkey_bbox, make_point


def test_blur_snaps_to_grid() -> None:
    assert blur(41.0082, 28.9784) == (41.01, 28.98)


def test_blur_is_static() -> None:
    assert blur(41.001, 28.991) == blur(41.004, 28.994)


def test_in_turkey_bbox_accepts_istanbul() -> None:
    assert in_turkey_bbox(41.0082, 28.9784) is True


def test_in_turkey_bbox_rejects_outside() -> None:
    assert in_turkey_bbox(0.0, 0.0) is False


def test_in_turkey_bbox_boundary_inclusive() -> None:
    assert in_turkey_bbox(35.8, 25.7) is True
    assert in_turkey_bbox(42.1, 44.8) is True


def test_make_point_uses_lng_lat_order() -> None:
    point = make_point(41.0082, 28.9784)
    assert str(point) == "POINT(28.9784 41.0082)"
    assert point.srid == 4326

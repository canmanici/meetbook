"""Books endpoints."""

import json
import logging
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.redis import bbox_cache_key, get_cached, set_cached
from app.modules.auth.dependencies import get_current_user, get_verified_user
from app.modules.auth.models import User
from app.modules.books.schemas import (
    BookBulkCreateRequest,
    BookBulkCreateResponse,
    BookCreateRequest,
    BookListResponse,
    BookOwnerView,
    BookPublicView,
    BookSearchParams,
    BookSearchResponse,
    BookUpdateRequest,
    ClusterResponse,
    ISBNLookupResponse,
    PhotoReorderRequest,
    PhotoView,
    ReorderBody,
    StaleBooksResponse,
)
from app.modules.books.service import BookError, BookService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/books", tags=["books"])


def _get_service(session: AsyncSession = Depends(get_session)) -> BookService:
    return BookService(session)


@router.get("/search", response_model=BookSearchResponse)
async def search_books(
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float = Query(default=10.0, ge=0.1, le=200.0),
    category: str | None = Query(default=None),
    language: str | None = Query(default=None),
    condition: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    owner_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookSearchResponse:
    params = BookSearchParams(
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        category=category,
        language=language,
        condition=condition,
        q=q,
        owner_id=owner_id,
    )
    logger.info(
        "Nearby search: lat=%s, lng=%s, radius=%s km, user=%s",
        lat,
        lng,
        radius_km,
        user.id,
    )
    return await service.search_nearby(params, limit, current_user_id=user.id)


@router.get("/search-bbox", response_model=BookSearchResponse)
async def search_books_bbox(
    min_lat: float = Query(..., ge=-90, le=90),
    max_lat: float = Query(..., ge=-90, le=90),
    min_lng: float = Query(..., ge=-180, le=180),
    max_lng: float = Query(..., ge=-180, le=180),
    category: str | None = Query(default=None),
    language: str | None = Query(default=None),
    condition: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookSearchResponse:
    cache_key = bbox_cache_key(
        min_lat,
        max_lat,
        min_lng,
        max_lng,
        category,
        language,
        condition,
        q,
        limit,
    )
    cache_key = f"{cache_key}:u{user.id}"

    if not cursor and not q:
        cached = await get_cached(cache_key)
        if cached:
            return BookSearchResponse(**json.loads(cached))

    try:
        result = await service.search_bbox(
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            category,
            language,
            condition,
            q,
            limit,
            current_user_id=user.id,
            cursor=cursor,
        )
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    if not cursor and not q:
        await set_cached(cache_key, result.model_dump(), ttl_seconds=30)

    return result


@router.get("/clusters", response_model=ClusterResponse)
async def search_clusters(
    min_lat: float = Query(..., ge=-90, le=90),
    max_lat: float = Query(..., ge=-90, le=90),
    min_lng: float = Query(..., ge=-180, le=180),
    max_lng: float = Query(..., ge=-180, le=180),
    category: str | None = Query(default=None),
    language: str | None = Query(default=None),
    condition: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=500),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> ClusterResponse:
    try:
        return await service.search_clusters(
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            category,
            language,
            condition,
            q,
            limit,
            current_user_id=user.id,
        )
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("", response_model=BookListResponse)
async def list_books(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookListResponse:
    return await service.list_available_books(cursor, limit, current_user_id=user.id)


@router.post("", response_model=BookOwnerView, status_code=201)
async def create_book(
    body: BookCreateRequest,
    user: User = Depends(get_verified_user),
    service: BookService = Depends(_get_service),
) -> BookOwnerView:
    try:
        return await service.create_book(user.id, body)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/bulk", response_model=BookBulkCreateResponse, status_code=201)
async def bulk_create_books(
    body: BookBulkCreateRequest,
    user: User = Depends(get_verified_user),
    service: BookService = Depends(_get_service),
) -> BookBulkCreateResponse:
    try:
        return await service.bulk_create(user.id, body)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/me", response_model=BookListResponse)
async def list_my_books(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookListResponse:
    return await service.list_my_books(user.id, cursor, limit)


@router.get("/stale", response_model=StaleBooksResponse)
async def list_stale_books(
    days: int = Query(default=30, ge=1, le=365),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> StaleBooksResponse:
    """B19 — Smart relisting: books with no activity in `days` days."""
    items = await service.list_stale_books(user.id, days=days)
    return StaleBooksResponse(items=items, days_threshold=days)


@router.patch("/reorder", response_model=BookListResponse)
async def reorder_books(
    body: ReorderBody,
    service: BookService = Depends(_get_service),
    current_user: User = Depends(get_current_user),
) -> BookListResponse:
    try:
        items = await service.reorder_books(current_user.id, body.reorders)
        return BookListResponse(items=items, next_cursor=None)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{book_id}", response_model=BookOwnerView | BookPublicView)
async def get_book(
    book_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookOwnerView | BookPublicView:
    try:
        return await service.get_book(book_id, user.id)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.patch("/{book_id}", response_model=BookOwnerView)
async def update_book(
    book_id: uuid.UUID,
    body: BookUpdateRequest,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookOwnerView:
    try:
        return await service.update_book(book_id, user.id, body)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.delete("/{book_id}", status_code=204)
async def delete_book(
    book_id: uuid.UUID,
    force: bool = Query(False, description="Cancel active exchanges and force delete"),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> Response:
    try:
        await service.delete_book(book_id, user.id, force=force)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return Response(status_code=204)


@router.post("/{book_id}/photos", response_model=PhotoView, status_code=201)
async def upload_photo(
    book_id: uuid.UUID,
    file: UploadFile = File(...),
    thumbnail: UploadFile | None = File(None),
    user: User = Depends(get_verified_user),
    service: BookService = Depends(_get_service),
) -> PhotoView:
    logger.info(
        "Uploading photo for book %s by user %s (type=%s, size=%s, thumb=%s)",
        book_id,
        user.id,
        file.content_type,
        file.size,
        bool(thumbnail),
    )
    contents = await file.read()
    thumb_contents = await thumbnail.read() if thumbnail else None
    try:
        result = await service.upload_photo(
            book_id, user.id, contents, file.content_type or "image/jpeg", thumb_contents
        )
        logger.info("Photo uploaded successfully: %s -> %s", book_id, result.url)
        return result
    except BookError as e:
        logger.warning(
            "Photo upload failed for book %s: %s (status=%s)", book_id, e.message, e.status_code
        )
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.delete("/{book_id}/photos/{photo_id}", status_code=204)
async def delete_photo(
    book_id: uuid.UUID,
    photo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> Response:
    try:
        await service.delete_book_photo(book_id, photo_id, user.id)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return Response(status_code=204)


@router.patch("/{book_id}/photos/{photo_id}/thumbnail", response_model=PhotoView)
async def upload_thumbnail(
    book_id: uuid.UUID,
    photo_id: uuid.UUID,
    file: UploadFile,
    user: User = Depends(get_verified_user),
    service: BookService = Depends(_get_service),
) -> PhotoView:
    """Backfill thumbnail for an existing photo (client-side resized)."""
    contents = await file.read()
    try:
        return await service.upload_photo_thumbnail(book_id, photo_id, user.id, contents)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.patch("/{book_id}/photos/reorder", response_model=list[PhotoView])
async def reorder_photos(
    book_id: uuid.UUID,
    body: PhotoReorderRequest,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> list[PhotoView]:
    try:
        return await service.reorder_photos(book_id, body.photo_ids, user.id)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/{book_id}/view", status_code=204)
async def increment_book_view(
    book_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> Response:
    try:
        await service.increment_view(book_id, user.id)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return Response(status_code=204)


@router.post("/{book_id}/relist", response_model=BookOwnerView)
async def relist_book(
    book_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookOwnerView:
    """B19 — Refresh a dormant book's listing (bumps updated_at)."""
    try:
        return await service.relist_book(book_id, user.id)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/{book_id}/favorite", status_code=204)
async def add_book_favorite(
    book_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> Response:
    try:
        await service.add_favorite(book_id, user.id)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return Response(status_code=204)


@router.delete("/{book_id}/favorite", status_code=204)
async def remove_book_favorite(
    book_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> Response:
    try:
        await service.remove_favorite(book_id, user.id)
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return Response(status_code=204)


@router.get("/isbn/{isbn_code}", response_model=ISBNLookupResponse)
async def lookup_isbn(
    isbn_code: str,
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> ISBNLookupResponse:
    logger.info("ISBN lookup requested: %s by user %s", isbn_code, user.id)
    try:
        result = await service.lookup_isbn(isbn_code)
        logger.info("ISBN lookup result: %s -> title=%s", isbn_code, result.title)
        return result
    except BookError as e:
        logger.warning("ISBN lookup failed: %s -> %s", isbn_code, e.message)
        raise HTTPException(status_code=e.status_code, detail=e.message)

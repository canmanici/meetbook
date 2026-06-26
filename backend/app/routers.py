"""Router registration — single place for all module routers."""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from app.modules.auth.router import router as auth_router
    from app.modules.books.router import router as books_router
    from app.modules.wishlist.router import router as wishlist_router
    from app.modules.exchanges.router import router as exchanges_router
    from app.modules.places.router import router as places_router
    from app.modules.ratings.router import router as ratings_router
    from app.modules.reports.router import router as reports_router
    from app.modules.notifications.router import router as notifications_router
    from app.modules.geofence.router import router as geofence_router
    from app.modules.chat.router import router as chat_exchange_router
    from app.modules.chat.router import chat_router
    from app.modules.chat.router import ws_router
    from app.modules.admin.router import router as admin_router
    from app.modules.crash_reports.router import crash_router
    from app.modules.push_tokens.router import router as push_token_router
    from app.modules.saved_searches.router import router as saved_searches_router

    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(books_router, prefix="/api/v1")
    app.include_router(wishlist_router, prefix="/api/v1")
    app.include_router(exchanges_router, prefix="/api/v1")
    app.include_router(places_router, prefix="/api/v1")
    app.include_router(ratings_router, prefix="/api/v1")
    app.include_router(reports_router, prefix="/api/v1")
    app.include_router(notifications_router, prefix="/api/v1")
    app.include_router(geofence_router, prefix="/api/v1")
    app.include_router(chat_exchange_router, prefix="/api/v1")
    app.include_router(chat_router, prefix="/api/v1")
    app.include_router(ws_router)  # WebSocket at /ws/chat (outside /api/v1)
    app.include_router(admin_router, prefix="/api/v1")
    app.include_router(crash_router, prefix="/api/v1")
    app.include_router(push_token_router, prefix="/api/v1")
    app.include_router(saved_searches_router, prefix="/api/v1")

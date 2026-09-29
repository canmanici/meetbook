"""Router registration — single place for all module routers."""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from app.modules.admin.chat_admin import router as chat_admin_router
    from app.modules.admin.kvkk_admin import router as kvkk_admin_router
    from app.modules.admin.metrics_calls import router as metrics_calls_router
    from app.modules.admin.metrics_content import router as metrics_content_router
    from app.modules.admin.metrics_exchanges_deep import router as metrics_exchanges_deep_router
    from app.modules.admin.metrics_messages import router as metrics_messages_router
    from app.modules.admin.router import router as admin_router
    from app.modules.admin.client_intel import router as client_intel_router
    from app.modules.admin.user_activity import router as user_activity_router
    from app.modules.admin.loadtest import router as loadtest_router
    from app.modules.app_updates.router import admin_router as app_release_admin_router
    from app.modules.app_updates.router import public_router as app_updates_router
    from app.modules.auth.router import router as auth_router
    from app.modules.books.router import router as books_router
    from app.modules.chat.router import chat_router, ws_router
    from app.modules.chat.router import router as chat_exchange_router
    from app.modules.clubs.router import router as clubs_router
    from app.modules.crash_reports.router import crash_router
    from app.modules.exchanges.router import router as exchanges_router
    from app.modules.geofence.router import router as geofence_router
    from app.modules.legal.router import privacy_router
    from app.modules.legal.router import router as legal_router
    from app.modules.notifications.router import router as notifications_router
    from app.modules.places.router import router as places_router
    from app.modules.push_tokens.router import router as push_token_router
    from app.modules.ratings.router import router as ratings_router
    from app.modules.reports.router import router as reports_router
    from app.modules.saved_searches.router import router as saved_searches_router
    from app.modules.wishlist.router import router as wishlist_router

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
    app.include_router(chat_admin_router, prefix="/api/v1")
    app.include_router(metrics_calls_router, prefix="/api/v1")
    app.include_router(metrics_messages_router, prefix="/api/v1")
    app.include_router(metrics_exchanges_deep_router, prefix="/api/v1")
    app.include_router(metrics_content_router, prefix="/api/v1")
    app.include_router(user_activity_router, prefix="/api/v1")
    app.include_router(loadtest_router, prefix="/api/v1")
    app.include_router(client_intel_router, prefix="/api/v1")
    app.include_router(push_token_router, prefix="/api/v1")
    app.include_router(saved_searches_router, prefix="/api/v1")
    app.include_router(clubs_router, prefix="/api/v1")
    app.include_router(app_updates_router, prefix="/api/v1")
    app.include_router(app_release_admin_router, prefix="/api/v1")
    app.include_router(kvkk_admin_router, prefix="/api/v1")
    # Legal pages + API — served at /legal/* (documents + consent endpoints)
    app.include_router(legal_router)
    # In-app privacy actions (Settings → Verilerimin silinmesini iste)
    app.include_router(privacy_router, prefix="/api/v1")

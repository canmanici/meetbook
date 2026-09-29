"""FastAPI lifespan: startup/shutdown hooks."""

import asyncio
import gc
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.http import close_http_client
from app.core.s3 import close_s3_client, get_s3_client

# Crash reports initialized via lifespan (no external SDK needed)

logger = logging.getLogger("app.lifespan")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    # Create MinIO bucket on startup if S3 is configured
    if settings.s3_bucket and settings.s3_access_key:
        try:
            async with get_s3_client() as client:
                await client.head_bucket(Bucket=settings.s3_bucket)
        except Exception:
            try:
                async with get_s3_client() as client:
                    await client.create_bucket(Bucket=settings.s3_bucket)
                    logger.info("Created S3 bucket: %s", settings.s3_bucket)
            except Exception:
                pass  # Bucket may already exist or MinIO not ready yet

        # Make bucket publicly readable (required for mobile app to fetch photos directly)
        try:
            async with get_s3_client() as client:
                await client.put_bucket_policy(
                    Bucket=settings.s3_bucket,
                    Policy=json.dumps(
                        {
                            "Version": "2012-10-17",
                            "Statement": [
                                {
                                    "Effect": "Allow",
                                    "Principal": "*",
                                    "Action": ["s3:GetObject"],
                                    "Resource": f"arn:aws:s3:::{settings.s3_bucket}/*",
                                }
                            ],
                        }
                    ),
                )
                logger.info("Bucket policy set to public-read: %s", settings.s3_bucket)
        except Exception as exc:
            logger.warning("Could not set bucket public-read policy (may already be set): %s", exc)

    # Start Redis pub/sub listener for real-time chat (horizontal scaling).
    # Listens on ``chat:*`` channels and forwards to local WebSocket connections.
    chat_listener_task = None
    if settings.env != "test":
        from app.modules.chat.service import subscribe_and_listen

        chat_listener_task = asyncio.create_task(subscribe_and_listen())

    # Hourly worker: expire overdue exchange requests. Skipped in tests, where
    # create_app() runs once per test and a real scheduler would never stop.
    scheduler = None
    if settings.env != "test":
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        from app.workers.expire_requests import expire_requests
        from app.workers.geofence_matcher import run_geofence_matcher
        from app.workers.loan_reminders import run_loan_reminders
        from app.workers.reveal_ratings import reveal_overdue_ratings

        async def _run_expire_requests() -> None:
            async with get_session_factory()() as session:
                await expire_requests(session)

        async def _run_reveal_ratings() -> None:
            async with get_session_factory()() as session:
                await reveal_overdue_ratings(session)

        async def _run_loan_reminders() -> None:
            async with get_session_factory()() as session:
                await run_loan_reminders(session)

        async def _run_geofence_matcher() -> None:
            async with get_session_factory()() as session:
                await run_geofence_matcher(session)

        scheduler = AsyncIOScheduler()
        scheduler.add_job(_run_expire_requests, "interval", hours=1)
        scheduler.add_job(_run_reveal_ratings, "interval", hours=1)
        scheduler.add_job(_run_loan_reminders, "interval", hours=1)
        scheduler.add_job(_run_geofence_matcher, "interval", minutes=15)
        scheduler.start()

    if settings.env != "test":
        from app.modules.admin import loadtest

        # The load test pauses background jobs while it runs, and cleans up
        # after itself if a restart interrupted it.
        loadtest.set_scheduler(scheduler)
        asyncio.create_task(loadtest.recover_after_restart())

    # Everything imported so far (modules, routes, pydantic schemas) lives
    # for the whole process. Freeze it out of the cyclic GC so collections
    # stop re-scanning it, and collect gen0 less often: request garbage is
    # mostly freed by refcounting, not the cycle collector.
    gc.collect()
    gc.freeze()
    gc.set_threshold(50_000, 20, 20)

    yield

    if scheduler is not None:
        scheduler.shutdown()
    if chat_listener_task is not None:
        chat_listener_task.cancel()
        try:
            await chat_listener_task
        except asyncio.CancelledError:
            pass
    # Shared outbound clients (connection pools) — close them cleanly.
    await close_s3_client()
    await close_http_client()

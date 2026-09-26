import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.books.models import Book
from app.modules.exchanges.models import Chat, ExchangeRequest


@pytest.mark.asyncio
async def test_complete_flow_side_effects(
    client: httpx.AsyncClient, register_user, create_book, db_session: AsyncSession
) -> None:
    owner = await register_user("flow_owner@example.com", "Owner")
    requester = await register_user("flow_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    create_resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    exchange_id = create_resp.json()["id"]

    accept_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"]
    )
    assert accept_resp.status_code == 200

    chat = await db_session.execute(
        select(Chat).where(Chat.exchange_request_id == uuid.UUID(exchange_id))
    )
    assert chat.scalar_one_or_none() is not None

    complete_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/complete", headers=owner["headers"]
    )
    assert complete_resp.status_code == 200
    assert complete_resp.json()["status"] == "completion_pending"

    confirm_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/confirm-completion", headers=requester["headers"]
    )
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["status"] == "completed"

    book = await db_session.execute(select(Book).where(Book.id == uuid.UUID(book_id)))
    assert book.scalar_one().is_available is False

    owner_row = await db_session.execute(select(User).where(User.id == uuid.UUID(owner["user_id"])))
    requester_row = await db_session.execute(
        select(User).where(User.id == uuid.UUID(requester["user_id"]))
    )
    assert owner_row.scalar_one().completed_exchanges == 1
    assert requester_row.scalar_one().completed_exchanges == 1

    exchange_row = await db_session.execute(
        select(ExchangeRequest).where(ExchangeRequest.id == uuid.UUID(exchange_id))
    )
    exchange = exchange_row.scalar_one()
    assert exchange.status.value == "completed"
    assert str(exchange.completion_marked_by) == owner["user_id"]

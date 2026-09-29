"""Book credits: starter credit via .edu.tr, debt limit, trade settlement,
loan deposits (hold / release / forfeit) and the borrow ban."""

import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.auth.models import User
from app.modules.credits.models import CreditKind, CreditTransaction
from tests.exchanges.conftest import KADIKOY_CAFE

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def enforce_credits() -> Iterator[None]:
    settings = get_settings()
    previous = settings.credits_enforced
    settings.credits_enforced = True
    yield
    settings.credits_enforced = previous


@pytest.fixture
def sent_codes(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Capture mailed codes: {recipient: code}."""
    codes: dict[str, str] = {}

    async def fake_send_mail(to: str, subject: str, text: str, html: str | None = None) -> bool:
        codes[to] = subject.rsplit(" ", 1)[-1]
        return True

    monkeypatch.setattr("app.modules.auth.service.send_mail", fake_send_mail)
    return codes


async def _verify_edu(
    client: httpx.AsyncClient, user: dict[str, Any], edu_email: str, codes: dict[str, str]
) -> None:
    resp = await client.post(
        "/api/v1/auth/edu-email", json={"edu_email": edu_email}, headers=user["headers"]
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post(
        "/api/v1/auth/edu-email/verify",
        json={"code": codes[edu_email.lower()]},
        headers=user["headers"],
    )
    assert resp.status_code == 200, resp.text


async def _wallet(client: httpx.AsyncClient, user: dict[str, Any]) -> dict[str, Any]:
    resp = await client.get("/api/v1/credits/me", headers=user["headers"])
    assert resp.status_code == 200
    return resp.json()


async def _request(
    client: httpx.AsyncClient, user: dict[str, Any], book_id: str, **extra: Any
) -> httpx.Response:
    return await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Merhaba", **extra},
        headers=user["headers"],
    )


async def _set_balance(db: AsyncSession, user: dict[str, Any], balance: int) -> None:
    await db.execute(
        update(User).where(User.id == uuid.UUID(user["user_id"])).values(credit_balance=balance)
    )
    await db.commit()


async def _complete_trade(
    client: httpx.AsyncClient, owner: dict[str, Any], requester: dict[str, Any], exchange_id: str
) -> None:
    for path, who in (
        ("accept", owner),
        ("complete", owner),
        ("confirm-completion", requester),
    ):
        resp = await client.post(f"/api/v1/exchanges/{exchange_id}/{path}", headers=who["headers"])
        assert resp.status_code == 200, (path, resp.text)


async def _start_loan(
    client: httpx.AsyncClient, owner: dict[str, Any], borrower: dict[str, Any], book_id: str
) -> str:
    resp = await _request(client, borrower, book_id, mode="borrow", loan_duration_days=14)
    assert resp.status_code == 201, resp.text
    exchange_id = resp.json()["id"]
    assert (
        await client.post(f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"])
    ).status_code == 200
    offer = {
        "place_name": "Kadikoy Cafe",
        "category": "cafe",
        **KADIKOY_CAFE,
        "scheduled_at": "2030-01-01T12:00:00Z",
    }
    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={"offers": [offer]},
        headers=borrower["headers"],
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup/accept", json={}, headers=owner["headers"]
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/lend",
        json={"photo_url": "https://example.com/lent.jpg"},
        headers=owner["headers"],
    )
    assert resp.status_code == 200, resp.text
    return exchange_id


# -- University verification + starter credit --------------------------------


async def test_edu_verification_grants_one_starter_credit_and_debt_room(
    client: httpx.AsyncClient, register_user, sent_codes
) -> None:
    student = await register_user("student@gmail.com", "Student")
    assert (await _wallet(client, student))["floor"] == 0

    await _verify_edu(client, student, "Ogrenci@Itu.Edu.Tr", sent_codes)

    wallet = await _wallet(client, student)
    assert wallet["balance"] == 1
    assert wallet["floor"] == -2
    assert wallet["edu_verified"] is True
    assert [t["kind"] for t in wallet["transactions"]] == ["starter"]

    me = (await client.get("/api/v1/auth/me", headers=student["headers"])).json()
    assert me["edu_verified"] is True
    assert me["edu_email"] == "ogrenci@itu.edu.tr"
    assert me["credit_balance"] == 1

    # Verifying again can't mint a second starter credit.
    resp = await client.post(
        "/api/v1/auth/edu-email", json={"edu_email": "x@itu.edu.tr"}, headers=student["headers"]
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "EDU_ALREADY_VERIFIED"


async def test_non_university_address_is_rejected(
    client: httpx.AsyncClient, register_user, sent_codes
) -> None:
    user = await register_user("someone@gmail.com", "Someone")
    for address in ("a@gmail.com", "a@edu.tr", "a@fake-edu.tr.com"):
        resp = await client.post(
            "/api/v1/auth/edu-email", json={"edu_email": address}, headers=user["headers"]
        )
        assert resp.status_code == 422, address
        assert resp.json()["detail"] == "NOT_EDU_EMAIL"


async def test_one_university_address_per_account(
    client: httpx.AsyncClient, register_user, sent_codes
) -> None:
    first = await register_user("first@gmail.com", "First")
    second = await register_user("second@gmail.com", "Second")
    await _verify_edu(client, first, "shared@boun.edu.tr", sent_codes)

    resp = await client.post(
        "/api/v1/auth/edu-email",
        json={"edu_email": "SHARED@boun.edu.tr"},
        headers=second["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "EDU_EMAIL_TAKEN"


async def test_wrong_code_does_not_verify(
    client: httpx.AsyncClient, register_user, sent_codes
) -> None:
    user = await register_user("wrong@gmail.com", "Wrong")
    await client.post(
        "/api/v1/auth/edu-email", json={"edu_email": "w@metu.edu.tr"}, headers=user["headers"]
    )
    wrong = "000000" if sent_codes["w@metu.edu.tr"] != "000000" else "111111"
    resp = await client.post(
        "/api/v1/auth/edu-email/verify", json={"code": wrong}, headers=user["headers"]
    )
    assert resp.status_code == 400
    assert (await _wallet(client, user))["balance"] == 0


# -- Taking books: balance, debt, settlement ---------------------------------


async def test_unverified_user_with_no_credits_cannot_take_a_book(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("o1@gmail.com", "Owner")
    taker = await register_user("t1@gmail.com", "Taker")
    book_id = await create_book(owner["headers"])

    resp = await _request(client, taker, book_id)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "INSUFFICIENT_CREDITS"


async def test_completed_trade_moves_one_credit_from_taker_to_giver(
    client: httpx.AsyncClient, register_user, create_book, sent_codes, db_session: AsyncSession
) -> None:
    owner = await register_user("o2@gmail.com", "Owner")
    taker = await register_user("t2@gmail.com", "Taker")
    await _verify_edu(client, taker, "t2@ege.edu.tr", sent_codes)
    book_id = await create_book(owner["headers"])

    exchange_id = (await _request(client, taker, book_id)).json()["id"]
    # Promised but not spent yet.
    wallet = await _wallet(client, taker)
    assert (wallet["balance"], wallet["reserved"], wallet["available"]) == (1, 1, 0)

    await _complete_trade(client, owner, taker, exchange_id)

    assert (await _wallet(client, taker))["balance"] == 0
    owner_wallet = await _wallet(client, owner)
    assert owner_wallet["balance"] == 1
    assert owner_wallet["transactions"][0]["kind"] == "trade_given"
    assert owner_wallet["transactions"][0]["exchange_id"] == exchange_id

    rows = (
        (
            await db_session.execute(
                select(CreditTransaction).where(
                    CreditTransaction.exchange_id == uuid.UUID(exchange_id)
                )
            )
        )
        .scalars()
        .all()
    )
    assert sorted((r.kind, r.amount) for r in rows) == [
        (CreditKind.trade_given, 1),
        (CreditKind.trade_received, -1),
    ]


async def test_student_can_go_into_debt_down_to_the_limit_and_no_further(
    client: httpx.AsyncClient, register_user, create_book, sent_codes
) -> None:
    owner = await register_user("o3@gmail.com", "Owner")
    student = await register_user("s3@gmail.com", "Student")
    await _verify_edu(client, student, "s3@hacettepe.edu.tr", sent_codes)

    # Spend the starter credit (also lifts the new-account request cap).
    first = await create_book(owner["headers"])
    await _complete_trade(
        client, owner, student, (await _request(client, student, first)).json()["id"]
    )
    assert (await _wallet(client, student))["balance"] == 0

    # Two more books on credit: 0 → -2.
    for _ in range(2):
        book_id = await create_book(owner["headers"])
        assert (await _request(client, student, book_id)).status_code == 201
    assert (await _wallet(client, student))["available"] == -2

    book_id = await create_book(owner["headers"])
    resp = await _request(client, student, book_id)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "INSUFFICIENT_CREDITS"


async def test_cancelling_a_request_frees_the_reserved_credit(
    client: httpx.AsyncClient, register_user, create_book, sent_codes
) -> None:
    owner = await register_user("o4@gmail.com", "Owner")
    student = await register_user("s4@gmail.com", "Student")
    await _verify_edu(client, student, "s4@ankara.edu.tr", sent_codes)
    exchange_id = (await _request(client, student, await create_book(owner["headers"]))).json()[
        "id"
    ]
    assert (await _wallet(client, student))["reserved"] == 1

    resp = await client.post(f"/api/v1/exchanges/{exchange_id}/cancel", headers=student["headers"])
    assert resp.status_code == 200
    wallet = await _wallet(client, student)
    assert (wallet["balance"], wallet["reserved"]) == (1, 0)


# -- Borrowing: deposit hold / release / forfeit -----------------------------


async def test_borrowing_needs_a_deposit_that_debt_cannot_pay(
    client: httpx.AsyncClient, register_user, create_book, sent_codes
) -> None:
    owner = await register_user("o5@gmail.com", "Owner")
    student = await register_user("s5@gmail.com", "Student")
    await _verify_edu(client, student, "s5@itu.edu.tr", sent_codes)  # balance 1, floor -2

    resp = await _request(
        client, student, await create_book(owner["headers"]), mode="borrow", loan_duration_days=14
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "INSUFFICIENT_CREDITS_FOR_DEPOSIT"


async def test_returned_loan_gives_the_deposit_back(
    client: httpx.AsyncClient,
    register_user,
    create_book,
    seed_turkey_boundary,
    db_session: AsyncSession,
) -> None:
    owner = await register_user("o6@gmail.com", "Owner")
    borrower = await register_user("b6@gmail.com", "Borrower")
    await _set_balance(db_session, borrower, 2)
    exchange_id = await _start_loan(client, owner, borrower, await create_book(owner["headers"]))

    wallet = await _wallet(client, borrower)
    assert wallet["balance"] == 0
    assert wallet["transactions"][0]["kind"] == "loan_deposit_hold"

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/return",
        json={"photo_url": "https://example.com/back.jpg"},
        headers=borrower["headers"],
    )
    assert resp.status_code == 200
    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/confirm-return", headers=owner["headers"]
    )
    assert resp.status_code == 200

    assert (await _wallet(client, borrower))["balance"] == 2
    assert (await _wallet(client, owner))["balance"] == 0


async def test_unreturned_loan_pays_the_owner_and_bans_the_borrower(
    client: httpx.AsyncClient,
    register_user,
    create_book,
    seed_turkey_boundary,
    db_session: AsyncSession,
) -> None:
    owner = await register_user("o7@gmail.com", "Owner")
    thief = await register_user("b7@gmail.com", "Borrower")
    await _set_balance(db_session, thief, 2)
    exchange_id = await _start_loan(client, owner, thief, await create_book(owner["headers"]))

    # Owner writes the book off.
    resp = await client.post(f"/api/v1/exchanges/{exchange_id}/cancel", headers=owner["headers"])
    assert resp.status_code == 200

    owner_wallet = await _wallet(client, owner)
    assert owner_wallet["balance"] == 2
    assert owner_wallet["transactions"][0]["kind"] == "loan_deposit_award"
    thief_wallet = await _wallet(client, thief)
    assert thief_wallet["balance"] == 0
    assert thief_wallet["borrow_banned"] is True

    # Even with credits again, never another loan.
    await _set_balance(db_session, thief, 10)
    resp = await _request(
        client, thief, await create_book(owner["headers"]), mode="borrow", loan_duration_days=7
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "BORROW_BANNED"


async def test_owner_deleting_a_lent_book_refunds_the_borrower(
    client: httpx.AsyncClient,
    register_user,
    create_book,
    seed_turkey_boundary,
    db_session: AsyncSession,
) -> None:
    owner = await register_user("o8@gmail.com", "Owner")
    borrower = await register_user("b8@gmail.com", "Borrower")
    await _set_balance(db_session, borrower, 2)
    book_id = await create_book(owner["headers"])
    await _start_loan(client, owner, borrower, book_id)

    resp = await client.delete(f"/api/v1/books/{book_id}?force=true", headers=owner["headers"])
    assert resp.status_code in (200, 204), resp.text

    wallet = await _wallet(client, borrower)
    assert wallet["balance"] == 2
    assert wallet["borrow_banned"] is False

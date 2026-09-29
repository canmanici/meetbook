"""Book-credit wallet endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.credits.schemas import CreditTransactionView, WalletResponse
from app.modules.credits.service import LOAN_DEPOSIT, TRADE_COST, CreditService

router = APIRouter(prefix="/credits", tags=["credits"])


@router.get("/me", response_model=WalletResponse)
async def my_wallet(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WalletResponse:
    service = CreditService(session)
    wallet = await service.wallet(user)
    history = await service.history(user.id)
    return WalletResponse(
        balance=wallet.balance,
        reserved=wallet.reserved,
        available=wallet.available,
        floor=wallet.floor,
        trade_cost=TRADE_COST,
        loan_deposit=LOAN_DEPOSIT,
        can_borrow=wallet.can_borrow,
        borrow_banned=wallet.borrow_banned,
        edu_verified=user.edu_verified_at is not None,
        transactions=[
            CreditTransactionView(
                id=t.id,
                amount=t.amount,
                kind=t.kind,
                exchange_id=t.exchange_id,
                balance_after=t.balance_after,
                created_at=t.created_at,
            )
            for t in history
        ],
    )

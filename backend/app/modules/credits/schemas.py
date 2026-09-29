import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.credits.models import CreditKind


class CreditTransactionView(BaseModel):
    id: uuid.UUID
    amount: int
    kind: CreditKind
    exchange_id: uuid.UUID | None
    balance_after: int
    created_at: datetime


class WalletResponse(BaseModel):
    balance: int
    reserved: int  # credits promised to open trade requests
    available: int  # balance - reserved
    floor: int  # lowest balance allowed (negative = debt allowed)
    trade_cost: int
    loan_deposit: int
    can_borrow: bool
    borrow_banned: bool
    edu_verified: bool
    transactions: list[CreditTransactionView]

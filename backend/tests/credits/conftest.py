"""Reuse the exchanges suite's user/book/boundary fixtures."""

from tests.exchanges.conftest import (  # noqa: F401
    create_book,
    register_user,
    seed_turkey_boundary,
)

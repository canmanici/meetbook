import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy import pool

from app.core.config import get_settings
from app.core.db import Base

# Import every module's models so autogenerate sees them (grows with phases):
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.books import models as books_models  # noqa: F401
from app.modules.exchanges import models as exchanges_models  # noqa: F401
from app.modules.wishlist import models as wishlist_models  # noqa: F401
from app.modules.chat import models as chat_models  # noqa: F401
from app.modules.ratings import models as ratings_models  # noqa: F401
from app.modules.reports import models as reports_models  # noqa: F401
from app.modules.notifications import models as notifications_models  # noqa: F401
from app.modules.geofence import models as geofence_models  # noqa: F401
from app.modules.crash_reports import models as crash_reports_models  # noqa: F401
from app.modules.push_tokens import models as push_tokens_models  # noqa: F401
from app.modules.saved_searches import models as saved_searches_models  # noqa: F401
from app.modules.clubs import models as clubs_models  # noqa: F401
from app.modules.app_updates import models as app_updates_models  # noqa: F401
from app.modules.legal import models as legal_models  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def include_object(obj, name: str, type_: str, reflected: bool, compare_to) -> bool:
    """Exclude PostGIS TIGER/extension tables from autogenerate detection.

    These tables are managed by the PostGIS extension, not by our app.
    Without this filter, alembic autogenerate would try to drop them.
    """
    if type_ == "table" and reflected and name not in target_metadata.tables:
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:  # type: ignore[no-untyped-def]
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())

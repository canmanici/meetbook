#!/usr/bin/env python3
"""Pre-commit guard: fail if the Alembic migration graph has diverged.

Reads only the .py files under alembic/versions/ (no DB connection needed),
so it works offline and in pre-commit's isolated env.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from alembic.config import Config
from alembic.script import ScriptDirectory


def main() -> int:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    if len(heads) > 1:
        print(f"ERROR: Alembic migration graph has {len(heads)} heads: {heads}")
        print("Two migrations were branched off the same down_revision.")
        print(
            "Fix with: backend/scripts/new_migration.sh (creates migrations "
            "against the live DB head) or `alembic merge heads` to reconcile."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

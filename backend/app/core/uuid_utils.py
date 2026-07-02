"""UUID v7 generation — time-ordered, B-tree-friendly primary keys.

Python 3.14 ships ``uuid.uuid7()`` (PEP 756).  We re-export it here so
that swapping the algorithm in the future means editing one file.
"""

import uuid

# Re-export uuid7 as the canonical ID factory.
# uuid7() returns a UUID object — time-ordered ≈ milliseconds + random bits.
new_uuid = uuid.uuid7
new_uuid_str = lambda: str(uuid.uuid7())

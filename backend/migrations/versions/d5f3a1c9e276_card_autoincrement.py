"""card ids are never reused (AUTOINCREMENT)

An interview answer keeps the ids of the cards it was built from. Without AUTOINCREMENT SQLite
gives a new card the id of a deleted highest-id card, so an answer whose source was deleted
would silently point at the new, unrelated card instead of showing "source removed".

Revision ID: d5f3a1c9e276
Revises: c7a2f9e5b814
Create Date: 2026-10-28 18:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5f3a1c9e276'
down_revision: Union[str, Sequence[str], None] = 'c7a2f9e5b814'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _highest_cited(bind) -> int:
    top = 0
    for (raw,) in bind.execute(sa.text("SELECT source_card_ids FROM interviewanswer")):
        try:
            ids = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            continue
        for i in ids if isinstance(ids, list) else []:
            if isinstance(i, int) and not isinstance(i, bool):
                top = max(top, i)
    return top


def upgrade() -> None:
    """Upgrade schema."""
    # Rebuild the card table with AUTOINCREMENT (SQLite cannot add it in place). The copy keeps
    # every row, the job foreign key (ON DELETE CASCADE) and the kind index.
    with op.batch_alter_table('card', recreate='always',
                              table_kwargs={'sqlite_autoincrement': True}):
        pass
    # Start new ids above every id used so far that we can still see: live cards and ids
    # answers cite (cards deleted before this upgrade).
    bind = op.get_bind()
    top = max(bind.execute(sa.text("SELECT COALESCE(MAX(id), 0) FROM card")).scalar() or 0,
              _highest_cited(bind))
    bind.execute(sa.text("DELETE FROM sqlite_sequence WHERE name = 'card'"))
    if top:
        bind.execute(sa.text("INSERT INTO sqlite_sequence (name, seq) VALUES ('card', :t)"),
                     {"t": top})


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('card', recreate='always',
                              table_kwargs={'sqlite_autoincrement': False}):
        pass

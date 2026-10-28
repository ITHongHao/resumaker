"""job extra

Revision ID: b4e8d1a6c350
Revises: 9c1f3a7b2d40
Create Date: 2026-10-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4e8d1a6c350'
down_revision: Union[str, Sequence[str], None] = '9c1f3a7b2d40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job', sa.Column('extra', sa.JSON(), nullable=False, server_default='{}'))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('job') as batch:
        batch.drop_column('extra')

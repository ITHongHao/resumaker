"""custom provider base url

Revision ID: 9c1f3a7b2d40
Revises: 2356f88df77c
Create Date: 2026-10-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c1f3a7b2d40'
down_revision: Union[str, Sequence[str], None] = '2356f88df77c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('appsettings', sa.Column('base_url', sa.String(), nullable=False, server_default=''))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('appsettings') as batch:
        batch.drop_column('base_url')

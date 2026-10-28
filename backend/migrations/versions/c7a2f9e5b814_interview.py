"""interview questions and answers

Revision ID: c7a2f9e5b814
Revises: b4e8d1a6c350
Create Date: 2026-10-28 13:00:00.000000

"""
import json
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'c7a2f9e5b814'
down_revision: Union[str, Sequence[str], None] = 'b4e8d1a6c350'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'hiddenquestion',
        sa.Column('ref', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.PrimaryKeyConstraint('ref'),
    )
    op.create_table(
        'interviewquestion',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('text', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'interviewanswer',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question_ref', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('situation', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('task', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('action', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('result', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('source_card_ids', sa.JSON(), nullable=False),
        sa.Column('job_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.ForeignKeyConstraint(['job_id'], ['job.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_interviewanswer_question_ref'), 'interviewanswer',
                    ['question_ref'], unique=False)

    # Data step: each old behavioral card becomes a custom question with one answer.
    # The card rows stay.
    bind = op.get_bind()
    now = datetime.now(timezone.utc).isoformat()
    cards = bind.execute(sa.text(
        "SELECT id, job_id, title, description, details, tags FROM card"
        " WHERE kind = 'behavioral' ORDER BY id")).fetchall()
    for _id, job_id, title, description, details, tags in cards:
        action = description or ""
        if details:
            action += "\n\n" + details
        if isinstance(tags, str):
            tags = json.loads(tags or "[]")
        if tags:
            action += "\n\nTags: " + ", ".join(tags)
        res = bind.execute(
            sa.text("INSERT INTO interviewquestion (text, category) VALUES (:t, 'Mine')"),
            {"t": title})
        qid = res.lastrowid
        bind.execute(sa.text(
            "INSERT INTO interviewanswer (question_ref, situation, task, action, result,"
            " source_card_ids, job_id, created_at)"
            " VALUES (:ref, '', '', :action, '', '[]', :job_id, :now)"),
            {"ref": f"c:{qid}", "action": action, "job_id": job_id, "now": now})


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_interviewanswer_question_ref'), table_name='interviewanswer')
    op.drop_table('interviewanswer')
    op.drop_table('interviewquestion')
    op.drop_table('hiddenquestion')

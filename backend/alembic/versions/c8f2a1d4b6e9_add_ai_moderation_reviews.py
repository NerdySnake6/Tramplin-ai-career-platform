"""Add AI moderation review history.

Revision ID: c8f2a1d4b6e9
Revises: b7c4e2d1a9f0
Create Date: 2026-06-03 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8f2a1d4b6e9"
down_revision: Union[str, None] = "b7c4e2d1a9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создает таблицу истории AI-проверок модерации."""
    op.create_table(
        "ai_moderation_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("opportunity_id", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.Integer(), nullable=False),
        sa.Column("risk_level", sa.String(length=20), nullable=False),
        sa.Column("risk_sources", sa.Text(), nullable=False),
        sa.Column("rule_matches", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["opportunity_id"], ["opportunities.id"]),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_ai_moderation_reviews_opportunity_id"),
        "ai_moderation_reviews",
        ["opportunity_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ai_moderation_reviews_reviewer_id"),
        "ai_moderation_reviews",
        ["reviewer_id"],
        unique=False,
    )


def downgrade() -> None:
    """Удаляет таблицу истории AI-проверок модерации."""
    op.drop_index(op.f("ix_ai_moderation_reviews_reviewer_id"), table_name="ai_moderation_reviews")
    op.drop_index(op.f("ix_ai_moderation_reviews_opportunity_id"), table_name="ai_moderation_reviews")
    op.drop_table("ai_moderation_reviews")

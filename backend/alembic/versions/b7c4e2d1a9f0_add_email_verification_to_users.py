"""Add email verification fields to users

Revision ID: b7c4e2d1a9f0
Revises: a7a8aa0eae8f
Create Date: 2026-04-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7c4e2d1a9f0"
down_revision: Union[str, Sequence[str], None] = "a7a8aa0eae8f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_email_verified", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("email_verification_token_hash", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("email_verification_sent_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("email_verified_at", sa.DateTime(), nullable=True))

    op.execute("UPDATE users SET is_email_verified = TRUE WHERE is_email_verified IS NULL")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.alter_column("is_email_verified", existing_type=sa.Boolean(), nullable=False)
        batch_op.create_index(
            batch_op.f("ix_users_email_verification_token_hash"),
            ["email_verification_token_hash"],
            unique=True,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_users_email_verification_token_hash"))
        batch_op.drop_column("email_verified_at")
        batch_op.drop_column("email_verification_sent_at")
        batch_op.drop_column("email_verification_token_hash")
        batch_op.drop_column("is_email_verified")

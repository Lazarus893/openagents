# -*- coding: utf-8 -*-
"""Add artifacts table + events.artifact_id column.

Artifacts is the unified surface for products produced by agents/routines/
tasks/tools. Stored as a first-class table with optional inline content or
blob storage_key (reuses FileStore). Each chat message can reference an
artifact via events.artifact_id (1:1 primary) and metadata.artifact_ids
(N:1 when a single message emits multiple artifacts).

Revision ID: 024
Revises: 023
Create Date: 2026-06-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID


revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Artifacts table ---
    op.create_table(
        "artifacts",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "workspace_id",
            UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Core
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        # Content (one-of)
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), server_default=sa.text("0")),
        # Type-specific metadata
        sa.Column("metadata", JSONB, server_default="{}"),
        # Source back-reference
        sa.Column("source_kind", sa.Text(), nullable=True),
        sa.Column("source_id", sa.Text(), nullable=True),
        sa.Column("source_event_id", sa.Text(), nullable=True),
        sa.Column("source_channel", sa.Text(), nullable=True),
        # Collaboration / publishing
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("share_token", sa.Text(), nullable=True),
        sa.Column("pinned", sa.Boolean(), server_default=sa.text("FALSE")),
        sa.Column("tags", JSONB, server_default="[]"),
        sa.Column("status", sa.Text(), server_default="active"),
        # Versioning
        sa.Column("version", sa.Integer(), server_default=sa.text("1")),
        sa.Column("parent_id", sa.Text(), nullable=True),
    )
    op.create_unique_constraint("uq_artifacts_share_token", "artifacts", ["share_token"])
    op.create_index(
        "idx_artifacts_ws_kind_created",
        "artifacts",
        ["workspace_id", "kind", "created_at"],
    )
    op.create_index(
        "idx_artifacts_ws_status_created",
        "artifacts",
        ["workspace_id", "status", "created_at"],
    )
    op.create_index(
        "idx_artifacts_source",
        "artifacts",
        ["source_kind", "source_id"],
    )
    op.create_index(
        "idx_artifacts_source_event",
        "artifacts",
        ["source_event_id"],
    )
    op.create_index(
        "idx_artifacts_parent",
        "artifacts",
        ["parent_id"],
    )

    # --- Extend events table ---
    op.add_column("events", sa.Column("artifact_id", sa.Text(), nullable=True))
    op.create_index("idx_events_artifact_id", "events", ["artifact_id"])


def downgrade() -> None:
    op.drop_index("idx_events_artifact_id", "events")
    op.drop_column("events", "artifact_id")

    op.drop_index("idx_artifacts_parent", "artifacts")
    op.drop_index("idx_artifacts_source_event", "artifacts")
    op.drop_index("idx_artifacts_source", "artifacts")
    op.drop_index("idx_artifacts_ws_status_created", "artifacts")
    op.drop_index("idx_artifacts_ws_kind_created", "artifacts")
    op.drop_constraint("uq_artifacts_share_token", "artifacts", type_="unique")
    op.drop_table("artifacts")

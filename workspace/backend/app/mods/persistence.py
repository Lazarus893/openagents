# -*- coding: utf-8 -*-
"""
mod/persistence — save events to PostgreSQL + auto-extract artifacts.

Observe mod (priority 90). Stores every event that passes through the
pipeline into the events table. When the event is an agent chat message
containing one or more `<artifact>` tags, those become first-class
ArtifactRecord rows and the tags are stripped from the message body.

Expects context.extra to contain:
  - db: SQLAlchemy Session
  - workspace: Workspace ORM object (for network_id)
"""

import logging
import re
import uuid as _uuid_mod
from typing import List, Optional

from openagents.core.onm_events import Event
from openagents.core.onm_mods import ObserveMod, PipelineContext

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Artifact tag parsing
# ---------------------------------------------------------------------------
#
# Tag syntax (single message can carry multiple):
#   <artifact kind="markdown" title="Q1 Plan" id="optional-stable-slug"
#             [summary="..."] [language="python"]>
#   ...content...
#   </artifact>
#
# - kind / title:   required
# - id:             optional, but provides stable identity for version-bumping
# - summary:        optional preview blurb for cards
# - language:       optional (code only)
# Other attributes flow into ArtifactRecord.metadata.

ARTIFACT_RE = re.compile(
    r"<artifact\s+([^>]+?)>(.*?)</artifact>",
    re.DOTALL | re.IGNORECASE,
)
ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"')

ALLOWED_KINDS = {"markdown", "code", "html", "svg", "mermaid", "json", "image"}

_KIND_MIME = {
    "markdown": "text/markdown",
    "code": "text/plain",
    "html": "text/html",
    "svg": "image/svg+xml",
    "mermaid": "text/vnd.mermaid",
    "image": "image/png",
    "json": "application/json",
}


def _parse_attrs(attr_str: str) -> dict:
    return dict(ATTR_RE.findall(attr_str))


def _extract_artifacts(event: Event, db, workspace_id: str, event_record) -> List[str]:
    """Parse `<artifact>` tags out of the message content. Returns the list
    of created artifact ids. Strips the tags from event_record.payload.

    Idempotent: if an `id` matches an existing ArtifactRecord, a new version
    is created with parent_id pointing to the previous head.
    """
    from app.models import ArtifactRecord

    payload = event_record.payload or {}
    content = payload.get("content") or ""
    if not content or "<artifact" not in content.lower():
        return []

    matches = list(ARTIFACT_RE.finditer(content))
    if not matches:
        return []

    created_ids: List[str] = []
    for m in matches:
        attrs = _parse_attrs(m.group(1))
        kind = (attrs.get("kind") or "").lower()
        if kind not in ALLOWED_KINDS:
            logger.warning("Skipping artifact with unsupported kind=%s", kind)
            continue

        body = m.group(2).strip()
        if not body:
            continue

        title = (attrs.get("title") or f"Artifact ({kind})").strip()
        explicit_id = attrs.get("id")
        summary = attrs.get("summary")

        # Metadata = everything not in known attribute set
        known = {"kind", "title", "id", "summary"}
        metadata = {k: v for k, v in attrs.items() if k not in known}

        # Version-bump path: same explicit id already exists in workspace
        existing = None
        if explicit_id:
            from sqlalchemy import select
            existing = db.execute(
                select(ArtifactRecord).where(
                    ArtifactRecord.workspace_id == workspace_id,
                    ArtifactRecord.id == explicit_id,
                )
            ).scalar_one_or_none()

        if existing:
            # Walk the version chain: find the head (no descendant pointing to it)
            head = existing
            from sqlalchemy import select
            while True:
                child = db.execute(
                    select(ArtifactRecord).where(
                        ArtifactRecord.parent_id == head.id,
                    )
                ).scalar_one_or_none()
                if not child:
                    break
                head = child

            new_id = str(_uuid_mod.uuid4())
            new_artifact = ArtifactRecord(
                id=new_id,
                workspace_id=workspace_id,
                kind=kind,
                mime_type=_KIND_MIME.get(kind, "application/octet-stream"),
                title=title,
                summary=summary,
                content=body,
                size_bytes=len(body.encode("utf-8")),
                metadata_=metadata,
                source_kind="chat",
                source_id=None,
                source_event_id=event_record.id,
                source_channel=event.target,
                created_by=event.source,
                tags=[],
                status="active",
                version=(head.version or 1) + 1,
                parent_id=head.id,
            )
            db.add(new_artifact)
            created_ids.append(new_id)
        else:
            artifact = ArtifactRecord(
                id=explicit_id or str(_uuid_mod.uuid4()),
                workspace_id=workspace_id,
                kind=kind,
                mime_type=_KIND_MIME.get(kind, "application/octet-stream"),
                title=title,
                summary=summary,
                content=body,
                size_bytes=len(body.encode("utf-8")),
                metadata_=metadata,
                source_kind="chat",
                source_id=None,
                source_event_id=event_record.id,
                source_channel=event.target,
                created_by=event.source,
                tags=[],
                status="active",
                version=1,
                parent_id=None,
            )
            db.add(artifact)
            created_ids.append(artifact.id)

    if not created_ids:
        return []

    # Strip <artifact> tags from the displayed message body. The chat
    # surface will render an ArtifactCard pulled via metadata.artifact_ids.
    stripped = ARTIFACT_RE.sub("", content).strip()
    new_payload = dict(payload)
    new_payload["content"] = stripped
    event_record.payload = new_payload

    new_metadata = dict(event_record.metadata_ or {})
    new_metadata["artifact_ids"] = created_ids
    event_record.metadata_ = new_metadata
    event_record.artifact_id = created_ids[0]

    return created_ids


# ---------------------------------------------------------------------------
# Persistence mod
# ---------------------------------------------------------------------------

class PersistenceMod(ObserveMod):
    """Persist events to the events table."""
    name = "persistence"
    intercepts: List[str] = []   # Match all events
    priority = 90

    # Event types that are handled by their mods (e.g. heartbeats update
    # workspace_members.last_heartbeat) and don't need a permanent event record.
    _SKIP_PERSIST = frozenset({"network.ping"})

    async def process(self, event: Event, context: PipelineContext) -> Optional[Event]:
        if event.type in self._SKIP_PERSIST:
            return None

        from app.models import EventRecord

        db = context.extra.get("db")
        workspace = context.extra.get("workspace")
        if not db or not workspace:
            logger.warning("persistence: no db or workspace in context, skipping")
            return None

        record = EventRecord(
            id=event.id,
            network_id=workspace.id,
            type=event.type,
            source=event.source,
            target=event.target,
            payload=event.payload,
            metadata_=event.metadata,
            timestamp=event.timestamp,
            visibility=event.visibility if isinstance(event.visibility, str) else event.visibility,
        )
        db.add(record)
        db.flush()  # flush, don't commit — the router commits

        if event.type.startswith("workspace.message") and event.target.startswith("channel/"):
            # Extract any <artifact> tags from agent messages — they become
            # first-class ArtifactRecord rows and are stripped from the
            # displayed body. Safe for human messages too (idempotent).
            try:
                created = _extract_artifacts(event, db, str(workspace.id), record)
                if created:
                    db.flush()
                    logger.info("persistence: extracted %d artifact(s) from event %s", len(created), event.id)
            except Exception as exc:
                # Non-fatal: artifact extraction must never break message persistence.
                logger.warning("persistence: artifact extraction failed: %s", exc)

            from sqlalchemy import update
            from app.models import Channel

            channel_name = event.target[len("channel/"):]
            db.execute(
                update(Channel)
                .where(
                    Channel.workspace_id == workspace.id,
                    Channel.name == channel_name,
                )
                .values(last_event_at=event.timestamp)
            )
            db.flush()

        return None  # observe mods return value is ignored

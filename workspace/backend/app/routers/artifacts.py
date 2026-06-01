# -*- coding: utf-8 -*-
"""
Artifact endpoints — unified surface for products produced by agents/routines.

POST   /v1/artifacts                    Create artifact
GET    /v1/artifacts                    List artifacts (filter by kind / source / search)
GET    /v1/artifacts/{id}               Get artifact detail (incl. content)
PATCH  /v1/artifacts/{id}               Partial update (title/summary/tags/pinned/status)
DELETE /v1/artifacts/{id}               Soft delete (status=deleted)

Share + promote endpoints land in a later sprint.
"""

import logging
import re
import secrets
import uuid as _uuid_mod
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ArtifactRecord, KnowledgeEntry, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.storage import get_file_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Artifacts"])


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_KINDS = {"markdown", "code", "html", "svg", "mermaid", "image", "json", "pdf"}
ALLOWED_STATUS = {"active", "archived", "deleted"}

# kind → default mime type. Caller can override in the request.
_KIND_MIME = {
    "markdown": "text/markdown",
    "code": "text/plain",
    "html": "text/html",
    "svg": "image/svg+xml",
    "mermaid": "text/vnd.mermaid",
    "image": "image/png",
    "json": "application/json",
    "pdf": "application/pdf",
}


def _kind_to_mime(kind: str, override: Optional[str]) -> str:
    if override:
        return override
    return _KIND_MIME.get(kind, "application/octet-stream")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateArtifactRequest(BaseModel):
    network: str
    kind: str
    title: str
    content: Optional[str] = None
    storage_key: Optional[str] = None
    summary: Optional[str] = None
    mime_type: Optional[str] = None
    metadata: Optional[dict] = None
    tags: Optional[List[str]] = None

    # Source back-reference (any-of)
    source_kind: Optional[str] = None
    source_id: Optional[str] = None
    source_event_id: Optional[str] = None
    source_channel: Optional[str] = None

    # Caller identity (e.g. "human:user" / "openagents:agent-name")
    created_by: Optional[str] = None


class UpdateArtifactRequest(BaseModel):
    """Partial update — omitted fields stay unchanged. Use DELETE to soft-delete."""
    network: str
    title: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[dict] = None
    tags: Optional[List[str]] = None
    pinned: Optional[bool] = None
    status: Optional[str] = None  # 'active' | 'archived' (use DELETE for 'deleted')


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _serialize(a: ArtifactRecord, *, with_content: bool = False) -> dict:
    out = {
        "id": a.id,
        "workspace_id": a.workspace_id,
        "kind": a.kind,
        "mime_type": a.mime_type,
        "title": a.title,
        "summary": a.summary,
        "size_bytes": a.size_bytes,
        "metadata": a.metadata_ or {},
        "source_kind": a.source_kind,
        "source_id": a.source_id,
        "source_event_id": a.source_event_id,
        "source_channel": a.source_channel,
        "created_by": a.created_by,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        "share_token": a.share_token,
        "pinned": bool(a.pinned),
        "tags": a.tags or [],
        "status": a.status,
        "version": a.version,
        "parent_id": a.parent_id,
        "has_storage_key": bool(a.storage_key),
    }
    if with_content:
        out["content"] = a.content
    return out


# ---------------------------------------------------------------------------
# POST /v1/artifacts
# ---------------------------------------------------------------------------

@router.post("/artifacts")
async def create_artifact(
    body: CreateArtifactRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    kind = (body.kind or "").lower()
    if kind not in ALLOWED_KINDS:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"kind must be one of: {sorted(ALLOWED_KINDS)}",
        )

    if not body.title or not body.title.strip():
        return json_response(ResponseCode.BAD_REQUEST, "title is required")

    if body.content is None and not body.storage_key:
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Either `content` (text) or `storage_key` (binary blob) must be provided",
        )

    artifact_id = str(_uuid_mod.uuid4())
    size_bytes = len(body.content.encode("utf-8")) if body.content else 0

    artifact = ArtifactRecord(
        id=artifact_id,
        workspace_id=str(workspace.id),
        kind=kind,
        mime_type=_kind_to_mime(kind, body.mime_type),
        title=body.title.strip(),
        summary=body.summary,
        content=body.content,
        storage_key=body.storage_key,
        size_bytes=size_bytes,
        metadata_=body.metadata or {},
        source_kind=body.source_kind,
        source_id=body.source_id,
        source_event_id=body.source_event_id,
        source_channel=body.source_channel,
        created_by=body.created_by or "human:user",
        tags=body.tags or [],
        status="active",
        version=1,
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)

    return success_response(_serialize(artifact, with_content=True))


# ---------------------------------------------------------------------------
# GET /v1/artifacts — list with filters
# ---------------------------------------------------------------------------

@router.get("/artifacts")
async def list_artifacts(
    network: str = Query(...),
    kind: Optional[str] = Query(None),
    source_kind: Optional[str] = Query(None),
    source_id: Optional[str] = Query(None),
    source_channel: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    pinned: Optional[bool] = Query(None),
    q: Optional[str] = Query(None, description="Free-text search on title/summary"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(ArtifactRecord).where(
        ArtifactRecord.workspace_id == str(workspace.id),
    )

    if status:
        query = query.where(ArtifactRecord.status == status)
    else:
        # Default: hide deleted, show active + archived
        query = query.where(ArtifactRecord.status != "deleted")

    if kind:
        query = query.where(ArtifactRecord.kind == kind)
    if source_kind:
        query = query.where(ArtifactRecord.source_kind == source_kind)
    if source_id:
        query = query.where(ArtifactRecord.source_id == source_id)
    if source_channel:
        query = query.where(ArtifactRecord.source_channel == source_channel)
    if pinned is not None:
        query = query.where(ArtifactRecord.pinned == pinned)
    if q:
        like = f"%{q}%"
        query = query.where(or_(
            ArtifactRecord.title.ilike(like),
            ArtifactRecord.summary.ilike(like),
        ))

    # Pinned first, then newest first
    query = query.order_by(
        ArtifactRecord.pinned.desc(),
        ArtifactRecord.created_at.desc(),
    ).limit(limit).offset(offset)

    rows = db.execute(query).scalars().all()
    return success_response({
        "artifacts": [_serialize(r) for r in rows],
        "limit": limit,
        "offset": offset,
    })


# ---------------------------------------------------------------------------
# GET /v1/artifacts/{id}
# ---------------------------------------------------------------------------

@router.get("/artifacts/{artifact_id}")
async def get_artifact(
    artifact_id: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    artifact = db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.id == artifact_id,
            ArtifactRecord.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()

    if not artifact:
        return json_response(ResponseCode.NOT_FOUND, "Artifact not found")

    return success_response(_serialize(artifact, with_content=True))


# ---------------------------------------------------------------------------
# PATCH /v1/artifacts/{id}
# ---------------------------------------------------------------------------

@router.patch("/artifacts/{artifact_id}")
async def update_artifact(
    body: UpdateArtifactRequest,
    artifact_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    artifact = db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.id == artifact_id,
            ArtifactRecord.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()

    if not artifact:
        return json_response(ResponseCode.NOT_FOUND, "Artifact not found")

    if body.status is not None:
        if body.status not in {"active", "archived"}:
            return json_response(
                ResponseCode.BAD_REQUEST,
                "status must be 'active' or 'archived' (use DELETE for soft-delete)",
            )
        artifact.status = body.status

    if body.title is not None:
        if not body.title.strip():
            return json_response(ResponseCode.BAD_REQUEST, "title cannot be empty")
        artifact.title = body.title.strip()

    if body.summary is not None:
        artifact.summary = body.summary

    if body.content is not None:
        artifact.content = body.content
        artifact.size_bytes = len(body.content.encode("utf-8"))

    if body.metadata is not None:
        artifact.metadata_ = body.metadata

    if body.tags is not None:
        artifact.tags = body.tags

    if body.pinned is not None:
        artifact.pinned = bool(body.pinned)

    artifact.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(artifact)

    return success_response(_serialize(artifact, with_content=True))


# ---------------------------------------------------------------------------
# DELETE /v1/artifacts/{id} — soft delete
# ---------------------------------------------------------------------------

@router.delete("/artifacts/{artifact_id}")
async def delete_artifact(
    artifact_id: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    artifact = db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.id == artifact_id,
            ArtifactRecord.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()

    if not artifact:
        return json_response(ResponseCode.NOT_FOUND, "Artifact not found")

    artifact.status = "deleted"
    artifact.updated_at = datetime.now(timezone.utc)
    db.commit()

    return success_response({"id": artifact_id, "status": "deleted"})


# ---------------------------------------------------------------------------
# POST /v1/artifacts/{id}/share — generate share token (publish)
# ---------------------------------------------------------------------------

class ShareRequest(BaseModel):
    network: str


@router.post("/artifacts/{artifact_id}/share")
async def share_artifact(
    body: ShareRequest,
    artifact_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    artifact = db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.id == artifact_id,
            ArtifactRecord.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()

    if not artifact:
        return json_response(ResponseCode.NOT_FOUND, "Artifact not found")

    if artifact.status == "deleted":
        return json_response(ResponseCode.BAD_REQUEST, "Cannot share a deleted artifact")

    if not artifact.share_token:
        artifact.share_token = secrets.token_urlsafe(9)
    artifact.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(artifact)

    return success_response({
        "id": artifact.id,
        "share_token": artifact.share_token,
    })


# ---------------------------------------------------------------------------
# DELETE /v1/artifacts/{id}/share — revoke share token (unpublish)
# ---------------------------------------------------------------------------

@router.delete("/artifacts/{artifact_id}/share")
async def unshare_artifact(
    artifact_id: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    artifact = db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.id == artifact_id,
            ArtifactRecord.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()

    if not artifact:
        return json_response(ResponseCode.NOT_FOUND, "Artifact not found")

    artifact.share_token = None
    artifact.updated_at = datetime.now(timezone.utc)
    db.commit()

    return success_response({"id": artifact.id, "share_token": None})


# ---------------------------------------------------------------------------
# GET /v1/artifacts/public/{share_token} — public read, no auth
# ---------------------------------------------------------------------------

@router.get("/artifacts/public/{share_token}")
async def get_public_artifact(
    share_token: str,
    db: Session = Depends(get_db),
):
    artifact = db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.share_token == share_token,
            ArtifactRecord.status != "deleted",
        )
    ).scalar_one_or_none()

    if not artifact:
        return json_response(ResponseCode.NOT_FOUND, "Artifact not found")

    return success_response({
        "id": artifact.id,
        "kind": artifact.kind,
        "mime_type": artifact.mime_type,
        "title": artifact.title,
        "summary": artifact.summary,
        "content": artifact.content,
        "metadata": artifact.metadata_ or {},
        "tags": artifact.tags or [],
        "created_at": artifact.created_at.isoformat() if artifact.created_at else None,
        "updated_at": artifact.updated_at.isoformat() if artifact.updated_at else None,
    })


# ---------------------------------------------------------------------------
# POST /v1/artifacts/{id}/promote-to-knowledge
# ---------------------------------------------------------------------------

class PromoteRequest(BaseModel):
    network: str
    title: Optional[str] = None  # override; defaults to artifact.title
    description: Optional[str] = None


def _slugify(title: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", title.lower()).strip()
    slug = re.sub(r"[-\s]+", "-", slug)
    return slug[:80] if slug else "artifact"


def _unique_slug(db: Session, workspace_id: str, base: str) -> str:
    candidate = base
    suffix = 2
    while True:
        existing = db.execute(
            select(KnowledgeEntry).where(
                KnowledgeEntry.workspace_id == workspace_id,
                KnowledgeEntry.slug == candidate,
            )
        ).scalar_one_or_none()
        if not existing:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


@router.post("/artifacts/{artifact_id}/promote-to-knowledge")
async def promote_to_knowledge(
    body: PromoteRequest,
    artifact_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Create a knowledge entry mirroring this artifact's text content.

    One-way: subsequent edits to the artifact do NOT propagate. The link is
    captured in artifact.metadata.knowledge_entry_id for reverse lookup.
    """
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    artifact = db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.id == artifact_id,
            ArtifactRecord.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()

    if not artifact:
        return json_response(ResponseCode.NOT_FOUND, "Artifact not found")

    if artifact.kind not in {"markdown", "code", "json", "html"}:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Cannot promote {artifact.kind} artifacts to knowledge (text-only)",
        )

    content = artifact.content or ""
    if not content.strip():
        return json_response(ResponseCode.BAD_REQUEST, "Artifact has no content")

    title = (body.title or artifact.title).strip()
    description = body.description or artifact.summary or None

    ws_id = str(workspace.id)
    base_slug = _slugify(title)
    slug = _unique_slug(db, ws_id, base_slug)

    entry_id = str(_uuid_mod.uuid4())
    store = get_file_store()
    storage_filename = f"{slug}.md"
    content_bytes = content.encode("utf-8")
    storage_key = store.save(ws_id, entry_id, storage_filename, content_bytes)

    entry = KnowledgeEntry(
        id=entry_id,
        workspace_id=ws_id,
        slug=slug,
        title=title,
        description=description,
        storage_key=storage_key,
        content_size=len(content_bytes),
        created_by=artifact.created_by,
    )
    db.add(entry)

    # Back-link the artifact to the knowledge entry it spawned
    metadata = dict(artifact.metadata_ or {})
    metadata["knowledge_entry_id"] = entry_id
    metadata["knowledge_slug"] = slug
    artifact.metadata_ = metadata
    artifact.updated_at = datetime.now(timezone.utc)

    db.commit()

    return success_response({
        "artifact_id": artifact.id,
        "knowledge_entry_id": entry_id,
        "slug": slug,
        "title": title,
    })

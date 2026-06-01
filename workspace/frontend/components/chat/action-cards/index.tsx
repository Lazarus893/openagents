'use client';

import { TaskActionCard, type TaskActionMetadata } from './task-action-card';
import { KnowledgeActionCard, type KnowledgeActionMetadata } from './knowledge-action-card';
import { RoutineActionCard, type RoutineActionMetadata } from './routine-action-card';
import { FileActionCard, type FileActionMetadata } from './file-action-card';
import { ReviewActionCard, type ReviewActionMetadata } from './review-action-card';
import { ArtifactActionCard } from './artifact-action-card';

// ---------------------------------------------------------------------------
// Union type for all supported action metadata
// ---------------------------------------------------------------------------

export type ActionMetadata =
  | TaskActionMetadata
  | KnowledgeActionMetadata
  | RoutineActionMetadata
  | FileActionMetadata
  | ReviewActionMetadata;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface ActionCardRendererProps {
  metadata?: Record<string, unknown>;
  onOpen?: (entity: { type: string; id: string }) => void;
}

export function ActionCardRenderer({ metadata, onOpen }: ActionCardRendererProps) {
  if (!metadata) return null;

  // Auto-upgraded artifacts: persistence.py wrote `artifact_ids` array.
  // One message can carry multiple artifacts — render each as a card.
  const artifactIds = metadata.artifact_ids as string[] | undefined;
  if (Array.isArray(artifactIds) && artifactIds.length > 0) {
    return (
      <div className="space-y-2">
        {artifactIds.map((id) => (
          <ArtifactActionCard key={id} artifactId={id} onOpen={onOpen} />
        ))}
      </div>
    );
  }

  if (!metadata.actionType) return null;
  const actionType = metadata.actionType as string;

  switch (actionType) {
    case 'task_created':
    case 'task_updated':
      return <TaskActionCard metadata={metadata as unknown as TaskActionMetadata} onOpen={onOpen} />;
    case 'knowledge_added':
      return <KnowledgeActionCard metadata={metadata as unknown as KnowledgeActionMetadata} onOpen={onOpen} />;
    case 'routine_created':
      return <RoutineActionCard metadata={metadata as unknown as RoutineActionMetadata} onOpen={onOpen} />;
    case 'file_shared':
      return <FileActionCard metadata={metadata as unknown as FileActionMetadata} onOpen={onOpen} />;
    case 'review_requested':
      return <ReviewActionCard metadata={metadata as unknown as ReviewActionMetadata} onOpen={onOpen} />;
    default:
      return null;
  }
}

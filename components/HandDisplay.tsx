"use client";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import TileFace from "./TileFace";
import type { Tile } from "@/engine/tiles";

interface HandDisplayProps {
  tiles: Tile[];
  /** Tile IDs to highlight as "suggested discard" */
  suggestedDiscardIds?: Set<string>;
  /** Tile ID just drawn from the wall — outlined to make it easy to spot. */
  freshTileId?: string;
  /** Called when user clicks a tile (e.g. to discard it) */
  onTileClick?: (tile: Tile) => void;
  label?: string;
  /** When true, tiles can be dragged to reorder and clicking is disabled. */
  reorderable?: boolean;
  /** Called with the new tile-ID order after a drag. */
  onReorder?: (orderedIds: string[]) => void;
}

function freshWrapperClass(isFresh: boolean): string | undefined {
  return isFresh
    ? "relative rounded-md ring-2 ring-cyan-400 ring-offset-1 p-0.5"
    : undefined;
}

/** A tile that can be dragged within the hand (reorder mode). */
function SortableTile({
  tile,
  isFresh,
  highlighted,
}: {
  tile: Tile;
  isFresh: boolean;
  highlighted: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tile.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: "none",
    cursor: "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={freshWrapperClass(isFresh)}
    >
      {/* Disable inner pointer events so the drag wrapper owns the gesture. */}
      <div className="pointer-events-none">
        <TileFace suit={tile.suit} val={tile.val} size="lg" highlighted={highlighted} />
      </div>
    </div>
  );
}

export default function HandDisplay({
  tiles,
  suggestedDiscardIds,
  freshTileId,
  onTileClick,
  label = "Hand",
  reorderable = false,
  onReorder,
}: HandDisplayProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = tiles.map(t => t.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder?.(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">({tiles.length} tiles)</span>
        {freshTileId && !reorderable && (
          <span className="text-[10px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-300 rounded px-1.5 py-0.5">
            ◆ just drawn
          </span>
        )}
      </div>

      {tiles.length === 0 && (
        <div className="flex gap-1 flex-wrap min-h-12">
          <span className="text-xs text-gray-400 italic">No tiles yet</span>
        </div>
      )}

      {tiles.length > 0 && reorderable && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tiles.map(t => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex gap-1 flex-wrap min-h-12">
              {tiles.map(tile => (
                <SortableTile
                  key={tile.id}
                  tile={tile}
                  isFresh={tile.id === freshTileId}
                  highlighted={!!suggestedDiscardIds?.has(tile.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {tiles.length > 0 && !reorderable && (
        <div className="flex gap-1 flex-wrap min-h-12">
          {tiles.map(tile => {
            const isFresh = tile.id === freshTileId;
            return (
              <div key={tile.id} className={freshWrapperClass(isFresh)}>
                <TileFace
                  suit={tile.suit}
                  val={tile.val}
                  size="lg"
                  highlighted={suggestedDiscardIds?.has(tile.id)}
                  onClick={onTileClick ? () => onTileClick(tile) : undefined}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

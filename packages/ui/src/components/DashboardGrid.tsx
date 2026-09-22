import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { DashboardItemWithWidget } from "@staffroom/protocol"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Widget } from "./Widget.tsx"

/**
 * A dashboard's editable grid. Items are placed on a fixed-column grid in column
 * units `(x, y, w, h)`; widgets are dragged by their header (dnd-kit) and
 * resized from a bottom-right handle (manual pointer tracking). Overlap is
 * allowed — the operator arranges freely — and the whole layout is saved on each
 * drag or resize end via `onLayoutChange`.
 *
 * Column width is measured from the container so the grid is responsive; row
 * height is fixed. Positions are stored as integers, so a narrower viewport
 * keeps the same layout and just scales each column.
 */
const COLUMNS = 12
const ROW_HEIGHT = 48
const GAP = 12

export function DashboardGrid({
  items,
  onLayoutChange,
  onRemoveItem,
}: {
  items: DashboardItemWithWidget[]
  onLayoutChange: (items: DashboardItemWithWidget[]) => void
  onRemoveItem: (itemId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [colWidth, setColWidth] = useState(0)
  // A grid overlay shows only while the operator is placing a widget — dragging
  // or resizing — so the snap targets are visible then and the board stays clean
  // at rest.
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const sensors = useSensors(
    // A small drag threshold so clicking a widget (or its remove button) does
    // not start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = () => setColWidth((element.clientWidth - GAP * (COLUMNS - 1)) / COLUMNS)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const rows = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
  const height = Math.max(rows * (ROW_HEIGHT + GAP), 120)

  function commit(next: DashboardItemWithWidget[]) {
    onLayoutChange(next)
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(false)
    if (colWidth <= 0) return
    const item = items.find((entry) => entry.id === event.active.id)
    if (!item) return
    const dx = Math.round(event.delta.x / (colWidth + GAP))
    const dy = Math.round(event.delta.y / (ROW_HEIGHT + GAP))
    if (dx === 0 && dy === 0) return
    const x = clamp(item.x + dx, 0, COLUMNS - item.w)
    const y = Math.max(0, item.y + dy)
    commit(items.map((entry) => (entry.id === item.id ? { ...entry, x, y } : entry)))
  }

  function onResize(itemId: string, w: number, h: number) {
    commit(items.map((entry) => (entry.id === itemId ? { ...entry, w, h } : entry)))
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={onDragEnd}
    >
      <div ref={containerRef} className="relative w-full" style={{ height }}>
        {colWidth > 0 && (dragging || resizing) && (
          <GridOverlay colWidth={colWidth} height={height} />
        )}
        {colWidth > 0 &&
          items.map((item) => (
            <GridItem
              key={item.id}
              item={item}
              colWidth={colWidth}
              onRemove={() => onRemoveItem(item.id)}
              onResize={(w, h) => onResize(item.id, w, h)}
              onResizingChange={setResizing}
            />
          ))}
      </div>
    </DndContext>
  )
}

/**
 * The snap grid, drawn only while placing a widget. A faint line at each column's
 * left edge and each row's top edge — the exact positions items snap to — so a
 * drag or resize reads against the grid it will land on. Non-interactive and
 * behind the items.
 */
function GridOverlay({ colWidth, height }: { colWidth: number; height: number }) {
  const columnPitch = colWidth + GAP
  const rowPitch = ROW_HEIGHT + GAP
  const rowLines = Math.ceil(height / rowPitch)
  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
      {Array.from({ length: COLUMNS }, (_, column) => (
        <div
          key={`c${column}`}
          className="absolute top-0 bottom-0 w-px bg-line-strong/60"
          style={{ left: column * columnPitch }}
        />
      ))}
      {Array.from({ length: rowLines + 1 }, (_, row) => (
        <div
          key={`r${row}`}
          className="absolute inset-x-0 h-px bg-line-strong/60"
          style={{ top: row * rowPitch }}
        />
      ))}
    </div>
  )
}

function GridItem({
  item,
  colWidth,
  onRemove,
  onResize,
  onResizingChange,
}: {
  item: DashboardItemWithWidget
  colWidth: number
  onRemove: () => void
  onResize: (w: number, h: number) => void
  onResizingChange: (resizing: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id })
  const left = item.x * (colWidth + GAP)
  const top = item.y * (ROW_HEIGHT + GAP)
  const width = item.w * colWidth + (item.w - 1) * GAP
  const heightPx = item.h * ROW_HEIGHT + (item.h - 1) * GAP

  const style: CSSProperties = {
    position: "absolute",
    left,
    top,
    width,
    height: heightPx,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 20 : undefined,
  }

  function startResize(event: React.PointerEvent) {
    // Own the pointer so a resize never also starts a drag or selects text.
    event.preventDefault()
    event.stopPropagation()
    onResizingChange(true)
    const startX = event.clientX
    const startY = event.clientY
    const startW = item.w
    const startH = item.h
    const move = (moveEvent: PointerEvent) => {
      const dw = Math.round((moveEvent.clientX - startX) / (colWidth + GAP))
      const dh = Math.round((moveEvent.clientY - startY) / (ROW_HEIGHT + GAP))
      const w = clamp(startW + dw, 1, COLUMNS - item.x)
      const h = Math.max(1, startH + dh)
      if (w !== item.w || h !== item.h) onResize(w, h)
    }
    const up = () => {
      onResizingChange(false)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <div ref={setNodeRef} style={style} className="flex touch-none flex-col">
      <div className="relative flex h-full min-h-0 flex-col">
        {/* The drag handle is a thin strip over the widget's own header, so the
            widget renders normally and only the top edge grabs. It stops short of
            the right edge so the header's remove button stays clickable — a
            full-width strip would sit over the button and swallow the click. */}
        <div
          {...listeners}
          {...attributes}
          className="absolute top-0 left-0 right-12 z-10 h-9 cursor-grab active:cursor-grabbing"
          aria-label="Drag widget"
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <Widget widget={item.widget} onRemove={onRemove} fill />
        </div>
        {/* Resize handle, bottom-right. */}
        <div
          onPointerDown={startResize}
          title="Resize"
          aria-label="Resize widget"
          className="absolute right-0 bottom-0 z-10 h-4 w-4 cursor-se-resize text-ink-faint hover:text-ink-primary"
        >
          <i className="ti ti-arrows-diagonal text-[13px]" />
        </div>
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export { COLUMNS as DASHBOARD_COLUMNS }

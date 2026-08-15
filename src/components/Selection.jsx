/** Row selection for list pages: checkbox column plus a floating bulk-action bar. */

import { useCallback, useMemo, useState } from 'react'
import Icon from './Icon.jsx'

export function useSelection(items, getId = (item) => item.id) {
  const [selected, setSelected] = useState(() => new Set())

  const visibleIds = useMemo(() => items.map(getId), [items, getId])

  // Selections survive filtering, but the header checkbox only reflects what is
  // on screen, so "select all" never silently includes hidden rows.
  const selectedVisible = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected],
  )

  const toggle = useCallback((id) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current)
      const allOn = visibleIds.length > 0 && visibleIds.every((id) => next.has(id))
      if (allOn) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }, [visibleIds])

  const clear = useCallback(() => setSelected(new Set()), [])

  return {
    selected,
    ids: selectedVisible,
    count: selectedVisible.length,
    isSelected: (id) => selected.has(id),
    allVisibleSelected: visibleIds.length > 0 && visibleIds.every((id) => selected.has(id)),
    someVisibleSelected: selectedVisible.length > 0 && selectedVisible.length < visibleIds.length,
    toggle,
    toggleAll,
    clear,
  }
}

/** Header checkbox — indeterminate when only some visible rows are picked. */
export function SelectAllBox({ selection }) {
  return (
    <input
      type="checkbox"
      className="row-check"
      checked={selection.allVisibleSelected}
      ref={(node) => {
        if (node) node.indeterminate = selection.someVisibleSelected
      }}
      onChange={selection.toggleAll}
      aria-label="Select all rows"
    />
  )
}

export function RowBox({ selection, id }) {
  return (
    <input
      type="checkbox"
      className="row-check"
      checked={selection.isSelected(id)}
      onChange={() => selection.toggle(id)}
      onClick={(event) => event.stopPropagation()}
      aria-label="Select row"
    />
  )
}

export function BulkBar({ selection, noun = 'item', onDelete, children }) {
  if (selection.count === 0) return null
  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selection.count}</span>
      <span className="grow">
        {noun}
        {selection.count === 1 ? '' : 's'} selected
      </span>
      {children}
      <button className="btn btn-sm" onClick={selection.clear}>
        Clear
      </button>
      {onDelete && (
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          <Icon name="trash" size={14} />
          Delete
        </button>
      )}
    </div>
  )
}

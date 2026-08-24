/** Shared presentational building blocks used across POS and admin. */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { colorFor, initials, softColorFor } from '../lib/format.js'
import { useApp } from '../lib/store.jsx'

export function Modal({ open, onClose, title, subtitle, children, footer, size = '' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function StatCard({ label, value, meta, accent = false, delta = null }) {
  const up = delta !== null && delta !== undefined && delta >= 0
  return (
    <div className={`stat ${accent ? 'stat-accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="stat-value">{value}</div>
        {delta !== null && delta !== undefined && (
          <span className={`delta ${up ? '' : 'down'}`}>
            {up ? '+' : ''}
            {delta.toFixed(1)}% {up ? '↑' : '↓'}
          </span>
        )}
      </div>
      {meta && <div className="stat-meta">{meta}</div>}
    </div>
  )
}

export function BarRow({ label, value, max, display, color }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="bar-row">
      <div className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${width}%`, background: color }} />
      </div>
      <div className="right mono">{display}</div>
    </div>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

/** Square image tile with a deterministic colour fallback. */
export function Thumb({ src, name, className = 'cart-thumb', style, children, fit = 'cover' }) {
  if (src) {
    return (
      <div
        className={className}
        style={fit === 'contain' ? { background: '#fff', ...style } : style}
      >
        {/* A contained thumb shows the whole image — a logo preview that crops
            is a preview of the wrong thing. */}
        <img src={src} alt={name} style={fit === 'contain' ? { objectFit: 'contain', padding: 6 } : undefined} />
        {children}
      </div>
    )
  }
  const tint = softColorFor(name || '?')
  return (
    <div className={className} style={{ background: tint.bg, color: tint.fg, ...style }}>
      {initials(name || '?')}
      {children}
    </div>
  )
}

export function Avatar({ name, size = 34 }) {
  return (
    <div
      className="avatar"
      style={{ background: colorFor(name), width: size, height: size, fontSize: size * 0.37 }}
    >
      {initials(name)}
    </div>
  )
}

export function StatusBadge({ status }) {
  const tone = {
    Active: 'var(--brand)',
    Completed: 'var(--brand)',
    Upcoming: 'var(--warn)',
    Refunded: 'var(--danger)',
    'Partially Refunded': 'var(--warn)',
    Cancelled: 'var(--danger)',
    Pending: 'var(--warn)',
    Draft: 'var(--muted-2)',
  }
  return (
    <span className="status-cell" style={{ color: tone[status] || 'var(--muted)' }}>
      <span className="dot" />
      <span style={{ color: 'var(--text)' }}>{status}</span>
    </span>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          className={`tab ${value === tab.value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {message}
      </p>
    </Modal>
  )
}

export function Toasts() {
  const { toasts } = useApp()
  return createPortal(
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          {toast.message}
        </div>
      ))}
    </div>,
    document.body,
  )
}

/** Online / offline + outbox indicator. */
export function SyncPill() {
  const { online, syncing, pendingSync } = useApp()
  if (!online) {
    return (
      <span className="sync-pill offline" title="Sales are stored on this device and will sync automatically">
        <span className="dot" /> Offline{pendingSync ? ` · ${pendingSync} queued` : ''}
      </span>
    )
  }
  if (syncing || pendingSync) {
    return (
      <span className="sync-pill busy">
        <span className="dot" /> Syncing{pendingSync ? ` ${pendingSync}` : ''}
      </span>
    )
  }
  return (
    <span className="sync-pill">
      <span className="dot" /> Synced
    </span>
  )
}

/**
 * Resizes an uploaded image to a data URL small enough to store inline.
 *
 * Two shapes, because the two things this picks are not alike. A product photo
 * is cropped square and written as JPEG: the grid is a grid, and photographs
 * neither need transparency nor survive PNG's file size. A logo is not croppable
 * — a wide wordmark loses its first and last letters to a square crop — so
 * `fit="contain"` keeps the whole image inside the box at its own proportions
 * and writes PNG, which is the only one of the two that keeps an alpha channel.
 */
export function ImagePicker({ value, onChange, name, fit = 'cover' }) {
  const [busy, setBusy] = useState(false)
  const contain = fit === 'contain'

  const handleFile = (file) => {
    if (!file) return
    setBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const size = 320
        const canvas = document.createElement('canvas')
        const scale = contain
          ? Math.min(size / image.width, size / image.height, 1)
          : Math.max(size / image.width, size / image.height)
        const width = image.width * scale
        const height = image.height * scale
        // Contained: the canvas is the image, so nothing is cropped and no
        // background is invented behind a transparent logo.
        canvas.width = contain ? Math.round(width) : size
        canvas.height = contain ? Math.round(height) : size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(
          image,
          (canvas.width - width) / 2,
          (canvas.height - height) / 2,
          width,
          height,
        )
        onChange(contain ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.78))
        setBusy(false)
      }
      image.onerror = () => setBusy(false)
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="row">
      <Thumb
        src={value}
        name={name}
        className="cart-thumb"
        fit={fit}
        style={{ width: 62, height: 62, borderRadius: 14, fontSize: 18 }}
      />
      <div className="stack-sm grow">
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          {busy ? 'Processing…' : value ? 'Replace image' : 'Upload image'}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </label>
        {value && (
          <button className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

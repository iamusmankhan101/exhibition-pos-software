/** Formatting, id generation and money helpers. */

export const MAIN_LOCATION = 'MAIN'

/** Money is held as a plain number; every arithmetic result is rounded to 2dp. */
export function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

export function formatMoney(value, symbol = '£') {
  const n = money(value || 0)
  const sign = n < 0 ? '-' : ''
  return `${sign}${symbol}${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

export function uid(prefix = 'id') {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `${prefix}_${random}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function formatDate(iso, withTime = false) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  if (!withTime) return date
  return `${date} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

export function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10)
}

export function isToday(iso) {
  return dayKey(iso) === dayKey(new Date().toISOString())
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

/** Deterministic hue from a string, used for placeholder tiles and avatars. */
export function hueFor(seed = '') {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return hash
}

export function colorFor(seed = '') {
  return `hsl(${hueFor(seed)} 42% 44%)`
}

/** Tinted fill + readable ink of the same hue, for light-theme tiles. */
export function softColorFor(seed = '') {
  const hue = hueFor(seed)
  return { bg: `hsl(${hue} 52% 94%)`, fg: `hsl(${hue} 42% 38%)` }
}

export function variantLabel(variant) {
  if (!variant) return ''
  return [variant.color, variant.size].filter(Boolean).join(' · ')
}

export function pad(value, length = 3) {
  return String(value).padStart(length, '0')
}

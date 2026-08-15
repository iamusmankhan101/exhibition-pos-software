/**
 * Bar chart with a hover tooltip and a highlighted column.
 * Pure CSS/DOM — no charting dependency.
 */

import { useState } from 'react'

function shortNumber(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

export default function BarChart({ data, format, height = 210, tooltipRows }) {
  // `data`: [{ label, value, meta }]
  const [hovered, setHovered] = useState(null)

  const max = Math.max(1, ...data.map((row) => row.value))
  // Round the axis up to a clean step so gridlines read well.
  const step = Math.pow(10, Math.floor(Math.log10(max || 1)))
  const ceiling = Math.ceil(max / step) * step || 1
  const ticks = [1, 0.8, 0.6, 0.4, 0.2, 0].map((fraction) => ceiling * fraction)

  const peakIndex = data.reduce((best, row, index) => (row.value > data[best].value ? index : best), 0)
  const active = hovered ?? peakIndex

  return (
    <div className="chart" style={{ '--chart-h': `${height}px` }}>
      <div className="chart-y" style={{ height }}>
        {ticks.map((tick, index) => (
          <span key={index}>{shortNumber(tick)}</span>
        ))}
      </div>

      <div className="chart-grid" style={{ height }}>
        {ticks.map((_, index) => (
          <i key={index} />
        ))}
      </div>

      <div className="chart-bars" style={{ height }}>
        {data.map((row, index) => {
          const isActive = index === active
          // Keep the tooltip inside the chart: nudge it sideways at the edges and
          // stop it climbing past the top when the active bar is near full height.
          const position = (index + 0.5) / data.length
          const shift = position < 0.2 ? '-8%' : position > 0.8 ? '-92%' : '-50%'
          const barTop = (row.value / ceiling) * height
          const tipBottom = Math.max(6, Math.min(barTop + 14, height - 88))
          return (
            <div
              key={row.label}
              className={`chart-col ${isActive ? 'active' : ''}`}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setHovered(index)}
            >
              {isActive && row.value > 0 && <div className="chart-knob" />}
              <div
                className="chart-bar"
                style={{ height: `${Math.max(2, (row.value / ceiling) * 100)}%` }}
              />
              {isActive && row.value > 0 && (
                <div
                  className="chart-tip"
                  style={{ left: '50%', bottom: `${tipBottom}px`, transform: `translate(${shift}, 0)` }}
                >
                  <div className="t-date">{row.meta?.date || row.label}</div>
                  {(tooltipRows ? tooltipRows(row) : [['Total', format(row.value)]]).map(([key, value]) => (
                    <div className="t-row" key={key}>
                      <span>{key}</span>
                      <span>{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="chart-x">
        {data.map((row) => (
          <span key={row.label}>{row.label}</span>
        ))}
      </div>
    </div>
  )
}

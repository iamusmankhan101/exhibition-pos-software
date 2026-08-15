/** CSV / Excel export helpers. Both open in Excel; PDF goes through print. */

function escapeCell(value) {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export function toCsv(columns, rows) {
  const header = columns.map((column) => escapeCell(column.label)).join(',')
  const body = rows
    .map((row) => columns.map((column) => escapeCell(column.value(row))).join(','))
    .join('\n')
  return `${header}\n${body}`
}

function download(filename, content, mime) {
  const blob = new Blob([`﻿${content}`], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv(filename, columns, rows) {
  download(`${filename}.csv`, toCsv(columns, rows), 'text/csv;charset=utf-8;')
}

/** Excel opens this HTML table natively and keeps the column formatting. */
export function exportExcel(filename, columns, rows) {
  const head = columns.map((column) => `<th>${column.label}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => `<td>${String(column.value(row) ?? '').replace(/</g, '&lt;')}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
  download(`${filename}.xls`, html, 'application/vnd.ms-excel')
}

/** PDF export via the browser print dialog ("Save as PDF"). */
export function exportPdf(title, columns, rows, subtitle = '') {
  const head = columns.map((column) => `<th>${column.label}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => `<td>${String(column.value(row) ?? '').replace(/</g, '&lt;')}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  const win = window.open('', '_blank')
  if (!win) {
    alert('Please allow pop-ups to export a PDF.')
    return
  }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title>
    <style>
      body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 28px; color: #111; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      p.sub { margin: 0 0 20px; color: #666; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
      th { background: #f4f4f5; }
      tr:nth-child(even) td { background: #fafafa; }
    </style></head><body>
    <h1>${title}</h1><p class="sub">${subtitle}</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 350)
}

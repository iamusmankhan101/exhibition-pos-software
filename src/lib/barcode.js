/**
 * EAN-13 barcodes for the catalogue.
 *
 * Every variant gets its own scannable number, printed on the garment label and
 * read back at the till. EAN-13 because it is what retail scanners expect, what
 * the camera scanner in `Scanner.jsx` already decodes, and what a cheap laser
 * gun reads without configuration.
 *
 * The numbers start `20`, which is not an accident: GS1 reserves prefixes 20-29
 * for restricted distribution — in-store codes that are guaranteed never to
 * collide with a real manufacturer's product. Tareez does not own a GS1 company
 * prefix, so inventing numbers in anyone else's range would eventually clash
 * with a scanned product from an actual supplier. This range is meant for
 * exactly this use.
 *
 *   2 0 X X X X X X X X X X C
 *   └─┬─┘ └────────┬───────┘ └── check digit, derived from the other twelve
 *     │            └──────────── ten digits identifying the variant
 *     └───────────────────────── in-store prefix
 */

const PREFIX = '20'

/**
 * The EAN check digit: weight the twelve digits 1,3,1,3… and take what is
 * needed to reach the next multiple of ten. A scanner recomputes this and
 * rejects the read if it disagrees, which is what makes a damaged or misprinted
 * label fail loudly instead of ringing up the wrong dress.
 */
export function eanCheckDigit(twelve) {
  const digits = String(twelve).replace(/\D/g, '').slice(0, 12)
  if (digits.length !== 12) return null
  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

export function isValidEan13(code) {
  const digits = String(code || '').replace(/\D/g, '')
  if (digits.length !== 13) return false
  return eanCheckDigit(digits.slice(0, 12)) === digits[12]
}

/**
 * A fresh code that nothing else in the catalogue is using.
 *
 * Random rather than sequential: two tills adding products offline cannot
 * coordinate a counter, and a collision there would put two different dresses on
 * one number. Ten random digits give a billion-to-one clash per pair, and the
 * `taken` set rules out the ones this device can see.
 */
export function generateBarcode(taken = new Set()) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let body = ''
    for (let i = 0; i < 10; i += 1) body += Math.floor(Math.random() * 10)
    const code = PREFIX + body
    const full = code + eanCheckDigit(code)
    if (!taken.has(full)) return full
  }
  // Fifty collisions is not chance; fall back to something time-based rather
  // than looping forever or handing back a duplicate.
  const body = String(Date.now()).slice(-10)
  return PREFIX + body + eanCheckDigit(PREFIX + body)
}

/** Every barcode currently in use, for uniqueness checks and generation. */
export function usedBarcodes(products, exceptProductId = null) {
  const taken = new Set()
  for (const product of products) {
    if (product.id === exceptProductId) continue
    for (const variant of product.variants) {
      if (variant.barcode) taken.add(String(variant.barcode))
    }
  }
  return taken
}

/* ------------------------------------------------------------- rendering */

// Left-hand digits are encoded as L or G depending on the first digit; the
// right-hand half is always R. This is the whole of EAN-13's encoding.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = L.map((pattern) => pattern.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0')))
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/**
 * The bar pattern as a string of 0s and 1s, 95 modules wide.
 * Returns null for anything that is not a valid EAN-13.
 */
export function ean13Modules(code) {
  const digits = String(code || '').replace(/\D/g, '')
  if (!isValidEan13(digits)) return null
  const parity = PARITY[Number(digits[0])]
  let bits = '101' // start guard
  for (let i = 1; i <= 6; i += 1) {
    bits += (parity[i - 1] === 'L' ? L : G)[Number(digits[i])]
  }
  bits += '01010' // centre guard
  for (let i = 7; i <= 12; i += 1) bits += R[Number(digits[i])]
  return `${bits}101` // end guard
}

/**
 * An SVG of the barcode, sized in millimetres so it prints at a scale a scanner
 * can actually read. The human-readable digits sit underneath, which is what
 * lets a salesperson key the number in when a label is scuffed.
 */
export function ean13Svg(code, { moduleWidth = 0.33, height = 18, quiet = 11 } = {}) {
  const modules = ean13Modules(code)
  if (!modules) return ''
  const digits = String(code).replace(/\D/g, '')

  const width = modules.length * moduleWidth
  const totalWidth = width + quiet * moduleWidth * 2
  const textY = height + 3.4
  const totalHeight = textY + 1

  // The guard bars run longer than the data bars — that is what the printed
  // digits tuck into on a real retail label.
  const isGuard = (index) =>
    index < 3 || (index >= 45 && index < 50) || index >= modules.length - 3

  let bars = ''
  for (let i = 0; i < modules.length; i += 1) {
    if (modules[i] !== '1') continue
    const x = quiet * moduleWidth + i * moduleWidth
    const barHeight = isGuard(i) ? height + 2 : height
    bars += `<rect x="${x.toFixed(3)}" y="0" width="${moduleWidth}" height="${barHeight}" />`
  }

  const digitStyle = `font-family="monospace" font-size="3.2" fill="#000"`
  const first = `<text x="${(quiet * moduleWidth - 1.5).toFixed(3)}" y="${textY}" text-anchor="end" ${digitStyle}>${digits[0]}</text>`
  const left = `<text x="${(quiet * moduleWidth + 25 * moduleWidth).toFixed(3)}" y="${textY}" text-anchor="middle" ${digitStyle}>${digits.slice(1, 7)}</text>`
  const rightX = quiet * moduleWidth + 70 * moduleWidth
  const rightHalf = `<text x="${rightX.toFixed(3)}" y="${textY}" text-anchor="middle" ${digitStyle}>${digits.slice(7)}</text>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth.toFixed(2)}mm" height="${totalHeight.toFixed(2)}mm"`,
    ` viewBox="0 0 ${totalWidth.toFixed(3)} ${totalHeight.toFixed(3)}">`,
    `<rect width="${totalWidth.toFixed(3)}" height="${totalHeight.toFixed(3)}" fill="#fff"/>`,
    `<g fill="#000">${bars}</g>`,
    first,
    left,
    rightHalf,
    '</svg>',
  ].join('')
}

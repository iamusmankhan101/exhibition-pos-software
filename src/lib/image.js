/**
 * Turning a picked file into the small data URL the catalogue stores.
 *
 * Product images live inside the record itself, not behind a URL: the till has
 * to draw a thumbnail with no network, and an `<img src>` pointing at a bucket
 * is a blank square at a venue with no signal. That makes size the whole
 * problem — every image is copied into IndexedDB, broadcast to the other tabs
 * on the machine, and pushed to Supabase as a text column, so a 4MB phone photo
 * is 4MB in each of those places. Everything is squared off to 320px and
 * re-encoded before it is allowed near the state.
 */

const SIZE = 320

/**
 * Reads an image file and hands back a data URL at most `SIZE` on its long edge.
 *
 * `fit: 'cover'` crops to a square, which is what a product tile wants. `fit:
 * 'contain'` keeps the whole image and the canvas takes the image's shape, so a
 * logo with transparent margins is not given an invented background — that is
 * why the two modes also differ on encoding: PNG keeps the transparency,
 * JPEG halves the bytes for a photo that has none.
 */
export function fileToDataUrl(file, { fit = 'cover', size = SIZE } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'))
    const contain = fit === 'contain'
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Not an image this browser can open'))
      image.onload = () => {
        const canvas = document.createElement('canvas')
        const scale = contain
          ? Math.min(size / image.width, size / image.height, 1)
          : Math.max(size / image.width, size / image.height)
        const width = image.width * scale
        const height = image.height * scale
        canvas.width = contain ? Math.round(width) : size
        canvas.height = contain ? Math.round(height) : size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
        resolve(contain ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.78))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

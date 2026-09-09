/**
 * Camera barcode / QR scanner.
 *
 * Wraps html5-qrcode and adds the behaviour a POS needs: retail barcode formats,
 * a duplicate-scan guard, torch control where the device supports it and a
 * manual-entry fallback for damaged labels.
 */

import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'

const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
]

const REGION_ID = 'tareez-scanner-region'

export default function Scanner({ onDetected, onError }) {
  const [status, setStatus] = useState('starting')
  const [message, setMessage] = useState('')
  const [manual, setManual] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchable, setTorchable] = useState(false)
  const scannerRef = useRef(null)
  const lastScan = useRef({ code: '', at: 0 })
  const detectedRef = useRef(onDetected)

  detectedRef.current = onDetected

  useEffect(() => {
    let cancelled = false
    const scanner = new Html5Qrcode(REGION_ID, {
      formatsToSupport: FORMATS,
      // Use the browser's own barcode engine where it exists, keeping ZXing as
      // the fallback. ZXing decodes a QR code from almost anything but is far
      // fussier about a 1D symbol — the exact case a till needs most — and the
      // native detector reads an EAN-13 off a phone camera that ZXing gives up
      // on. `isSupported()` guards it, so nothing changes where it is missing.
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false,
    })
    scannerRef.current = scanner

    const handle = (decoded) => {
      const now = Date.now()
      // The camera fires many frames per second; ignore the same code twice.
      if (lastScan.current.code === decoded && now - lastScan.current.at < 1200) return
      lastScan.current = { code: decoded, at: now }
      if (navigator.vibrate) navigator.vibrate(35)
      detectedRef.current?.(decoded)
    }

    scanner
      .start(
        {
          facingMode: 'environment',
          // A barcode is resolved by the width of its narrowest bar, so the
          // stream's resolution is the ceiling on what can be read at all. The
          // default is often 640x480, at which the bars of an EAN-13 held at
          // arm's length land under a pixel apiece. Asked for as `ideal`, so a
          // camera that cannot manage it still starts.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        {
          fps: 12,
          /*
           * A box shaped like the thing being scanned.
           *
           * Only what falls inside this is handed to the decoder, and an EAN-13
           * is a wide, short symbol that has to arrive whole — quiet zones
           * included, since a scanner that cannot see the pale margin does not
           * read the code. The old box was nearly square and 78% of the
           * *smaller* side, which on a portrait phone is a narrow window that a
           * label has to be pushed away from the lens to fit inside — and by
           * then the bars are too small to resolve. Wide and shallow lets the
           * operator fill the frame with the label instead.
           */
          qrbox: (viewWidth, viewHeight) => ({
            width: Math.max(120, Math.floor(viewWidth * 0.92)),
            height: Math.max(80, Math.floor(Math.min(viewHeight * 0.6, viewWidth * 0.45))),
          }),
          // No `aspectRatio`: the shell now takes its shape from whatever the
          // camera gives, so there is nothing left to match and over-
          // constraining the request only risks a camera refusing to start.
          disableFlip: false,
        },
        handle,
        () => {},
      )
      .then(() => {
        if (cancelled) return
        setStatus('running')
        const capabilities = scanner.getRunningTrackCapabilities?.() || {}
        setTorchable(Boolean(capabilities.torch))
      })
      .catch((error) => {
        if (cancelled) return
        setStatus('error')
        const text = !window.isSecureContext
          ? 'Camera access needs HTTPS (or localhost). Enter the code manually below.'
          : error?.message?.includes('Permission')
            ? 'Camera permission was denied. Allow it in your browser settings, or type the code below.'
            : 'No camera available on this device. Type the code below instead.'
        setMessage(text)
        onError?.(error)
      })

    return () => {
      cancelled = true
      const instance = scannerRef.current
      if (instance?.isScanning) {
        instance.stop().then(() => instance.clear()).catch(() => {})
      }
    }
  }, [onError])

  const toggleTorch = async () => {
    try {
      await scannerRef.current?.applyVideoConstraints({ advanced: [{ torch: !torchOn }] })
      setTorchOn((current) => !current)
    } catch {
      setTorchable(false)
    }
  }

  return (
    <div className="stack-sm">
      <div className={`scanner-shell ${status === 'running' ? '' : 'is-idle'}`}>
        {/* Width only: the library sets the video's width from this element
            and lets its height follow the stream, which is what keeps its
            scan-region maths honest. Forcing a height here would reintroduce
            the mismatch described in `.scanner-shell`. */}
        <div id={REGION_ID} style={{ width: '100%' }} />
        {/* No frame of our own: html5-qrcode shades the region it actually
            decodes, and a second hand-positioned box could only ever agree
            with it by coincidence. */}
        {status === 'running' && (
          <div className="scan-hint">Line the barcode up inside the box</div>
        )}
        {status === 'starting' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              gap: 10,
              color: '#fff',
            }}
          >
            <div className="spinner" />
            <span className="small">Starting camera…</span>
          </div>
        )}
        {status === 'error' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              padding: 24,
              textAlign: 'center',
              color: '#fff',
            }}
          >
            <span className="small">{message}</span>
          </div>
        )}
      </div>

      {torchable && (
        <button className="btn btn-sm" onClick={toggleTorch}>
          {torchOn ? '🔦 Torch off' : '🔦 Torch on'}
        </button>
      )}

      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault()
          const code = manual.trim()
          if (!code) return
          setManual('')
          detectedRef.current?.(code)
        }}
      >
        <input
          className="input"
          placeholder="Or type a barcode / SKU"
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          autoComplete="off"
        />
        <button className="btn btn-primary" type="submit">
          Add
        </button>
      </form>
    </div>
  )
}

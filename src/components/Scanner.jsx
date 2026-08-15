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
    const scanner = new Html5Qrcode(REGION_ID, { formatsToSupport: FORMATS, verbose: false })
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
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: (viewWidth, viewHeight) => {
            const edge = Math.floor(Math.min(viewWidth, viewHeight) * 0.78)
            return { width: edge, height: Math.floor(edge * 0.62) }
          },
          aspectRatio: 1.334,
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
      <div className="scanner-shell">
        <div id={REGION_ID} style={{ width: '100%', height: '100%' }} />
        {status === 'running' && (
          <>
            <div className="scan-frame" />
            <div className="scan-hint">Point the camera at the barcode or QR label</div>
          </>
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

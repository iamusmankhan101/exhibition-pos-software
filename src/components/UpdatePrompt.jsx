/**
 * Offers a new version rather than installing it.
 *
 * A POS that reloads itself would do it at the worst possible moment — mid-sale,
 * with a customer waiting and a cart on screen. So the new worker sits and waits
 * until somebody taps Update, which should be between customers.
 */

import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

export default function UpdatePrompt() {
  const [needsUpdate, setNeedsUpdate] = useState(false)
  const [update, setUpdate] = useState(null)

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setNeedsUpdate(true)
      },
    })
    // `registerSW` returns the function that activates the waiting worker.
    setUpdate(() => updateSW)
  }, [])

  if (!needsUpdate) return null

  return (
    <div className="update-bar">
      <span>A new version is ready.</span>
      <button className="btn btn-sm" onClick={() => setNeedsUpdate(false)}>
        Later
      </button>
      <button className="btn btn-sm btn-primary" onClick={() => update?.(true)}>
        Update now
      </button>
    </div>
  )
}

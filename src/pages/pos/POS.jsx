/**
 * Point of sale. Optimised for one-handed use on a tablet at a busy stall:
 * scan or tap → cart → checkout wizard → receipt.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, useCurrency } from '../../lib/store.jsx'
import {
  computeTotals,
  findByCode,
  findVariant,
  getStock,
  hasExhibitionPrice,
  sellingPrice,
} from '../../lib/domain.js'
import { formatTime, money, variantLabel } from '../../lib/format.js'
import { Field, Modal, SyncPill, Thumb } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import CheckoutModal from './CheckoutModal.jsx'
import SaleComplete from './SaleComplete.jsx'

// The camera library is ~400 kB — keep it out of the first paint on a tablet.
const Scanner = lazy(() => import('../../components/Scanner.jsx'))

const CART_KEY = 'tareez.cart'

function loadCart(exhibitionId) {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_KEY))
    if (stored?.exhibitionId === exhibitionId) return stored.items || []
  } catch {
    /* ignore */
  }
  return []
}

export default function POS() {
  const { state, user, activeExhibition, sellLocationId, sellLocationName, actions, can } = useApp()
  const currency = useCurrency()
  const navigate = useNavigate()

  const [cart, setCart] = useState(() => loadCart(sellLocationId))
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [scanOpen, setScanOpen] = useState(false)
  const [variantPick, setVariantPick] = useState(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [completed, setCompleted] = useState(null)
  const [discountItem, setDiscountItem] = useState(null)
  const [oversellRequest, setOversellRequest] = useState(null)
  // Who authorised selling past the stock count for this sale, if anyone.
  const [oversellApproval, setOversellApproval] = useState(null)
  const [clock, setClock] = useState(() => new Date().toISOString())

  const exhibitionId = sellLocationId
  const cartRef = useRef(cart)
  cartRef.current = cart

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date().toISOString()), 30000)
    return () => clearInterval(timer)
  }, [])

  // A refreshed tab (or a battery-dead tablet) must not lose an in-progress sale.
  useEffect(() => {
    if (!exhibitionId) return
    localStorage.setItem(CART_KEY, JSON.stringify({ exhibitionId, items: cart }))
  }, [cart, exhibitionId])

  useEffect(() => {
    setCart(loadCart(exhibitionId))
  }, [exhibitionId])

  /* ------------------------------------------------------------ catalogue */

  const categories = useMemo(
    () => ['All', ...new Set(state.products.map((product) => product.category))],
    [state.products],
  )

  const recentVariantIds = useMemo(() => {
    const ids = []
    for (const order of state.orders.filter((entry) => entry.exhibitionId === exhibitionId)) {
      for (const item of order.items) if (!ids.includes(item.variantId)) ids.push(item.variantId)
      if (ids.length > 12) break
    }
    return ids
  }, [state.orders, exhibitionId])

  const products = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return state.products
      .filter((product) => product.status === 'Active')
      .map((product) => {
        const variants = product.variants.map((variant) => ({
          ...variant,
          stock: getStock(state, exhibitionId, variant.id),
          // What this stall actually charges, which may not be the list price.
          sellPrice: sellingPrice(variant, exhibitionId),
        }))
        const totalStock = variants.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0)
        const minPrice = Math.min(...variants.map((variant) => variant.sellPrice))
        const listPrice = Math.min(...variants.map((variant) => variant.price))
        return { ...product, variants, totalStock, minPrice, listPrice }
      })
      .filter((product) => {
        if (category === 'Recent') return product.variants.some((v) => recentVariantIds.includes(v.id))
        if (category !== 'All' && product.category !== category) return false
        if (!needle) return true
        return (
          product.name.toLowerCase().includes(needle) ||
          product.category.toLowerCase().includes(needle) ||
          product.collection?.toLowerCase().includes(needle) ||
          product.variants.some(
            (variant) =>
              variant.sku.toLowerCase().includes(needle) ||
              String(variant.barcode).includes(needle) ||
              variant.color.toLowerCase().includes(needle) ||
              variant.size.toLowerCase().includes(needle),
          )
        )
      })
  }, [state, query, category, exhibitionId, recentVariantIds])

  /* ----------------------------------------------------------------- cart */

  // State updaters must stay pure, so stock validation and the toast happen
  // before setCart rather than inside the updater.
  /** Puts a line in the cart, no questions asked. Stock is checked by callers. */
  const putInCart = useCallback((product, variant, quantity) => {
    if (navigator.vibrate) navigator.vibrate(12)
    setCart((current) =>
      current.some((item) => item.variantId === variant.id)
        ? current.map((item) =>
            item.variantId === variant.id ? { ...item, quantity: item.quantity + quantity } : item,
          )
        : [
            {
              productId: product.id,
              variantId: variant.id,
              name: product.name,
              sku: variant.sku,
              category: product.category,
              size: variant.size,
              color: variant.color,
              image: product.image,
              quantity,
              // `listPrice` is kept alongside so the receipt can show what the
              // customer would have paid off the stall.
              listPrice: money(variant.price),
              unitPrice: sellingPrice(variant, exhibitionId),
              lineDiscount: 0,
            },
            ...current,
          ],
    )
  }, [exhibitionId])

  const addVariant = useCallback(
    (product, variant, quantity = 1) => {
      const available = getStock(state, exhibitionId, variant.id)
      const existing = cartRef.current.find((item) => item.variantId === variant.id)
      const nextQty = (existing?.quantity || 0) + quantity

      if (!state.settings.allowOverselling && nextQty > available && !oversellApproval) {
        // Rather than a dead end, offer the authorised way through.
        setOversellRequest({ product, variant, quantity, available, requested: nextQty })
        return
      }

      putInCart(product, variant, quantity)
    },
    [state, exhibitionId, putInCart, oversellApproval],
  )

  const setQuantity = (variantId, quantity) => {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.variantId !== variantId))
      return
    }
    const available = getStock(state, exhibitionId, variantId)
    if (!state.settings.allowOverselling && quantity > available && !oversellApproval) {
      const found = findVariant(state, variantId)
      if (found) {
        setOversellRequest({
          product: found.product,
          variant: found.variant,
          quantity: quantity - (cartRef.current.find((i) => i.variantId === variantId)?.quantity || 0),
          available,
          requested: quantity,
          setTo: quantity,
        })
      }
      return
    }
    setCart((current) =>
      current.map((item) => (item.variantId === variantId ? { ...item, quantity } : item)),
    )
  }

  const clearCart = () => {
    setCart([])
    setOversellApproval(null)
  }

  const applyLineDiscount = (variantId, amount) =>
    setCart((current) =>
      current.map((item) =>
        item.variantId === variantId
          ? { ...item, lineDiscount: Math.max(0, Math.min(amount, item.quantity * item.unitPrice)) }
          : item,
      ),
    )

  const totals = useMemo(
    () => computeTotals(cart, { type: 'percentage', value: 0 }, state.settings),
    [cart, state.settings],
  )

  /* -------------------------------------------------------------- actions */

  const handleProductTap = (product) => {
    if (product.variants.length === 1) {
      addVariant(product, product.variants[0])
      return
    }
    setVariantPick(product)
  }

  const handleScan = useCallback(
    (code) => {
      const match = findByCode(state, code)
      if (!match) {
        actions.toast(`No product matches "${code}"`, 'warn')
        return
      }
      addVariant(match.product, match.variant)
      actions.toast(`${match.product.name} · ${variantLabel(match.variant)} added`, 'success')
    },
    [state, addVariant, actions],
  )

  // A hardware/bluetooth scanner behaves like a keyboard: it types fast and
  // finishes with Enter. Search box handles that natively via onSubmit.
  const submitSearch = (event) => {
    event.preventDefault()
    const code = query.trim()
    if (!code) return
    const match = findByCode(state, code)
    if (match) {
      addVariant(match.product, match.variant)
      setQuery('')
      return
    }
    if (products.length === 1) {
      handleProductTap(products[0])
      setQuery('')
    }
  }

  const onSaleComplete = (order) => {
    setCheckoutOpen(false)
    setCartOpen(false)
    clearCart()
    setCompleted(order)
  }

  /* ----------------------------------------------------------------- view */

  return (
    <div className="pos">
      <div className="pos-left">
        <header className="pos-head">
          {state.settings.business.logo ? (
            <img
              className="brand-logo"
              style={{ height: 26 }}
              src={state.settings.business.logo}
              alt={state.settings.business.name}
            />
          ) : (
            <div className="brand-mark" style={{ width: 34, height: 34, fontSize: 15 }}>
              {state.settings.business.name.slice(0, 1)}
            </div>
          )}
          <div className="grow" style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 650,
                fontSize: 14.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sellLocationName}
            </div>
            <div className="small muted">
              {user.name} · {formatTime(clock)}
              {!activeExhibition && ' · selling from main stock'}
            </div>
          </div>
          <SyncPill />
          <button className="icon-btn" title="Switch exhibition" onClick={() => navigate('/select-exhibition')}>
            <Icon name="chevronUpDown" size={16} />
          </button>
          {can('admin.dashboard') && (
            <button className="icon-btn desktop-only" title="Dashboard" onClick={() => navigate('/admin')}>
              <Icon name="dashboard" size={16} />
            </button>
          )}
        </header>

        <div className="pos-tools">
          <form className="search-row" onSubmit={submitSearch}>
            <button type="button" className="btn btn-primary" onClick={() => setScanOpen(true)}>
              <Icon name="scan" size={16} />
              Scan
            </button>
            <input
              className="input"
              placeholder="Search name, SKU or barcode"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              enterKeyHint="search"
            />
            {query && (
              <button type="button" className="btn btn-ghost" onClick={() => setQuery('')}>
                ✕
              </button>
            )}
          </form>
          <div className="chips">
            {recentVariantIds.length > 0 && (
              <button
                className={`chip ${category === 'Recent' ? 'active' : ''}`}
                onClick={() => setCategory('Recent')}
              >
                ★ Recent
              </button>
            )}
            {categories.map((name) => (
              <button
                key={name}
                className={`chip ${category === name ? 'active' : ''}`}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="product-grid">
          {products.map((product) => {
            const out = product.totalStock <= 0 && !state.settings.allowOverselling
            // An out-of-stock line stays tappable for anyone who could authorise
            // selling it anyway — the modal is where that decision gets made.
            const blocked = out && !can('stock.oversell') && !oversellApproval
            return (
              <button
                key={product.id}
                className={`product-card ${blocked ? 'disabled' : ''}`}
                onClick={() => !blocked && handleProductTap(product)}
                disabled={blocked}
              >
                <Thumb src={product.image} name={product.name} className="product-thumb">
                  <span className="stock-pill">{out ? 'Out' : product.totalStock}</span>
                </Thumb>
                <div className="product-body">
                  <div className="product-name">{product.name}</div>
                  <div className="product-meta">
                    {product.category} · {product.variants.length} option
                    {product.variants.length > 1 ? 's' : ''}
                  </div>
                  <div className="product-price">
                    {currency(product.minPrice)}
                    {product.variants.length > 1 &&
                      Math.max(...product.variants.map((v) => v.sellPrice)) !== product.minPrice && (
                        <span className="small muted"> +</span>
                      )}
                    {product.listPrice > product.minPrice && (
                      <span
                        className="small muted"
                        style={{ textDecoration: 'line-through', marginLeft: 6, fontWeight: 500 }}
                      >
                        {currency(product.listPrice)}
                      </span>
                    )}
                  </div>
                  {out ? (
                    <div className="small" style={{ color: 'var(--danger)' }}>
                      Out of stock
                    </div>
                  ) : (
                    product.totalStock <= state.settings.lowStockThreshold && (
                      <div className="small" style={{ color: 'var(--warn)' }}>
                        Low stock
                      </div>
                    )
                  )}
                </div>
              </button>
            )
          })}
          {products.length === 0 && (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              <h3>Nothing found</h3>
              <p>Try another search term, or scan the product label.</p>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- cart */}
      <aside className={`cart ${cartOpen ? 'open' : ''}`}>
        <div className="cart-head row-between">
          <div>
            <div style={{ fontWeight: 680 }}>Current sale</div>
            <div className="small muted">
              {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}
            </div>
          </div>
          <div className="row">
            {cart.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={clearCart}>
                Clear
              </button>
            )}
            <button className="btn btn-ghost btn-sm mobile-only" onClick={() => setCartOpen(false)}>
              ✕
            </button>
          </div>
        </div>

        <div className="cart-items">
          {cart.length === 0 && (
            <div className="empty" style={{ marginTop: 20 }}>
              <h3>Cart is empty</h3>
              <p>Scan a label or tap a product to begin.</p>
            </div>
          )}
          {cart.map((item) => {
            const gross = item.quantity * item.unitPrice
            const discounted = (item.lineDiscount || 0) > 0
            return (
              <div key={item.variantId} className="cart-item">
                <Thumb src={item.image} name={item.name} />
                <div className="cart-info">
                  <div className="cart-name">{item.name}</div>
                  <div className="cart-var">
                    {[item.color, item.size].filter(Boolean).join(' · ')} · {item.sku}
                  </div>
                  <div className="row-between" style={{ marginTop: 7 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <div className="qty">
                        <button onClick={() => setQuantity(item.variantId, item.quantity - 1)}>−</button>
                        <span>{item.quantity}</span>
                        <button onClick={() => setQuantity(item.variantId, item.quantity + 1)}>+</button>
                      </div>
                      <button
                        className={`btn btn-sm ${discounted ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ padding: '5px 8px' }}
                        title="Discount this line"
                        onClick={() => setDiscountItem(item)}
                      >
                        %
                      </button>
                    </div>
                    <div className="right">
                      <div className="mono" style={{ fontWeight: 680 }}>
                        {currency(gross - (item.lineDiscount || 0))}
                      </div>
                      {discounted ? (
                        <div className="small" style={{ color: 'var(--brand)' }}>
                          <span style={{ textDecoration: 'line-through', color: 'var(--muted-2)' }}>
                            {currency(gross)}
                          </span>{' '}
                          −{currency(item.lineDiscount)}
                        </div>
                      ) : (
                        <div className="small muted">
                          {currency(item.unitPrice)} each
                          {item.listPrice > item.unitPrice && (
                            <span style={{ textDecoration: 'line-through', marginLeft: 5 }}>
                              {currency(item.listPrice)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => setQuantity(item.variantId, 0)}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        <div className="cart-foot">
          <div className="total-line">
            <span>Subtotal</span>
            <span className="mono">{currency(totals.subtotal + totals.lineDiscounts)}</span>
          </div>
          {totals.lineDiscounts > 0 && (
            <div className="total-line" style={{ color: 'var(--brand)' }}>
              <span>Item discounts</span>
              <span className="mono">−{currency(totals.lineDiscounts)}</span>
            </div>
          )}
          {state.settings.taxEnabled && (
            <div className="total-line">
              <span>
                {state.settings.taxInclusive ? 'Includes VAT' : 'VAT'} ({state.settings.taxRate}%)
              </span>
              <span className="mono">{currency(totals.tax)}</span>
            </div>
          )}
          <div className="total-line grand">
            <span>Total</span>
            <span className="mono">{currency(totals.total)}</span>
          </div>
          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={cart.length === 0}
            onClick={() => setCheckoutOpen(true)}
          >
            Proceed to payment
          </button>
        </div>
      </aside>

      {/* --------------------------------------------------- mobile cart bar */}
      {!cartOpen && (
        <div className="pos-mobile-bar">
          <button
            className="btn btn-primary btn-lg btn-block"
            onClick={() => setCartOpen(true)}
            disabled={cart.length === 0}
          >
            <span className="grow" style={{ textAlign: 'left' }}>
              {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}
            </span>
            <span className="mono">{currency(totals.total)}</span>
            <span>›</span>
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ modals */}
      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title="Scan product" subtitle="Barcode or QR label">
        <Suspense
          fallback={
            <div className="scanner-shell" style={{ display: 'grid', placeItems: 'center' }}>
              <div className="spinner" />
            </div>
          }
        >
          {scanOpen && <Scanner onDetected={handleScan} />}
        </Suspense>
        <div className="small muted center">
          Keep scanning to add more items — the cart updates behind this window.
        </div>
      </Modal>

      <VariantPicker
        product={variantPick}
        onClose={() => setVariantPick(null)}
        onPick={(variant, quantity) => {
          addVariant(variantPick, variant, quantity)
          setVariantPick(null)
        }}
      />

      {checkoutOpen && (
        <CheckoutModal
          cart={cart}
          oversellApproval={oversellApproval}
          onClose={() => setCheckoutOpen(false)}
          onComplete={onSaleComplete}
        />
      )}

      <OversellModal
        request={oversellRequest}
        onClose={() => setOversellRequest(null)}
        onApprove={(approver) => {
          setOversellApproval(approver)
          const { product, variant, quantity, setTo } = oversellRequest
          if (setTo) {
            setCart((current) =>
              current.map((item) => (item.variantId === variant.id ? { ...item, quantity: setTo } : item)),
            )
          } else {
            putInCart(product, variant, quantity)
          }
          setOversellRequest(null)
          actions.toast(`Stock limit overridden by ${approver.name}`, 'warn')
        }}
      />

      <LineDiscountModal
        item={discountItem}
        maxPercent={user.maxDiscountPercent ?? state.settings.maxDiscountPercent}
        onClose={() => setDiscountItem(null)}
        onApply={(amount) => {
          applyLineDiscount(discountItem.variantId, amount)
          setDiscountItem(null)
        }}
      />

      {completed && <SaleComplete order={completed} onClose={() => setCompleted(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------ sub-views */

/**
 * Selling past the recorded stock level.
 *
 * The count is often simply wrong at a busy stall — a returned item never went
 * back on the system, or the allocation was mistyped — so this is a decision
 * someone senior takes rather than a wall. Whoever authorises it is named on the
 * sale and in the audit log.
 */
function OversellModal({ request, onClose, onApprove }) {
  const { state, user, roles, can } = useApp()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setPin('')
    setError('')
  }, [request])

  if (!request) return null

  const { product, variant, available, requested } = request
  const selfApprove = can('stock.oversell')

  const approvers = state.users.filter(
    (entry) =>
      entry.active &&
      entry.id !== user.id &&
      roles.find((role) => role.id === entry.role)?.permissions.some((p) => p === '*' || p === 'stock.oversell'),
  )

  const submit = () => {
    const match = approvers.find((entry) => entry.pin === pin.trim())
    if (!match) {
      setError('That PIN does not belong to anyone who can authorise this.')
      return
    }
    onApprove({ id: match.id, name: match.name })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={available <= 0 ? 'Out of stock' : 'Not enough stock'}
      subtitle={`${product.name} · ${variantLabel(variant) || 'Standard'}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {selfApprove ? (
            <button
              className="btn btn-danger"
              onClick={() => onApprove({ id: user.id, name: user.name })}
            >
              Sell anyway
            </button>
          ) : (
            <button className="btn btn-danger" disabled={pin.length < 4} onClick={submit}>
              Authorise
            </button>
          )}
        </>
      }
    >
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="total-line">
          <span>On the system here</span>
          <span className="mono">{available}</span>
        </div>
        <div className="total-line">
          <span>This sale needs</span>
          <span className="mono">{requested}</span>
        </div>
        <div className="total-line grand" style={{ fontSize: 16 }}>
          <span>Short by</span>
          <span className="mono" style={{ color: 'var(--danger)' }}>
            {requested - available}
          </span>
        </div>
      </div>

      {selfApprove ? (
        <p className="small muted" style={{ margin: 0 }}>
          Selling anyway records {user.name} as having authorised it, flags the sale for review and
          leaves the exhibition stock negative until it is counted and corrected.
        </p>
      ) : approvers.length ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            A manager or admin needs to approve this. Their PIN records who authorised it.
          </p>
          <Field label="Authorising PIN">
            <input
              className="input mono"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              maxLength={6}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              onKeyDown={(event) => event.key === 'Enter' && pin.length >= 4 && submit()}
              placeholder="••••"
            />
          </Field>
          {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Nobody with authority to override is set up on this device. Adjust the stock count in
          Inventory instead.
        </p>
      )}
    </Modal>
  )
}

/** Per-line discount, capped at the salesperson's own limit. */
function LineDiscountModal({ item, maxPercent, onClose, onApply }) {
  const currency = useCurrency()
  const [mode, setMode] = useState('percentage')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!item) return
    const gross = item.quantity * item.unitPrice
    const existing = item.lineDiscount || 0
    setMode('percentage')
    setValue(existing ? String(Math.round((existing / gross) * 1000) / 10) : '')
  }, [item])

  if (!item) return null

  const gross = item.quantity * item.unitPrice
  const amount =
    mode === 'percentage' ? money((gross * (Number(value) || 0)) / 100) : money(Number(value) || 0)
  const percent = gross ? (amount / gross) * 100 : 0
  const overLimit = percent > maxPercent + 0.001

  return (
    <Modal
      open
      onClose={onClose}
      title="Discount this item"
      subtitle={`${item.name} · ${item.quantity} × ${currency(item.unitPrice)}`}
      footer={
        <>
          <button className="btn" onClick={() => onApply(0)}>
            Remove discount
          </button>
          <button className="btn btn-primary" disabled={overLimit} onClick={() => onApply(amount)}>
            Apply −{currency(amount)}
          </button>
        </>
      }
    >
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={mode === 'percentage' ? 'active' : ''} onClick={() => { setMode('percentage'); setValue('') }}>
          Percentage
        </button>
        <button className={mode === 'fixed' ? 'active' : ''} onClick={() => { setMode('fixed'); setValue('') }}>
          Fixed amount
        </button>
      </div>

      {mode === 'percentage' && (
        <div className="row wrap" style={{ gap: 8 }}>
          {[5, 10, 15, 20, 25, 50].filter((quick) => quick <= maxPercent).map((quick) => (
            <button
              key={quick}
              className={`chip ${Number(value) === quick ? 'active' : ''}`}
              onClick={() => setValue(String(quick))}
            >
              {quick}%
            </button>
          ))}
        </div>
      )}

      <Field
        label={mode === 'percentage' ? 'Percentage off' : 'Amount off'}
        hint={`Your limit is ${maxPercent}% of the line.`}
      >
        <input
          className="input"
          type="number"
          min="0"
          inputMode="decimal"
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          placeholder="0"
        />
      </Field>

      {overLimit && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {percent.toFixed(1)}% exceeds your {maxPercent}% limit.
        </div>
      )}

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="total-line">
          <span>Line total</span>
          <span className="mono">{currency(gross)}</span>
        </div>
        <div className="total-line">
          <span>Discount</span>
          <span className="mono" style={{ color: amount ? 'var(--brand)' : undefined }}>
            −{currency(amount)}
          </span>
        </div>
        <div className="total-line grand" style={{ fontSize: 17 }}>
          <span>Pays</span>
          <span className="mono">{currency(gross - amount)}</span>
        </div>
      </div>
    </Modal>
  )
}

function VariantPicker({ product, onClose, onPick }) {
  const { state, sellLocationId } = useApp()
  const currency = useCurrency()
  const [quantity, setQuantity] = useState(1)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    setQuantity(1)
    setSelected(null)
  }, [product])

  if (!product) return null

  const variants = product.variants.map((variant) => ({
    ...variant,
    stock: getStock(state, sellLocationId, variant.id),
    sellPrice: sellingPrice(variant, sellLocationId),
    stallPriced: hasExhibitionPrice(variant) && sellingPrice(variant, sellLocationId) !== variant.price,
  }))
  const active = selected ? variants.find((variant) => variant.id === selected) : null
  const max = active ? Math.max(1, active.stock) : 0

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      subtitle={`${product.category} · ${product.collection}`}
      footer={
        active && (
          <>
            <div className="row" style={{ flex: '0 0 auto' }}>
              <div className="qty">
                <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
                <span>{quantity}</span>
                <button onClick={() => setQuantity((q) => Math.min(Math.max(1, max), q + 1))}>+</button>
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => onPick(active, quantity)}>
              Add {quantity} · {currency(active.sellPrice * quantity)}
            </button>
          </>
        )
      }
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Thumb
          src={product.image}
          name={product.name}
          className="cart-thumb"
          style={{ width: 74, height: 74, borderRadius: 14, fontSize: 20 }}
        />
        <div className="small muted">{product.description}</div>
      </div>

      <div className="stack-sm">
        {variants.map((variant) => {
          const out = variant.stock <= 0 && !state.settings.allowOverselling
          return (
            <button
              key={variant.id}
              className="list-item"
              style={{
                opacity: out ? 0.55 : 1,
                borderColor: selected === variant.id ? 'var(--brand)' : 'transparent',
                background: selected === variant.id ? 'var(--brand-soft)' : 'var(--surface-2)',
              }}
              onClick={() => {
                setSelected(variant.id)
                setQuantity(1)
              }}
            >
              <div className="grow">
                <div style={{ fontWeight: 620 }}>{variantLabel(variant) || 'Standard'}</div>
                <div className="small muted mono">{variant.sku}</div>
              </div>
              <div className="right">
                <div style={{ fontWeight: 680 }}>
                  {currency(variant.sellPrice)}
                  {variant.stallPriced && (
                    <span
                      className="small muted"
                      style={{ textDecoration: 'line-through', marginLeft: 6, fontWeight: 500 }}
                    >
                      {currency(variant.price)}
                    </span>
                  )}
                </div>
                <div className="small" style={{ color: out ? 'var(--danger)' : 'var(--muted)' }}>
                  {out ? 'Out of stock' : `${variant.stock} left`}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

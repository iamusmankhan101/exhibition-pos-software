/**
 * Point of sale. Optimised for one-handed use on a tablet at a busy stall:
 * scan or tap → cart → checkout wizard → receipt.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { computeTotals, findByCode, findVariant, getStock } from '../../lib/domain.js'
import { formatTime, variantLabel } from '../../lib/format.js'
import { Modal, SyncPill, Thumb } from '../../components/ui.jsx'
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
  const { state, user, activeExhibition, actions, can } = useApp()
  const currency = useCurrency()
  const navigate = useNavigate()

  const [cart, setCart] = useState(() => loadCart(activeExhibition?.id))
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [scanOpen, setScanOpen] = useState(false)
  const [variantPick, setVariantPick] = useState(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [completed, setCompleted] = useState(null)
  const [clock, setClock] = useState(() => new Date().toISOString())

  const exhibitionId = activeExhibition?.id
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
        }))
        const totalStock = variants.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0)
        const minPrice = Math.min(...variants.map((variant) => variant.price))
        return { ...product, variants, totalStock, minPrice }
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
  const addVariant = useCallback(
    (product, variant, quantity = 1) => {
      const available = getStock(state, exhibitionId, variant.id)
      const existing = cartRef.current.find((item) => item.variantId === variant.id)
      const nextQty = (existing?.quantity || 0) + quantity

      if (!state.settings.allowOverselling && nextQty > available) {
        actions.toast(
          available <= 0 ? `${product.name} is out of stock` : `Only ${available} left of ${product.name}`,
          'warn',
        )
        return
      }

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
                size: variant.size,
                color: variant.color,
                image: product.image,
                quantity,
                unitPrice: variant.price,
                lineDiscount: 0,
              },
              ...current,
            ],
      )
    },
    [state, exhibitionId, actions],
  )

  const setQuantity = (variantId, quantity) => {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.variantId !== variantId))
      return
    }
    const available = getStock(state, exhibitionId, variantId)
    if (!state.settings.allowOverselling && quantity > available) {
      actions.toast(`Only ${available} available`, 'warn')
      return
    }
    setCart((current) =>
      current.map((item) => (item.variantId === variantId ? { ...item, quantity } : item)),
    )
  }

  const clearCart = () => setCart([])

  const totals = useMemo(
    () => computeTotals(cart, { type: 'percentage', value: 0 }, state.settings),
    [cart, state.settings],
  )

  /* -------------------------------------------------------------- actions */

  const handleProductTap = (product) => {
    const sellable = product.variants.filter((variant) => variant.stock > 0 || state.settings.allowOverselling)
    if (sellable.length === 1 && product.variants.length === 1) {
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

  if (!activeExhibition) {
    return (
      <div className="boot">
        <p>No exhibition selected.</p>
        <button className="btn btn-primary" onClick={() => navigate('/select-exhibition')}>
          Choose an exhibition
        </button>
      </div>
    )
  }

  return (
    <div className="pos">
      <div className="pos-left">
        <header className="pos-head">
          <div className="brand-mark" style={{ width: 34, height: 34, fontSize: 15 }}>
            {state.settings.business.logo ? (
              <img src={state.settings.business.logo} alt="" />
            ) : (
              state.settings.business.name.slice(0, 1)
            )}
          </div>
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
              {activeExhibition.name}
            </div>
            <div className="small muted">
              {user.name} · {formatTime(clock)}
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
            return (
              <button
                key={product.id}
                className={`product-card ${out ? 'disabled' : ''}`}
                onClick={() => !out && handleProductTap(product)}
                disabled={out}
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
                      Math.max(...product.variants.map((v) => v.price)) !== product.minPrice && (
                        <span className="small muted"> +</span>
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
          {cart.map((item) => (
            <div key={item.variantId} className="cart-item">
              <Thumb src={item.image} name={item.name} />
              <div className="cart-info">
                <div className="cart-name">{item.name}</div>
                <div className="cart-var">
                  {[item.color, item.size].filter(Boolean).join(' · ')} · {item.sku}
                </div>
                <div className="row-between" style={{ marginTop: 7 }}>
                  <div className="qty">
                    <button onClick={() => setQuantity(item.variantId, item.quantity - 1)}>−</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => setQuantity(item.variantId, item.quantity + 1)}>+</button>
                  </div>
                  <div className="right">
                    <div className="mono" style={{ fontWeight: 680 }}>
                      {currency(item.quantity * item.unitPrice)}
                    </div>
                    <div className="small muted">{currency(item.unitPrice)} each</div>
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
          ))}
        </div>

        <div className="cart-foot">
          <div className="total-line">
            <span>Subtotal</span>
            <span className="mono">{currency(totals.subtotal)}</span>
          </div>
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
          onClose={() => setCheckoutOpen(false)}
          onComplete={onSaleComplete}
        />
      )}

      {completed && <SaleComplete order={completed} onClose={() => setCompleted(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------ sub-views */

function VariantPicker({ product, onClose, onPick }) {
  const { state, activeExhibition } = useApp()
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
    stock: getStock(state, activeExhibition.id, variant.id),
  }))
  const active = selected ? variants.find((variant) => variant.id === selected) : null
  const max = active ? active.stock : 0

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
              Add {quantity} · {currency(active.price * quantity)}
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
              disabled={out}
              style={{
                opacity: out ? 0.45 : 1,
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
                <div style={{ fontWeight: 680 }}>{currency(variant.price)}</div>
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

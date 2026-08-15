import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/store.jsx'
import { Avatar } from '../components/ui.jsx'

export default function Login() {
  const { state, actions, user } = useApp()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (user) navigate(user.role === 'salesperson' ? '/pos' : '/admin', { replace: true })
  }, [user, navigate])

  const staff = state.users.filter((entry) => entry.active)
  const logo = state.settings.business.logo

  const submit = (value) => {
    try {
      const account = actions.login(selected.id, value)
      navigate(account.role === 'salesperson' ? '/pos' : '/admin', { replace: true })
    } catch (err) {
      setError(err.message)
      setPin('')
      if (navigator.vibrate) navigator.vibrate([40, 60, 40])
    }
  }

  const press = (digit) => {
    setError('')
    const next = `${pin}${digit}`.slice(0, 4)
    setPin(next)
    if (next.length === 4) setTimeout(() => submit(next), 120)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          {logo ? <img src={logo} alt="" /> : state.settings.business.name.slice(0, 1)}
        </div>
        <h1 className="center" style={{ fontSize: 22 }}>
          {state.settings.business.name}
        </h1>
        <p className="center muted small" style={{ margin: '4px 0 22px' }}>
          Exhibition POS &amp; Inventory
        </p>

        <div className="card">
          {!selected ? (
            <>
              <div className="card-head">
                <div className="card-title">Who is signing in?</div>
              </div>
              <div className="staff-list">
                {staff.map((account) => (
                  <button key={account.id} className="staff-btn" onClick={() => setSelected(account)}>
                    <Avatar name={account.name} size={38} />
                    <div className="grow">
                      <div style={{ fontWeight: 620 }}>{account.name}</div>
                      <div className="small muted" style={{ textTransform: 'capitalize' }}>
                        {account.role}
                      </div>
                    </div>
                    <span className="muted">›</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 16 }}>
                <Avatar name={selected.name} size={40} />
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>{selected.name}</div>
                  <div className="small muted" style={{ textTransform: 'capitalize' }}>
                    {selected.role}
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSelected(null)
                    setPin('')
                    setError('')
                  }}
                >
                  Change
                </button>
              </div>

              <div className="pin-dots">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className={`pin-dot ${pin.length > index ? 'filled' : ''}`} />
                ))}
              </div>

              {error && (
                <p className="center small" style={{ color: 'var(--danger)', marginTop: 0, marginBottom: 12 }}>
                  {error}
                </p>
              )}

              <div className="keypad">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <button key={digit} onClick={() => press(digit)}>
                    {digit}
                  </button>
                ))}
                <button onClick={() => setPin('')}>C</button>
                <button onClick={() => press(0)}>0</button>
                <button onClick={() => setPin((current) => current.slice(0, -1))}>⌫</button>
              </div>
            </>
          )}
        </div>

        <p className="center small muted" style={{ marginTop: 18, lineHeight: 1.7 }}>
          Demo PINs — Admin 1111 · Manager 2222 · Ahmed 3333 · Layla 4444
        </p>
      </div>
    </div>
  )
}

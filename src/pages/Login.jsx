/**
 * Authentication: email + password for real accounts, plus a PIN keypad for
 * fast switching between staff on a shared stall device.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/store.jsx'
import { Avatar, Field } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

export default function Login() {
  const { state, actions, user, can } = useApp()
  const navigate = useNavigate()

  const isFirstRun = state.users.length === 0
  const [mode, setMode] = useState(isFirstRun ? 'signup' : 'signin')

  useEffect(() => {
    if (user) navigate(can('admin.dashboard') ? '/admin' : '/pos', { replace: true })
  }, [user, navigate, can])

  const logo = state.settings.business.logo

  return (
    <div className="login-screen">
      <div className="login-split">
        <Pitch logo={logo} name={state.settings.business.name} />

        <div className="login-form-pane">
          <div className="login-card">
            {isFirstRun ? (
              <>
                <h1 className="center" style={{ marginBottom: 4 }}>
                  Set up <strong>{state.settings.business.name}</strong>
                </h1>
                <p className="center muted small" style={{ margin: '0 0 20px' }}>
                  This first account gets full admin access.
                </p>
                <SignUp firstRun />
              </>
            ) : (
              <>
                <h1 className="center" style={{ marginBottom: 20 }}>
                  {mode === 'signup' ? (
                    <>Create your <strong>account</strong></>
                  ) : (
                    <>Sign in to <strong>{state.settings.business.name}</strong></>
                  )}
                </h1>

                <div className="seg" style={{ display: 'flex', width: '100%', marginBottom: 16 }}>
                  <button className={`grow ${mode === 'signin' ? 'active' : ''}`} onClick={() => setMode('signin')}>
                    Sign in
                  </button>
                  <button className={`grow ${mode === 'pin' ? 'active' : ''}`} onClick={() => setMode('pin')}>
                    Staff PIN
                  </button>
                  {state.settings.signup?.enabled && (
                    <button className={`grow ${mode === 'signup' ? 'active' : ''}`} onClick={() => setMode('signup')}>
                      Sign up
                    </button>
                  )}
                </div>

                {mode === 'signin' && <SignIn />}
                {mode === 'pin' && <PinPad />}
                {mode === 'signup' && <SignUp onDone={() => setMode('signin')} />}

                {mode !== 'pin' && (
                  <button className="login-alt" onClick={() => setMode(mode === 'signup' ? 'signin' : 'pin')}>
                    {mode === 'signup' ? (
                      <>Already have an account? <b>Sign in</b></>
                    ) : (
                      <>Sharing a device? <b>Use your staff PIN</b></>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- pitch */

/**
 * The left half. Purely presentational, and hidden below 900px — on a phone at
 * a stall the form should have the whole screen rather than sit under a pitch
 * the person reading it has already been sold on.
 */
function Pitch({ logo, name }) {
  return (
    <div className="login-pitch">
      <div className="login-pitch-brand">
        <div className="login-mark">{logo ? <img src={logo} alt="" /> : name.slice(0, 1)}</div>
        <span style={{ fontWeight: 750, fontSize: 17, letterSpacing: '-0.02em' }}>{name}</span>
      </div>

      <h2>
        Take the till <strong>anywhere you sell</strong>.
      </h2>

      <div className="login-pitch-stats">
        <div><b>30–60s</b> from scan to receipt</div>
        <div><b>Offline-first</b> — no signal needed to trade</div>
      </div>

      <div className="login-pitch-rule" />

      <div className="login-pitch-list">
        <div>
          <span className="login-pitch-icon"><Icon name="box" size={14} /></span>
          <span><b>Stock per stand</b>, never mixed with the warehouse</span>
        </div>
        <div>
          <span className="login-pitch-icon"><Icon name="card" size={14} /></span>
          <span><b>Split and part payments</b>, reconciled per till</span>
        </div>
        <div>
          <span className="login-pitch-icon"><Icon name="trend" size={14} /></span>
          <span><b>Live sales</b> on the owner's phone</span>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- sign in */

function SignIn() {
  const { actions } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await actions.signIn(email, password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card col" onSubmit={submit}>
      <Field label="Email">
        <input
          className="input"
          type="email"
          value={email}
          autoComplete="username"
          autoFocus
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@business.com"
        />
      </Field>

      <Field label="Password">
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            style={{ paddingRight: 44 }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ position: 'absolute', right: 4, top: 4 }}
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      {error && (
        <div className="small" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  )
}

/* --------------------------------------------------------------- sign up */

function SignUp({ onDone, firstRun = false }) {
  const { state, actions } = useApp()
  const [draft, setDraft] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (draft.password !== draft.confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await actions.signUp(draft)
      if (result.pending) setPending(result.account)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (pending) {
    return (
      <div className="col center" style={{ padding: '10px 0' }}>
        <div
          style={{
            width: 54,
            height: 54,
            margin: '0 auto',
            borderRadius: '50%',
            background: 'var(--warn-soft)',
            color: 'var(--warn)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name="alert" size={24} />
        </div>
        <div style={{ fontWeight: 650 }}>Account created — awaiting approval</div>
        <p className="small muted" style={{ margin: 0 }}>
          An admin needs to approve {pending.email} before you can sign in. Your staff PIN will be{' '}
          <strong>{pending.pin}</strong>.
        </p>
        <button className="btn btn-block" onClick={onDone}>
          Back to sign in
        </button>
      </div>
    )
  }

  const roleName =
    state.roles.find((role) => role.id === state.settings.signup?.defaultRole)?.name || 'Salesperson'

  const body = (
    <>
      <Field label="Full name">
        <input
          className="input"
          value={draft.name}
          autoFocus
          autoComplete="name"
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Amina Hassan"
        />
      </Field>

      <Field label="Email">
        <input
          className="input"
          type="email"
          value={draft.email}
          autoComplete="username"
          onChange={(event) => patch({ email: event.target.value })}
          placeholder="you@business.com"
        />
      </Field>

      <Field label="Password" hint="At least 8 characters, with a letter and a number.">
        <input
          className="input"
          type="password"
          value={draft.password}
          autoComplete="new-password"
          onChange={(event) => patch({ password: event.target.value })}
        />
      </Field>

      <Field label="Confirm password">
        <input
          className="input"
          type="password"
          value={draft.confirm}
          autoComplete="new-password"
          onChange={(event) => patch({ confirm: event.target.value })}
        />
      </Field>

      {error && (
        <div className="small" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {!firstRun && (
        <p className="small muted" style={{ margin: 0 }}>
          New accounts are created as <strong>{roleName}</strong>
          {state.settings.signup?.requireApproval ? ' and need an admin to approve them.' : '.'}
        </p>
      )}

      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
        {busy ? 'Creating…' : firstRun ? 'Create owner account' : 'Create account'}
      </button>
    </>
  )

  return firstRun ? (
    <form className="col" onSubmit={submit}>
      {body}
    </form>
  ) : (
    <form className="card col" onSubmit={submit}>
      {body}
    </form>
  )
}

/* ------------------------------------------------------------------ PIN */

function PinPad() {
  const { state, actions } = useApp()
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  const staff = state.users.filter((entry) => entry.active)

  const submit = async (value) => {
    try {
      await actions.login(selected.id, value)
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
                    {state.roles.find((role) => role.id === account.role)?.name || account.role}
                  </div>
                </div>
                <Icon name="chevronRight" size={16} />
              </button>
            ))}
            {staff.length === 0 && (
              <p className="small muted center" style={{ margin: 0 }}>
                No active accounts yet.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <Avatar name={selected.name} size={40} />
            <div className="grow">
              <div style={{ fontWeight: 650 }}>{selected.name}</div>
              <div className="small muted">
                {state.roles.find((role) => role.id === selected.role)?.name || selected.role}
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
  )
}

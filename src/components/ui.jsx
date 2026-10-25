import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { APP_NAME, AVATARS } from '../../shared/constants.js'
import { cx } from '../lib/cx.js'
import { buzz } from '../lib/device.js'
import { useI18n } from '../lib/i18n.jsx'

export function Logo({ size = 'md' }) {
  return (
    <span className={cx('logo', `logo-${size}`)} aria-label={APP_NAME}>
      Sinverg<span className="logo-u">ü</span>enzas
    </span>
  )
}

const FLAG_COLORS = ['#ff4d8d', '#ffb627', '#19d3c5', '#8c5cff', '#a3e635', '#ff6b35', '#38bdf8', '#f472b6']

// Papel picado garland: flags with cut-out patterns hanging from a string.
export function PapelPicado() {
  const flags = FLAG_COLORS.map((color, i) => {
    const x = 4 + i * 44.5
    const t = (x + 20) / 360
    const y = 5 + 32 * t * (1 - t)
    return { color, x, y, i }
  })
  return (
    <svg className="papel-picado" viewBox="0 0 360 70" aria-hidden="true">
      <defs>
        <mask id="pp-cut" maskContentUnits="objectBoundingBox">
          <rect width="1" height="1" fill="#fff" />
          <polygon points="0.5,0.24 0.64,0.43 0.5,0.62 0.36,0.43" fill="#000" />
          <circle cx="0.2" cy="0.18" r="0.06" fill="#000" />
          <circle cx="0.8" cy="0.18" r="0.06" fill="#000" />
          <circle cx="0.2" cy="0.66" r="0.06" fill="#000" />
          <circle cx="0.8" cy="0.66" r="0.06" fill="#000" />
          <rect x="0.46" y="0.06" width="0.08" height="0.08" transform="rotate(45 0.5 0.1)" fill="#000" />
          <rect x="0.46" y="0.74" width="0.08" height="0.08" transform="rotate(45 0.5 0.78)" fill="#000" />
        </mask>
      </defs>
      <path d="M0 5 Q180 37 360 5" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
      {flags.map((f) => (
        <g key={f.i} className="pp-flag" style={{ animationDelay: `${(f.i % 4) * -0.7}s` }}>
          <path
            d={`M${f.x} ${f.y} h40 v42 l-5 6 l-5 -6 l-5 6 l-5 -6 l-5 6 l-5 -6 l-5 6 l-5 -6 Z`}
            fill={f.color}
            mask="url(#pp-cut)"
          />
        </g>
      ))}
    </svg>
  )
}

export function Avatar({ player, size = 40, className }) {
  return (
    <span
      className={cx('avatar', player.online === false && 'is-offline', className)}
      style={{ '--c': player.color || '#8c5cff', '--s': `${size}px` }}
      aria-hidden="true"
    >
      {player.avatar}
    </span>
  )
}

export function AvatarPicker({ value, onChange }) {
  return (
    <div className="avatar-grid" role="radiogroup">
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={a === value}
          className={cx('avatar-opt', a === value && 'is-on')}
          onClick={() => {
            buzz(6)
            onChange(a)
          }}
        >
          {a}
        </button>
      ))}
    </div>
  )
}

let openSheets = 0

export function Sheet({ open, onClose, title, children, footer }) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    openSheets += 1
    document.body.classList.add('no-scroll')
    return () => {
      document.removeEventListener('keydown', onKey)
      openSheets -= 1
      if (!openSheets) document.body.classList.remove('no-scroll')
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title && (
          <header className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
              ✕
            </button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={cx('toggle-row', disabled && 'is-disabled')}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          buzz(6)
          onChange(e.target.checked)
        }}
      />
    </label>
  )
}

export function Segmented({ value, options, onChange, disabled, format = String, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={cx('seg', o === value && 'is-on')}
          disabled={disabled}
          onClick={() => {
            buzz(6)
            onChange(o)
          }}
        >
          {format(o)}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  )
}

export function useNow(interval = 1000, active = true) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval, active])
  return now
}

export function Countdown({ deadline, serverNow, total }) {
  useNow(250)
  const ms = deadline - serverNow()
  const left = Math.max(0, Math.ceil(ms / 1000))
  const frac = total ? Math.max(0, Math.min(1, ms / (total * 1000))) : 0
  return (
    <span className={cx('countdown', left <= 10 && 'is-urgent')} style={{ '--p': frac }}>
      <span className="countdown-ring" />
      {left}s
    </span>
  )
}

// The QR library is only needed when someone opens the QR sheet.
export function QrCode({ text }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    import('uqr').then(({ renderSVG }) => {
      if (alive) setSvg(renderSVG(text, { border: 2, whiteColor: '#fffaf0', blackColor: '#15111f' }))
    })
    return () => {
      alive = false
    }
  }, [text])
  return <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
}

export function BottomBar({ children }) {
  return <div className="bottom-bar">{children}</div>
}

export function Spinner({ label }) {
  return (
    <div className="spinner-wrap" role="status">
      <div className="spinner">
        <span />
        <span />
      </div>
      {label && <p>{label}</p>}
    </div>
  )
}

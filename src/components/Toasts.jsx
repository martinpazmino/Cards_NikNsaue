import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { cx } from '../lib/cx.js'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((text, { tone = 'info', ms = 2400 } = {}) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((list) => [...list.filter((x) => x.text !== text).slice(-1), { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), ms)
  }, [])

  // toast(text) shows a message; toast.clear() drops what is on screen.
  const toast = useMemo(() => Object.assign((...args) => show(...args), { clear: () => setToasts([]) }), [show])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={cx('toast', `toast-${x.tone}`)}>
            {x.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

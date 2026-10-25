import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { STRINGS } from './strings.js'
import { storage } from './storage.js'

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => (storage.profile()?.lang === 'en' ? 'en' : 'es'))

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next) => {
    setLangState(next)
    storage.setProfile({ lang: next })
  }, [])

  const t = useCallback(
    (key, vars) => {
      const s = STRINGS[lang][key] ?? STRINGS.es[key] ?? key
      return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s
    },
    [lang],
  )

  const errorText = useCallback((code) => STRINGS[lang][`err.${code}`] ?? STRINGS[lang]['err.default'], [lang])

  const value = useMemo(() => ({ lang, setLang, t, errorText }), [lang, setLang, t, errorText])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)

// count(t, 3, 'cards') -> "3 cartas"; singular/plural keys live under count.*
export const count = (t, n, noun) => t(`count.${noun}.${n === 1 ? 'one' : 'other'}`, { n })
export const points = (t, n) => count(t, n, 'points')

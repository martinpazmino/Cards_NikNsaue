import { useEffect, useMemo, useRef, useState } from 'react'
import { AVATARS, ROOM_CODE_ALPHABET } from '../../shared/constants.js'
import { AnswerCard, PromptCard } from '../components/Cards.jsx'
import { useToast } from '../components/Toasts.jsx'
import { AvatarPicker, Logo, PapelPicado, Sheet } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { buzz } from '../lib/device.js'
import { count, useI18n } from '../lib/i18n.jsx'
import { primeRoom } from '../lib/primed.js'
import { navigate } from '../lib/router.js'
import { storage } from '../lib/storage.js'

const HERO = [
  { p: 'Mi abuela no confía en los bancos. Por eso guarda todos sus ahorros en ___.', a: 'un Tupperware lleno de frijoles' },
  { p: '¿Qué cura el Vicks VapoRub que la ciencia todavía no puede explicar?', a: 'el mal de ojo' },
  { p: 'Lo que realmente estaba dentro de la piñata: ___.', a: 'el tío borracho que siempre quiere bailar' },
  { p: 'Mi mamá me amenazó con ___ si no limpiaba mi cuarto.', a: 'la chancla voladora de mi mamá' },
]

export function LangToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div className="lang-toggle" role="radiogroup" aria-label="Idioma / Language">
      {['es', 'en'].map((l) => (
        <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? 'is-on' : ''} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export function HowToPlay({ open, onClose }) {
  const { t } = useI18n()
  return (
    <Sheet open={open} onClose={onClose} title={t('how.title')}>
      <ol className="how">
        {[1, 2, 3, 4].map((n) => (
          <li key={n}>
            <span className="how-n">{n}</span>
            <div>
              <h3>{t(`how.${n}.title`)}</h3>
              <p>{t(`how.${n}.text`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="tip">{t('how.tip')}</p>
    </Sheet>
  )
}

export function useProfile() {
  const [profile, setProfile] = useState(() => {
    const p = storage.profile() || {}
    return { name: p.name || '', avatar: p.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)] }
  })
  const update = (patch) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch }
      storage.setProfile({ name: next.name, avatar: next.avatar })
      return next
    })
  }
  return [profile, update]
}

export function ProfileFields({ profile, update, nameRef }) {
  const { t } = useI18n()
  const [picker, setPicker] = useState(false)
  return (
    <div className="profile">
      <label className="label" htmlFor="nick">
        {t('home.yourName')}
      </label>
      <div className="profile-row">
        <button type="button" className="avatar-btn" onClick={() => setPicker(true)} aria-label={t('home.pickAvatar')}>
          {profile.avatar}
          <span className="avatar-btn-edit">✎</span>
        </button>
        <input
          id="nick"
          ref={nameRef}
          className="input"
          value={profile.name}
          maxLength={16}
          autoComplete="nickname"
          placeholder={t('home.namePlaceholder')}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>
      <Sheet open={picker} onClose={() => setPicker(false)} title={t('home.pickAvatar')}>
        <AvatarPicker
          value={profile.avatar}
          onChange={(avatar) => {
            update({ avatar })
            setPicker(false)
          }}
        />
      </Sheet>
    </div>
  )
}

export default function Home() {
  const { t, errorText } = useI18n()
  const toast = useToast()
  const [profile, update] = useProfile()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [how, setHow] = useState(false)
  const [deckChoice, setDeckChoice] = useState(false)
  const [decksOpen, setDecksOpen] = useState(false)
  const nameRef = useRef(null)
  const hero = useMemo(() => HERO[Math.floor(Math.random() * HERO.length)], [])
  const decks = storage.decks()
  const recent = storage.recentRooms().slice(0, 2)
  const [setupProblem, setSetupProblem] = useState(null)

  // A deploy without a working database can't host rooms: say how to fix it.
  useEffect(() => {
    api.health().catch((e) => {
      if (e.code === 'STORE_NOT_CONFIGURED' || e.code === 'STORE_UNREACHABLE') setSetupProblem(e.code)
    })
  }, [])

  function needName() {
    if (profile.name.trim()) return false
    toast(t('home.nameFirst'))
    nameRef.current?.focus()
    return true
  }

  async function enter(promise, roomCode) {
    setBusy(true)
    try {
      const res = await promise()
      const c = res.code || roomCode
      storage.setSession(c, res)
      primeRoom(c, res.state)
      buzz(12)
      navigate(`/${c}`)
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  function create(deckId) {
    setDeckChoice(false)
    enter(() => api.createRoom({ name: profile.name, avatar: profile.avatar, deckId }))
  }

  function onCreate() {
    if (needName()) return
    if (decks.length) setDeckChoice(true)
    else create()
  }

  function onJoin(e) {
    e.preventDefault()
    const c = code.toUpperCase()
    if (c.length !== 4) return
    if (storage.session(c)) return navigate(`/${c}`)
    if (needName()) return
    enter(() => api.join(c, { name: profile.name, avatar: profile.avatar }), c)
  }

  async function newDeck() {
    if (needName()) return
    try {
      const deck = await api.createDeck({ name: t('deck.defaultName', { name: profile.name.trim() }) })
      storage.rememberDeck({ id: deck.id, name: deck.name, count: 0 })
      navigate(`/m/${deck.id}`)
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    }
  }

  return (
    <main className="screen home">
      <PapelPicado />
      <div className="home-top">
        <LangToggle />
      </div>
      <header className="hero">
        <Logo size="xl" />
        <p className="tagline">{t('app.tagline')}</p>
        <div className="hero-cards" aria-hidden="true">
          <PromptCard prompt={{ text: hero.p, pick: 1 }} className="hero-prompt" />
          <AnswerCard card={{ text: hero.a }} className="hero-answer" />
        </div>
      </header>

      {setupProblem && (
        <section className="notice">
          <strong>{t('setup.title')}</strong>
          <p>{t(setupProblem === 'STORE_UNREACHABLE' ? 'setup.unreachable' : 'setup.text')}</p>
        </section>
      )}

      <section className="panel">
        <ProfileFields profile={profile} update={update} nameRef={nameRef} />
        <button type="button" className="btn btn-primary btn-big" onClick={onCreate} disabled={busy}>
          {t('home.create')} 🎉
        </button>
        <div className="divider">
          <span>{t('home.or')}</span>
        </div>
        <form className="join-row" onSubmit={onJoin}>
          <input
            className="input code-input"
            value={code}
            onChange={(e) =>
              setCode(
                [...e.target.value.toUpperCase()].filter((ch) => ROOM_CODE_ALPHABET.includes(ch)).join('').slice(0, 4),
              )
            }
            placeholder={t('home.codePlaceholder')}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            aria-label={t('home.joinTitle')}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy || code.length !== 4}>
            {t('home.join')}
          </button>
        </form>
        {recent.length > 0 && (
          <div className="chips rejoin">
            {recent.map((r) => (
              <button key={r.code} type="button" className="chip chip-strong" onClick={() => navigate(`/${r.code}`)}>
                ↩︎ {t('home.rejoin', { code: r.code })}
              </button>
            ))}
          </div>
        )}
      </section>

      <nav className="home-links">
        <button type="button" className="link-btn" onClick={() => setHow(true)}>
          📖 {t('home.howTo')}
        </button>
        <button type="button" className="link-btn" onClick={() => setDecksOpen(true)}>
          🃏 {t('home.myDecks')}
        </button>
      </nav>

      <HowToPlay open={how} onClose={() => setHow(false)} />

      <Sheet open={deckChoice} onClose={() => setDeckChoice(false)} title={t('home.chooseDeck')}>
        <div className="choice-list">
          <button type="button" className="choice" onClick={() => create()}>
            <span className="choice-icon">✨</span>
            <span>
              <strong>{t('home.freshDeck')}</strong>
              <small>{t('home.freshDeckHint')}</small>
            </span>
          </button>
          {decks.map((d) => (
            <button key={d.id} type="button" className="choice" onClick={() => create(d.id)}>
              <span className="choice-icon">🃏</span>
              <span>
                <strong>{d.name}</strong>
                <small>{count(t, d.count ?? 0, 'cards')}</small>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={decksOpen} onClose={() => setDecksOpen(false)} title={t('home.myDecks')}>
        <p className="muted">{t('home.deckHint')}</p>
        <div className="choice-list">
          {decks.map((d) => (
            <button key={d.id} type="button" className="choice" onClick={() => navigate(`/m/${d.id}`)}>
              <span className="choice-icon">🃏</span>
              <span>
                <strong>{d.name}</strong>
                <small>{count(t, d.count ?? 0, 'cards')}</small>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary" onClick={newDeck}>
          + {t('home.newDeck')}
        </button>
      </Sheet>
    </main>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { CardWriter } from '../components/CardWriter.jsx'
import { WhatsAppIcon } from '../components/RoomParts.jsx'
import { useToast } from '../components/Toasts.jsx'
import { Logo, PapelPicado, Sheet, Spinner } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { cx } from '../lib/cx.js'
import { copyText, share, whatsappUrl } from '../lib/device.js'
import { count, useI18n } from '../lib/i18n.jsx'
import { primeRoom } from '../lib/primed.js'
import { deckUrl, navigate } from '../lib/router.js'
import { storage } from '../lib/storage.js'
import { ProfileFields, useProfile } from './Home.jsx'

const sameName = (a, b) => (a || '').toLocaleLowerCase('es') === (b || '').toLocaleLowerCase('es')

export default function DeckPage({ id }) {
  const { t, errorText } = useI18n()
  const toast = useToast()
  const [profile, update] = useProfile()
  const [deck, setDeck] = useState(null)
  const [missing, setMissing] = useState(false)
  const [spoilers, setSpoilers] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => {
    api
      .deck(id)
      .then(setDeck)
      .catch((e) => (e.status === 404 ? setMissing(true) : toast(errorText(e.code), { tone: 'error' })))
  }, [id, toast, errorText])

  useEffect(() => {
    if (deck) storage.rememberDeck({ id: deck.id, name: deck.name, count: deck.cards.length })
  }, [deck])

  const counts = useMemo(
    () => ({ p: deck?.cards.filter((c) => c.t === 'p').length ?? 0, a: deck?.cards.filter((c) => c.t === 'a').length ?? 0 }),
    [deck],
  )
  const mine = useMemo(() => (deck?.cards || []).filter((c) => sameName(c.by, profile.name)).reverse(), [deck, profile.name])
  const names = useMemo(() => [...new Set((deck?.cards || []).map((c) => c.by).filter(Boolean))], [deck])

  async function act(body) {
    const next = await api.deckAction(id, body)
    setDeck(next)
    return next
  }

  function needName() {
    if (profile.name.trim()) return false
    toast(t('home.nameFirst'))
    nameRef.current?.focus()
    return true
  }

  async function play() {
    if (needName()) return
    setBusy(true)
    try {
      const res = await api.createRoom({ name: profile.name, avatar: profile.avatar, deckId: id })
      storage.setSession(res.code, res)
      primeRoom(res.code, res.state)
      navigate(`/${res.code}`)
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (missing) {
    return (
      <main className="screen">
        <PapelPicado />
        <div className="empty-state">
          <p className="big-emoji">🃏❓</p>
          <p>{t('deck.notFound')}</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
            {t('join.goHome')}
          </button>
        </div>
      </main>
    )
  }
  if (!deck) return <Spinner label={t('common.loading')} />

  const url = deckUrl(id)
  const inviteText = `${deck.name} · ${t('deck.shareHint')}`

  return (
    <main className="screen deck">
      <PapelPicado />
      <header className="lobby-head">
        <button type="button" className="link-btn" onClick={() => navigate('/')}>
          ← <Logo size="sm" />
        </button>
      </header>

      <section className="code-block">
        <p className="label">{t('deck.title')}</p>
        <h1 className="deck-name">
          {deck.name}{' '}
          <button
            type="button"
            className="icon-btn"
            aria-label={t('deck.rename')}
            onClick={() => {
              setNewName(deck.name)
              setRenaming(true)
            }}
          >
            ✎
          </button>
        </h1>
        <p className="muted">
          {count(t, counts.p, 'prompts')} · {count(t, counts.a, 'answers')}
        </p>
        <p className="small">{t('deck.shareHint')}</p>
        <div className="invite-row">
          <a className="btn btn-whatsapp" href={whatsappUrl(`${inviteText} ${url}`)} target="_blank" rel="noreferrer">
            <WhatsAppIcon /> WhatsApp
          </a>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              const r = await share({ title: deck.name, text: inviteText, url })
              if (r === 'copied') toast(t('common.copied'))
            }}
          >
            ↗ {t('common.share')}
          </button>
        </div>
        <button type="button" className="btn btn-primary btn-big" disabled={busy} onClick={play}>
          🎉 {t('deck.playWith')}
        </button>
      </section>

      <section className="panel">
        <ProfileFields profile={profile} update={update} nameRef={nameRef} />
        <p className="small muted">
          {t('writer.by')}: <strong>{profile.name || '…'}</strong>
        </p>
        <CardWriter
          names={names}
          mine={mine}
          onAdd={(type, text) => {
            if (needName()) return Promise.reject(Object.assign(new Error(), { code: 'NAME_REQUIRED' }))
            return act({ type: 'add', t: type, text, by: profile.name })
          }}
          onRemove={(cardId) => act({ type: 'remove', id: cardId })}
        />
      </section>

      <section className="panel">
        <button type="button" className="btn btn-ghost" onClick={() => setSpoilers((v) => !v)}>
          {spoilers ? t('deck.hide') : t('deck.spoilers')}
        </button>
        {spoilers &&
          (deck.cards.length ? (
            <ul className="mine-list">
              {deck.cards.map((c) => (
                <li key={c.id} className={cx('mine-card', c.t === 'p' ? 'is-prompt' : 'is-answer')}>
                  <span>
                    {c.text}
                    {c.by && <small className="muted"> — {t('deck.by', { name: c.by })}</small>}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('common.delete')}
                    onClick={() => act({ type: 'remove', id: c.id }).catch((e) => toast(errorText(e.code), { tone: 'error' }))}
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('deck.empty')}</p>
          ))}
      </section>

      <Sheet open={renaming} onClose={() => setRenaming(false)} title={t('deck.rename')}>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await act({ type: 'rename', name: newName })
              setRenaming(false)
            } catch (err) {
              toast(errorText(err.code), { tone: 'error' })
            }
          }}
        >
          <input className="input" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <button type="submit" className="btn btn-primary">
            {t('common.save')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              if (await copyText(url)) toast(t('common.copied'))
            }}
          >
            {t('common.copy')}
          </button>
        </form>
      </Sheet>
    </main>
  )
}

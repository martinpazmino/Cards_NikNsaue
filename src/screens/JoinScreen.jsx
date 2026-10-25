import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toasts.jsx'
import { AvatarPicker, Logo, PapelPicado, Spinner } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { buzz } from '../lib/device.js'
import { useI18n } from '../lib/i18n.jsx'
import { primeRoom } from '../lib/primed.js'
import { navigate } from '../lib/router.js'
import { LangToggle, useProfile } from './Home.jsx'

export default function JoinScreen({ code, notice, onJoined }) {
  const { t, errorText } = useI18n()
  const toast = useToast()
  const [profile, update] = useProfile()
  const [exists, setExists] = useState(notice === 'ROOM_NOT_FOUND' ? false : null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => {
    if (exists === false) return
    let alive = true
    api
      .version(code)
      .then(() => alive && setExists(true))
      .catch((e) => alive && setExists(e.status === 404 ? false : true))
    return () => {
      alive = false
    }
  }, [code, exists])

  async function join(e) {
    e.preventDefault()
    if (!profile.name.trim()) {
      toast(t('home.nameFirst'))
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const res = await api.join(code, { name: profile.name, avatar: profile.avatar })
      primeRoom(code, res.state)
      buzz(12)
      onJoined(res)
    } catch (err) {
      if (err.code === 'ROOM_NOT_FOUND') setExists(false)
      else toast(errorText(err.code), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (exists === null) return <Spinner label={t('common.loading')} />

  return (
    <main className="screen join">
      <PapelPicado />
      <div className="home-top">
        <LangToggle />
      </div>
      <header className="join-head">
        <Logo size="lg" />
        {exists ? (
          <>
            <p className="muted">{t('join.title')}</p>
            <p className="room-code">{code}</p>
          </>
        ) : (
          <div className="empty-state">
            <p className="big-emoji">🫥</p>
            <p>{t('join.notFound')}</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
              {t('join.goHome')}
            </button>
          </div>
        )}
      </header>

      {exists && (
        <form className="panel" onSubmit={join}>
          {notice === 'NOT_IN_ROOM' && <p className="notice">{t('join.kicked')}</p>}
          <label className="label" htmlFor="nick">
            {t('home.yourName')}
          </label>
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
          <p className="label">{t('home.pickAvatar')}</p>
          <AvatarPicker value={profile.avatar} onChange={(avatar) => update({ avatar })} />
          <button type="submit" className="btn btn-primary btn-big" disabled={busy}>
            {profile.avatar} {t('join.cta')}
          </button>
        </form>
      )}
    </main>
  )
}

import { useEffect, useState } from 'react'
import { fillPrompt } from '../../shared/text.js'
import { MenuSheet, rankOf } from '../components/RoomParts.jsx'
import { useToast } from '../components/Toasts.jsx'
import { Avatar, BottomBar, Logo, PapelPicado } from '../components/ui.jsx'
import { celebrate } from '../lib/celebrate.js'
import { cx } from '../lib/cx.js'
import { share } from '../lib/device.js'
import { points, useI18n } from '../lib/i18n.jsx'
import { APP_NAME } from '../../shared/constants.js'

function Highlight({ h }) {
  const { segments } = fillPrompt(h.prompt, h.cards)
  return (
    <li className="highlight">
      <p className="highlight-text">
        {segments.map((s, i) => (s.t != null ? <span key={i}>{s.t}</span> : <mark key={i}>{s.a ?? '___'}</mark>))}
      </p>
      <p className="highlight-by">
        <span className="avatar avatar-xs" style={{ '--c': h.winnerColor, '--s': '22px' }}>
          {h.winnerAvatar}
        </span>
        {h.winnerName}
      </p>
    </li>
  )
}

export default function GameOver({ view, room }) {
  const { t, errorText } = useI18n()
  const toast = useToast()
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  // Highest score first; on a tie the champion (first to the goal) leads.
  const sorted = [...view.players].sort(
    (a, b) => b.score - a.score || Number(b.id === view.champion) - Number(a.id === view.champion),
  )
  const champ = view.players.find((p) => p.id === view.champion)
  const podium = [sorted[1], sorted[0], sorted[2]]
  const host = view.players.find((p) => p.host)

  useEffect(() => {
    celebrate(true)
  }, [])

  const run = async (type) => {
    setBusy(true)
    try {
      await room.act(type)
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const shareResults = async () => {
    const text = champ ? t('over.shareText', { name: champ.name, n: champ.score }) : t('over.noWinner')
    const r = await share({ title: APP_NAME, text, url: window.location.origin })
    if (r === 'copied') toast(t('common.copied'))
  }

  return (
    <main className="screen over">
      <PapelPicado />
      <header className="lobby-head">
        <Logo size="md" />
        <button type="button" className="icon-btn icon-btn-lg" onClick={() => setMenu(true)} aria-label={t('menu.title')}>
          ☰
        </button>
      </header>
      <h1 className="over-title">{t('over.title')}</h1>
      {champ ? (
        <p className="over-sub">
          {t('over.champion')}: <strong>{champ.name}</strong>
        </p>
      ) : (
        <p className="over-sub">{t('over.noWinner')}</p>
      )}

      <div className="podium">
        {podium.map((p, i) =>
          p ? (
            <div key={p.id} className={cx('podium-col', `place-${[2, 1, 3][i]}`)}>
              {[2, 1, 3][i] === 1 && <span className="crown">👑</span>}
              <Avatar player={p} size={[2, 1, 3][i] === 1 ? 76 : 56} />
              <span className="podium-name">{p.name}</span>
              <div className="podium-block">
                <span className="podium-place">{rankOf(sorted, p)}</span>
                <span className="podium-pts">{points(t, p.score)}</span>
              </div>
            </div>
          ) : (
            <div key={i} className="podium-col is-empty" />
          ),
        )}
      </div>

      {sorted.length > 3 && (
        <ul className="rest">
          {sorted.slice(3).map((p) => (
            <li key={p.id}>
              <span className="score-rank">{rankOf(sorted, p)}</span>
              <Avatar player={p} size={30} />
              <span className="score-name">{p.name}</span>
              <span className="score-pts">{p.score}</span>
            </li>
          ))}
        </ul>
      )}

      {view.history.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">✨ {t('over.highlights')}</h2>
          <ul className="highlights">
            {view.history
              .slice()
              .reverse()
              .map((h) => (
                <Highlight key={h.n} h={h} />
              ))}
          </ul>
        </section>
      )}

      <div className="stack">
        <button type="button" className="btn btn-secondary" onClick={shareResults}>
          ↗ {t('over.share')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={room.leave}>
          🚪 {t('over.home')}
        </button>
      </div>

      <BottomBar>
        {view.me.host ? (
          <div className="bar-row">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run('restart')}>
              {t('over.lobby')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run('start')}>
              {t('over.again')} 🔁
            </button>
          </div>
        ) : (
          <p className="bar-wait">
            <span className="dots" aria-hidden="true" />
            {t('over.waitHost', { name: host?.name ?? '…' })}
          </p>
        )}
      </BottomBar>
      <MenuSheet open={menu} onClose={() => setMenu(false)} view={view} room={room} />
    </main>
  )
}

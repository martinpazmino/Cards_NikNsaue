import { useMemo, useState } from 'react'
import { cx } from '../lib/cx.js'
import { buzz, copyText, share, whatsappUrl } from '../lib/device.js'
import { points, useI18n } from '../lib/i18n.jsx'
import { roomUrl } from '../lib/router.js'
import { CardWriter } from './CardWriter.jsx'
import { useToast } from './Toasts.jsx'
import { Avatar, QrCode, Sheet } from './ui.jsx'
import { APP_NAME } from '../../shared/constants.js'

export function InviteButtons({ code, showQr = true }) {
  const { t } = useI18n()
  const toast = useToast()
  const [qr, setQr] = useState(false)
  const url = roomUrl(code)
  const text = t('lobby.inviteText', { code })
  return (
    <>
      <div className="invite-row">
        <a className="btn btn-whatsapp" href={whatsappUrl(`${text} ${url}`)} target="_blank" rel="noreferrer">
          <WhatsAppIcon /> WhatsApp
        </a>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            const r = await share({ title: APP_NAME, text, url })
            if (r === 'copied') toast(t('common.copied'))
          }}
        >
          ↗ {t('common.share')}
        </button>
        {showQr && (
          <button type="button" className="btn btn-secondary btn-square" onClick={() => setQr(true)} aria-label="QR">
            <QrIcon />
          </button>
        )}
      </div>
      <Sheet open={qr} onClose={() => setQr(false)} title={`${t('lobby.code')}: ${code}`}>
        <div className="qr-wrap">
          <QrCode text={url} />
          <p className="muted">{t('lobby.qrHint')}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              if (await copyText(url)) toast(t('common.copied'))
            }}
          >
            {t('common.copy')}
          </button>
        </div>
      </Sheet>
    </>
  )
}

// Simple Icons "WhatsApp" glyph (CC0).
export function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </svg>
  )
}

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm11-2h2v2h-2v-2zm-3 0h2v3h-2v-3zm3 3h2v2h-2v-2zm2-3h3v2h-3v-2zm1 3h2v5h-2v-5zm-6 2h2v3h-2v-3zm3 1h2v2h-2v-2z"
      />
    </svg>
  )
}

export function PlayerBadges({ player, view }) {
  const { t } = useI18n()
  return (
    <span className="badges">
      {player.host && <span title={t('player.host')}>👑</span>}
      {player.judge && view.phase !== 'lobby' && <span>⚖️</span>}
      {player.played && <span className="badge-ok">✓</span>}
      {player.bot && <span className="badge-soft">{t('player.bot')}</span>}
      {player.online === false && <span className="badge-soft">{t('player.offline')}</span>}
    </span>
  )
}

// Host-only actions for a player.
export function PlayerSheet({ player, view, room, onClose }) {
  const { t, errorText } = useI18n()
  const toast = useToast()
  if (!player) return null
  const run = async (type, payload) => {
    try {
      await room.act(type, payload)
      onClose()
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    }
  }
  return (
    <Sheet open={!!player} onClose={onClose} title={player.name}>
      <div className="player-sheet">
        <Avatar player={player} size={72} />
        <p className="muted">{points(t, player.score)}</p>
        {!player.bot && player.id !== view.me.id && (
          <button type="button" className="btn btn-secondary" onClick={() => run('makeHost', { pid: player.id })}>
            {t('player.makeHost')}
          </button>
        )}
        {player.id !== view.me.id && (
          <button type="button" className="btn btn-danger" onClick={() => run('kick', { pid: player.id })}>
            {t('player.kick')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

export function WriterSheet({ open, onClose, view, room }) {
  const { t } = useI18n()
  const names = useMemo(() => {
    const others = view.players.filter((p) => !p.bot && p.id !== view.me.id).map((p) => p.name)
    return others.length ? others : view.players.filter((p) => !p.bot).map((p) => p.name)
  }, [view.players, view.me.id])
  return (
    <Sheet open={open} onClose={onClose} title={`✍️ ${t('writer.title')}`}>
      <CardWriter
        names={names}
        mine={view.custom.mine}
        onAdd={(type, text) => room.act('addCard', { t: type, text })}
        onRemove={(id) => room.act('removeCard', { id })}
      >
        <p className="small muted">{t('writer.secret')}</p>
      </CardWriter>
    </Sheet>
  )
}

// Competition ranking: tied scores share a place (1, 2, 3, 3).
export function rankOf(players, p) {
  return 1 + players.filter((x) => x.score > p.score).length
}

export function Scoreboard({ view, onPick }) {
  const { t } = useI18n()
  const sorted = [...view.players].sort((a, b) => b.score - a.score)
  return (
    <ul className="scoreboard">
      {sorted.map((p) => (
        <li key={p.id}>
          <button type="button" className="score-row" onClick={onPick ? () => onPick(p) : undefined} disabled={!onPick}>
            <span className="score-rank">{rankOf(sorted, p)}</span>
            <Avatar player={p} size={36} />
            <span className="score-name">
              {p.name}
              {p.id === view.me.id && <span className="you"> · {t('common.you')}</span>}
              <PlayerBadges player={p} view={view} />
            </span>
            <span className="score-pts">{p.score}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function MenuSheet({ open, onClose, view, room, onWrite }) {
  const { t, lang, setLang, errorText } = useI18n()
  const toast = useToast()
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [player, setPlayer] = useState(null)
  const host = view.me.host
  const inGame = view.phase === 'picking' || view.phase === 'judging' || view.phase === 'result'
  const run = async (type) => {
    try {
      await room.act(type)
      onClose()
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    }
  }
  return (
    <>
      <Sheet open={open && !player} onClose={onClose} title={t('menu.scores')}>
        <Scoreboard view={view} onPick={host ? (p) => p.id !== view.me.id && setPlayer(p) : null} />
        <div className="menu-actions">
          <InviteButtons code={view.code} />
          {onWrite && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onClose()
                onWrite()
              }}
            >
              ✍️ {t('menu.writeCards')}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}>
            🌐 {t('menu.language')}
          </button>
          {host && inGame && (
            <div className="host-tools">
              <p className="label">{t('menu.hostTools')}</p>
              {(view.phase === 'picking' || view.phase === 'judging') && (
                <button type="button" className="btn btn-secondary" onClick={() => run('skip')}>
                  ⏭️ {t('menu.skip')}
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => run('end')}>
                🏁 {t('menu.end')}
              </button>
            </div>
          )}
          <button
            type="button"
            className={cx('btn', confirmLeave ? 'btn-danger' : 'btn-ghost')}
            onClick={() => {
              buzz(10)
              if (confirmLeave) room.leave()
              else setConfirmLeave(true)
            }}
          >
            🚪 {confirmLeave ? t('menu.leaveConfirm') : t('menu.leave')}
          </button>
        </div>
      </Sheet>
      <PlayerSheet player={player} view={view} room={room} onClose={() => setPlayer(null)} />
    </>
  )
}

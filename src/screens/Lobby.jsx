import { useState } from 'react'
import { SETTING_OPTIONS } from '../../shared/constants.js'
import { InviteButtons, MenuSheet, PlayerBadges, PlayerSheet, WriterSheet } from '../components/RoomParts.jsx'
import { useToast } from '../components/Toasts.jsx'
import { Avatar, BottomBar, Field, Logo, PapelPicado, Segmented, Sheet, Toggle } from '../components/ui.jsx'
import { cx } from '../lib/cx.js'
import { buzz, copyText } from '../lib/device.js'
import { count, useI18n } from '../lib/i18n.jsx'
import { deckUrl, roomUrl } from '../lib/router.js'

function Rules({ view, room }) {
  const { t, lang, errorText } = useI18n()
  const toast = useToast()
  const s = view.settings
  const isHost = view.me.host
  const hostName = view.players.find((p) => p.host)?.name
  const set = (patch) => room.act('settings', { patch }).catch((e) => toast(errorText(e.code), { tone: 'error' }))
  const togglePack = (id) => set({ packs: s.packs.includes(id) ? s.packs.filter((x) => x !== id) : [...s.packs, id] })

  return (
    <section className="panel">
      <h2 className="panel-title">⚙️ {t('lobby.rules')}</h2>
      {!isHost && <p className="small muted">{t('lobby.onlyHost', { name: hostName })}</p>}
      <p className="label">{t('lobby.packs')}</p>
      <div className="packs">
        {(view.packs || []).map((p) => {
          const on = s.packs.includes(p.id)
          return (
            <button
              key={p.id}
              type="button"
              className={cx('pack', on && 'is-on')}
              disabled={!isHost}
              aria-pressed={on}
              onClick={() => {
                buzz(6)
                togglePack(p.id)
              }}
            >
              <span className="pack-emoji">{p.emoji}</span>
              <span className="pack-body">
                <span className="pack-name">
                  {p.name[lang]}
                  {p.adult && <span className="badge-adult">{t('lobby.adult')}</span>}
                </span>
                <small>{p.description[lang]}</small>
                <small className="muted">
                  {count(t, p.prompts, 'prompts')} · {count(t, p.answers, 'answers')}
                </small>
              </span>
              <span className="pack-check">{on ? '✓' : ''}</span>
            </button>
          )
        })}
      </div>
      {!s.packs.length && <p className="small warn">{t('lobby.noPacks')}</p>}
      <Field label={t('lobby.maxScore')}>
        <Segmented value={s.maxScore} options={SETTING_OPTIONS.maxScore} disabled={!isHost} onChange={(v) => set({ maxScore: v })} />
      </Field>
      <Field label={t('lobby.timer')}>
        <Segmented
          value={s.timer}
          options={SETTING_OPTIONS.timer}
          disabled={!isHost}
          format={(v) => (v ? t('lobby.seconds', { n: v }) : '∞')}
          onChange={(v) => set({ timer: v })}
        />
      </Field>
      <Field label={t('lobby.blanks')} hint={t('lobby.blanksHint')}>
        <Segmented value={s.blanks} options={SETTING_OPTIONS.blanks} disabled={!isHost} onChange={(v) => set({ blanks: v })} />
      </Field>
      <Field label={t('lobby.handSize')}>
        <Segmented value={s.handSize} options={SETTING_OPTIONS.handSize} disabled={!isHost} onChange={(v) => set({ handSize: v })} />
      </Field>
      <Toggle label={t('lobby.rando')} hint={t('lobby.randoHint')} checked={s.rando} disabled={!isHost} onChange={(v) => set({ rando: v })} />
      <Toggle label={t('lobby.useCustom')} checked={s.custom} disabled={!isHost} onChange={(v) => set({ custom: v })} />
      {s.custom && <Toggle label={t('lobby.boost')} checked={s.boost} disabled={!isHost} onChange={(v) => set({ boost: v })} />}
    </section>
  )
}

function RenameDeckSheet({ open, onClose, view, room }) {
  const { t, errorText } = useI18n()
  const toast = useToast()
  const [name, setName] = useState(view.deck.name)
  return (
    <Sheet open={open} onClose={onClose} title={t('deck.rename')}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await room.act('renameDeck', { name })
            onClose()
          } catch (err) {
            toast(errorText(err.code), { tone: 'error' })
          }
        }}
      >
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

function GroupCards({ view, room, onWrite }) {
  const { t } = useI18n()
  const toast = useToast()
  const [renaming, setRenaming] = useState(false)
  const c = view.custom
  return (
    <section className="panel panel-accent">
      <h2 className="panel-title">✍️ {t('lobby.groupCards')}</h2>
      <p className="small">{t('lobby.groupCardsHint')}</p>
      <div className="group-stats">
        <div className="stat">
          <strong>{c.prompts}</strong>
          <span>{t('lobby.statPrompts')}</span>
        </div>
        <div className="stat">
          <strong>{c.answers}</strong>
          <span>{t('lobby.statAnswers')}</span>
        </div>
        <div className="stat">
          <strong>{c.mine.length}</strong>
          <span>{t('lobby.statMine')}</span>
        </div>
      </div>
      {c.authors.length > 0 && (
        <div className="chips">
          {c.authors.map((a) => (
            <span key={a.name} className="chip chip-static">
              {a.name} · {a.n}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={onWrite}>
        ✍️ {t('lobby.write')}
      </button>
      <p className="small muted deck-line">
        🃏 {t('lobby.deckSaved', { name: view.deck.name })}{' '}
        {view.me.host && (
          <button type="button" className="link-btn inline" onClick={() => setRenaming(true)}>
            {t('deck.rename')}
          </button>
        )}{' '}
        {view.deck.id && (
          <button
            type="button"
            className="link-btn inline"
            onClick={async () => {
              if (await copyText(deckUrl(view.deck.id))) toast(t('common.copied'))
            }}
          >
            {t('common.copy')}
          </button>
        )}
      </p>
      {renaming && <RenameDeckSheet open onClose={() => setRenaming(false)} view={view} room={room} />}
    </section>
  )
}

export default function Lobby({ view, room }) {
  const { t, errorText } = useI18n()
  const toast = useToast()
  const [writer, setWriter] = useState(false)
  const [menu, setMenu] = useState(false)
  const [player, setPlayer] = useState(null)
  const [busy, setBusy] = useState(false)
  const isHost = view.me.host
  const humans = view.players.filter((p) => !p.bot)
  const canStart = humans.length >= 2 && view.players.length >= 3
  const host = view.players.find((p) => p.host)

  async function start() {
    setBusy(true)
    try {
      await room.act('start')
      buzz([20, 40, 20])
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen lobby">
      <PapelPicado />
      <header className="lobby-head">
        <Logo size="md" />
        <button type="button" className="icon-btn icon-btn-lg" onClick={() => setMenu(true)} aria-label={t('menu.title')}>
          ☰
        </button>
      </header>

      <section className="code-block">
        <p className="label">{t('lobby.code')}</p>
        <button
          type="button"
          className="room-code"
          onClick={async () => {
            if (await copyText(roomUrl(view.code))) toast(t('common.copied'))
          }}
        >
          {view.code}
        </button>
        <p className="small muted">{t('lobby.invite')}</p>
        <InviteButtons code={view.code} />
      </section>

      <section className="panel">
        <h2 className="panel-title">
          🙌 {t('lobby.players')} <span className="count">{humans.length}</span>
        </h2>
        <ul className="player-grid">
          {view.players.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={cx('player-chip', p.id === view.me.id && 'is-me')}
                onClick={isHost && p.id !== view.me.id ? () => setPlayer(p) : undefined}
                disabled={!isHost || p.id === view.me.id}
              >
                <Avatar player={p} size={44} />
                <span className="player-name">{p.name}</span>
                <PlayerBadges player={p} view={view} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <GroupCards view={view} room={room} onWrite={() => setWriter(true)} />
      <Rules view={view} room={room} />

      <BottomBar>
        {isHost ? (
          <>
            {!canStart && <p className="bar-hint">{t('lobby.needPlayers')}</p>}
            <button type="button" className="btn btn-primary btn-big" disabled={!canStart || busy} onClick={start}>
              {t('lobby.start')} 🌶️
            </button>
          </>
        ) : (
          <p className="bar-wait">
            <span className="dots" aria-hidden="true" />
            {t('lobby.waitingHost', { name: host?.name ?? '…' })}
          </p>
        )}
      </BottomBar>

      <WriterSheet open={writer} onClose={() => setWriter(false)} view={view} room={room} />
      <MenuSheet open={menu} onClose={() => setMenu(false)} view={view} room={room} onWrite={() => setWriter(true)} />
      <PlayerSheet player={player} view={view} room={room} onClose={() => setPlayer(null)} />
    </main>
  )
}

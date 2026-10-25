import { useEffect, useState } from 'react'
import { LIMITS } from '../../shared/constants.js'
import { capitalize, cleanText, fillPromptText } from '../../shared/text.js'
import { AnswerCard, PromptCard, SubmissionCard } from '../components/Cards.jsx'
import { MenuSheet, WriterSheet } from '../components/RoomParts.jsx'
import { useToast } from '../components/Toasts.jsx'
import { Avatar, BottomBar, Countdown, Sheet, useNow } from '../components/ui.jsx'
import { celebrate } from '../lib/celebrate.js'
import { cx } from '../lib/cx.js'
import { buzz } from '../lib/device.js'
import { useI18n } from '../lib/i18n.jsx'

const GHOST = { name: '?', avatar: '👻', color: '#555' }
const playerOf = (view, id) => view.players.find((p) => p.id === id) || GHOST

function useActions(room) {
  const { errorText } = useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (type, payload, after) => {
    if (busy) return
    setBusy(true)
    try {
      await room.act(type, payload)
      after?.()
    } catch (e) {
      toast(errorText(e.code), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return [run, busy]
}

function TopBar({ view, room, onMenu }) {
  const { t } = useI18n()
  const r = view.round
  const me = playerOf(view, view.me.id)
  return (
    <header className="topbar">
      <button type="button" className="code-chip" onClick={onMenu}>
        {view.code}
      </button>
      <div className="topbar-mid">
        <strong>{t('game.round', { n: r.n })}</strong>
        <span>⚖️ {playerOf(view, r.judgeId).name}</span>
      </div>
      {r.deadline && view.phase === 'picking' && <Countdown deadline={r.deadline} serverNow={room.serverNow} total={view.settings.timer} />}
      <button type="button" className="score-btn" onClick={onMenu} aria-label={t('menu.scores')}>
        🏆 <strong>{me.score}</strong>
        <span>/{view.settings.maxScore}</span>
      </button>
    </header>
  )
}

function RoleBanner({ emoji, title, text, tone }) {
  return (
    <div className={cx('role-banner', tone && `role-${tone}`)}>
      <span className="role-emoji">{emoji}</span>
      <div>
        <strong>{title}</strong>
        {text && <p>{text}</p>}
      </div>
    </div>
  )
}

function PlayStatus({ view }) {
  const { t } = useI18n()
  const r = view.round
  const players = view.players.filter((p) => !p.judge)
  return (
    <section className="play-status">
      <p className="label">{t('game.played', { n: r.played, total: r.played + r.waiting })}</p>
      <div className="status-row">
        {players.map((p) => (
          <span key={p.id} className={cx('status-chip', p.played ? 'is-done' : p.waiting ? 'is-waiting' : 'is-idle')}>
            <Avatar player={p} size={30} />
            <span className="status-name">{p.name}</span>
            <span className="status-icon">{p.played ? '✓' : p.waiting ? '…' : '–'}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

function WriteInSheet({ open, onClose, onUse, prompt }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const clean = cleanText(text)
  return (
    <Sheet open={open} onClose={onClose} title={`✍️ ${t('game.writeOwn')}`}>
      <div className="writein">
        <PromptCard prompt={prompt} answers={[clean || '…']} />
        <textarea
          value={text}
          maxLength={LIMITS.answerMax}
          rows={2}
          autoFocus
          placeholder={t('game.writePlaceholder')}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (clean) {
                onUse(clean)
                setText('')
              }
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!clean}
          onClick={() => {
            onUse(clean)
            setText('')
          }}
        >
          {t('game.useIt')}
        </button>
      </div>
    </Sheet>
  )
}

function Picking({ view, room }) {
  const { t } = useI18n()
  const [run, busy] = useActions(room)
  const r = view.round
  const pick = r.prompt.pick
  const [sel, setSel] = useState([])
  const [writing, setWriting] = useState(false)
  const written = sel.filter((c) => c.w)
  const blanksLeft = view.me.blanks - written.length
  const canPlay = view.me.hand.length + view.me.blanks >= pick

  const choose = (card) => {
    buzz(6)
    setSel((s) => {
      if (s.some((c) => c.id === card.id)) return s.filter((c) => c.id !== card.id)
      if (pick === 1) return [card]
      return s.length < pick ? [...s, card] : [...s.slice(1), card]
    })
  }

  const order = (card) => {
    const i = sel.findIndex((c) => c.id === card.id)
    return pick > 1 && i >= 0 ? i + 1 : null
  }

  const send = () =>
    run('submit', { cards: sel.map((c) => (c.w ? { w: c.text } : c.id)) }, () => buzz([10, 40, 10]))

  return (
    <>
      <div className="stage">
        <PromptCard prompt={r.prompt} answers={sel.map((c) => c.text)} />
      </div>
      <p className="hint">{pick === 2 ? t('game.pickTwo') : t('game.pickOne')}</p>
      {!canPlay && <p className="notice">{t('game.cantPlay')}</p>}
      <div className="hand">
        {written.map((c) => (
          <AnswerCard key={c.id} card={c} selected order={order(c)} onClick={() => choose(c)} />
        ))}
        {view.me.hand.map((c, i) => (
          <AnswerCard
            key={c.id}
            card={c}
            selected={sel.some((s) => s.id === c.id)}
            order={order(c)}
            onClick={() => choose(c)}
            className="deal"
            style={{ '--i': i }}
          />
        ))}
        {blanksLeft > 0 && (
          <button type="button" className="card answer blank-card" onClick={() => setWriting(true)}>
            <span className="card-text">✍️ {t('game.writeOwn')}</span>
            <footer className="card-foot">
              <span className="tag">{t('game.blanksLeft', { n: blanksLeft })}</span>
            </footer>
          </button>
        )}
      </div>
      <BottomBar>
        {sel.length ? (
          <p className="preview">{fillPromptText(r.prompt.text, sel.map((c) => c.text))}</p>
        ) : (
          <p className="bar-hint">{t('game.selectHint')}</p>
        )}
        <button type="button" className="btn btn-primary btn-big" disabled={sel.length !== pick || busy} onClick={send}>
          {t('game.send')}
          {pick > 1 ? ` (${sel.length}/${pick})` : ''}
        </button>
      </BottomBar>
      <WriteInSheet
        open={writing}
        onClose={() => setWriting(false)}
        prompt={r.prompt}
        onUse={(text) => {
          choose({ id: `w-${Date.now()}`, text, w: true })
          setWriting(false)
        }}
      />
    </>
  )
}

function JudgeWait({ view, room, onWrite }) {
  const { t } = useI18n()
  const [run, busy] = useActions(room)
  const someonePlayed = view.players.some((p) => p.played && !p.bot)
  return (
    <>
      <RoleBanner emoji="⚖️" tone="judge" title={t('game.youJudge')} text={t('game.readAloud')} />
      <div className="stage">
        <PromptCard prompt={view.round.prompt} />
      </div>
      <PlayStatus view={view} />
      <div className="stack">
        <button type="button" className="btn btn-secondary" onClick={onWrite}>
          {t('game.writeWhileWaiting')}
        </button>
      </div>
      {someonePlayed && view.round.waiting > 0 && (
        <BottomBar>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run('hurry')}>
            ⏩ {t('game.hurry')}
          </button>
        </BottomBar>
      )}
    </>
  )
}

function Submitted({ view, room, onWrite }) {
  const { t } = useI18n()
  const [run, busy] = useActions(room)
  const r = view.round
  return (
    <>
      <RoleBanner emoji="✅" tone="done" title={t('game.sent')} text={t('game.judgeIs', { name: playerOf(view, r.judgeId).name })} />
      <div className="stage">
        <PromptCard prompt={r.prompt} answers={r.mine.cards.map((c) => c.text)} />
      </div>
      <PlayStatus view={view} />
      <div className="stack">
        <button type="button" className="btn btn-secondary" onClick={onWrite}>
          {t('game.writeWhileWaiting')}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run('retract')}>
          ↩︎ {t('game.change')}
        </button>
      </div>
    </>
  )
}

function Judging({ view, room }) {
  const { t, errorText } = useI18n()
  const toast = useToast()
  const [run, busy] = useActions(room)
  const r = view.round
  const isJudge = view.me.judge
  const [chosen, setChosen] = useState(null)
  const shownId = isJudge ? chosen ?? r.focus : r.focus
  const shown = r.subs.find((s) => s.id === shownId)
  const chosenSub = r.subs.find((s) => s.id === chosen)

  useEffect(() => {
    if (isJudge || !r.focus) return
    document.querySelector(`[data-sub="${r.focus}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [r.focus, isJudge])

  // Reveals are independent of the busy guard so quick taps all land.
  const tap = (sub) => {
    buzz(8)
    setChosen(sub.id)
    if (!sub.shown || r.focus !== sub.id) {
      room.act('reveal', { subId: sub.id }).catch((e) => toast(errorText(e.code), { tone: 'error' }))
    }
  }

  return (
    <>
      {isJudge ? (
        <RoleBanner emoji="⚖️" tone="judge" title={t('judging.title')} text={t('judging.tapToReveal')} />
      ) : (
        <RoleBanner emoji="👀" title={t('judging.others', { name: playerOf(view, r.judgeId).name })} />
      )}
      <div className="stage stage-sticky">
        <PromptCard prompt={r.prompt} answers={shown?.cards?.map((c) => c.text) ?? []} compact />
      </div>
      <div className="subs">
        {r.subs.map((s, i) => (
          <SubmissionCard
            key={s.id}
            sub={s}
            index={i}
            focused={s.id === r.focus}
            chosen={isJudge && s.id === chosen}
            mine={r.mine?.id === s.id}
            onClick={isJudge ? () => tap(s) : undefined}
          />
        ))}
      </div>
      {isJudge && (
        <BottomBar>
          <button
            type="button"
            className="btn btn-primary btn-big"
            disabled={!chosenSub?.shown || busy}
            onClick={() => run('pick', { subId: chosen }, () => buzz([30, 50, 30]))}
          >
            {chosenSub?.shown ? t('judging.choose') : t('judging.selectHint')}
          </button>
        </BottomBar>
      )}
    </>
  )
}

function Result({ view, room }) {
  const { t } = useI18n()
  const [run, busy] = useActions(room)
  const r = view.round
  const winSub = r.subs.find((s) => s.id === r.winner)
  const winner = playerOf(view, winSub?.pid)
  const judge = playerOf(view, r.judgeId)
  const iWon = winSub?.pid === view.me.id
  const champion = view.players.find((p) => p.score >= view.settings.maxScore)
  const gameWon = !!champion
  useNow(500, view.phase === 'result')
  const canNext = view.me.judge || view.me.host || room.serverNow() >= r.nextAt

  useEffect(() => {
    celebrate(iWon || gameWon)
    if (iWon) buzz([40, 60, 40, 60, 120])
  }, [iWon, gameWon])

  if (!winSub) return null
  return (
    <>
      <div className="winner-banner">
        <Avatar player={winner} size={76} className="pop" />
        <h2>{iWon ? t('result.youWon') : t('result.point', { name: winner.name })}</h2>
        <p className="small muted">{t('result.chosenBy', { name: judge.name })}</p>
      </div>
      <div className="stage">
        <PromptCard prompt={r.prompt} answers={winSub.cards.map((c) => c.text)} className="is-winner" />
      </div>
      {champion && <div className="champion-callout">🏆 {t('result.champion', { name: champion.name })}</div>}
      {r.subs.length > 1 && (
        <section className="others">
          <p className="label">{t('result.others')}</p>
          {r.subs
            .filter((s) => s.id !== r.winner)
            .map((s) => {
              const p = playerOf(view, s.pid)
              return (
                <div key={s.id} className="other">
                  <Avatar player={p} size={32} />
                  <div>
                    <strong>{p.name}</strong>
                    <p>{s.cards.map((c) => capitalize(c.text)).join(' · ')}</p>
                  </div>
                </div>
              )
            })}
        </section>
      )}
      <BottomBar>
        {canNext ? (
          <button type="button" className="btn btn-primary btn-big" disabled={busy} onClick={() => run('next')}>
            {champion ? t('result.seePodium') : t('result.next')} ▶
          </button>
        ) : (
          <p className="bar-wait">
            <span className="dots" aria-hidden="true" />
            {t('result.waiting', { name: judge.name })}
          </p>
        )}
      </BottomBar>
    </>
  )
}

export default function Game({ view, room }) {
  const [menu, setMenu] = useState(false)
  const [writer, setWriter] = useState(false)
  const r = view.round
  const openWriter = () => setWriter(true)

  let body
  if (view.phase === 'picking') {
    if (view.me.judge) body = <JudgeWait view={view} room={room} onWrite={openWriter} />
    else if (r.mine) body = <Submitted view={view} room={room} onWrite={openWriter} />
    else body = <Picking key={r.n} view={view} room={room} />
  } else if (view.phase === 'judging') {
    body = <Judging key={r.n} view={view} room={room} />
  } else {
    body = <Result key={r.n} view={view} room={room} />
  }

  return (
    <main className={cx('screen game', `phase-${view.phase}`)}>
      <TopBar view={view} room={room} onMenu={() => setMenu(true)} />
      {body}
      <MenuSheet open={menu} onClose={() => setMenu(false)} view={view} room={room} onWrite={openWriter} />
      <WriterSheet open={writer} onClose={() => setWriter(false)} view={view} room={room} />
    </main>
  )
}

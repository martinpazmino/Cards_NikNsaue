import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToastProvider, useToast } from './components/Toasts.jsx'
import { Spinner } from './components/ui.jsx'
import { buzz, useWakeLock } from './lib/device.js'
import { I18nProvider, useI18n } from './lib/i18n.jsx'
import { clearPrimed, peekPrimed } from './lib/primed.js'
import { navigate, useRoute } from './lib/router.js'
import { storage } from './lib/storage.js'
import { useRoom } from './lib/useRoom.js'
import DeckPage from './screens/DeckPage.jsx'
import Game from './screens/Game.jsx'
import GameOver from './screens/GameOver.jsx'
import Home from './screens/Home.jsx'
import JoinScreen from './screens/JoinScreen.jsx'
import Lobby from './screens/Lobby.jsx'
import { APP_NAME } from '../shared/constants.js'

const EVENT_KEYS = {
  join: 'ev.join',
  back: 'ev.back',
  leave: 'ev.leave',
  kick: 'ev.kick',
  card: 'ev.card',
  host: 'ev.host',
  skip: 'ev.skip',
  aborted: 'ev.aborted',
  restart: 'ev.restart',
}

// Toasts for room events, haptics when it's your turn, and a tab title hint.
function useRoomFeedback(view) {
  const { t } = useI18n()
  const toast = useToast()
  const lastEvent = useRef(null)
  const lastStep = useRef(null)

  useEffect(() => {
    if (!view?.me) return
    const events = view.events || []
    if (lastEvent.current !== null) {
      for (const e of events) {
        if (e.id <= lastEvent.current) continue
        if (e.name === view.me.name && (e.k === 'join' || e.k === 'card' || e.k === 'back')) continue
        if (EVENT_KEYS[e.k]) toast(t(EVENT_KEYS[e.k], { name: e.name }))
      }
    }
    lastEvent.current = events.at(-1)?.id ?? lastEvent.current ?? 0

    // New phase: old toasts are stale, and a buzz tells you it's your move.
    const step = `${view.round?.n ?? 0}:${view.phase}`
    if (lastStep.current && lastStep.current !== step) {
      toast.clear()
      if (view.me.judge && (view.phase === 'picking' || view.phase === 'judging')) buzz([30, 40, 30])
      else if (view.phase === 'picking') buzz(15)
    }
    lastStep.current = step

    const myTurn =
      (view.phase === 'picking' && !view.me.judge && !view.round?.mine) || (view.phase === 'judging' && view.me.judge)
    document.title = myTurn ? `👉 ${t('title.yourTurn')} · ${APP_NAME}` : `${APP_NAME} · ${view.code}`
  }, [view, t, toast])

  useEffect(
    () => () => {
      document.title = APP_NAME
    },
    [],
  )
}

function RoomScreen({ code, session, onLost }) {
  const { t } = useI18n()
  const [initial] = useState(() => peekPrimed(code))
  const { view, fatal, offline, act, serverNow } = useRoom(code, session, initial)

  useEffect(() => {
    clearPrimed(code)
  }, [code])
  useWakeLock(!!view?.me)
  useEffect(() => {
    if (fatal) onLost(fatal)
  }, [fatal, onLost])
  useRoomFeedback(view)

  const deck = view?.deck
  const deckCount = view ? view.custom.prompts + view.custom.answers : 0
  useEffect(() => {
    if (deck?.id) storage.rememberDeck({ id: deck.id, name: deck.name, count: deckCount })
  }, [deck?.id, deck?.name, deckCount])

  const leave = useCallback(async () => {
    try {
      await act('leave')
    } catch {
      // leaving anyway
    }
    storage.clearSession(code)
    navigate('/')
  }, [act, code])

  const ctx = useMemo(() => ({ act, serverNow, code, leave }), [act, serverNow, code, leave])

  if (!view?.me) return <Spinner label={t('common.loading')} />
  return (
    <>
      {offline && <div className="offline-banner">{t('common.offline')}</div>}
      {view.phase === 'lobby' && <Lobby view={view} room={ctx} />}
      {view.phase === 'over' && <GameOver view={view} room={ctx} />}
      {['picking', 'judging', 'result'].includes(view.phase) && <Game view={view} room={ctx} />}
    </>
  )
}

function RoomGate({ code }) {
  const [session, setSession] = useState(() => storage.session(code))
  const [notice, setNotice] = useState(null)

  const onJoined = useCallback(
    (res) => {
      storage.setSession(code, res)
      setNotice(null)
      setSession(storage.session(code))
    },
    [code],
  )

  const onLost = useCallback(
    (reason) => {
      storage.clearSession(code)
      setNotice(reason)
      setSession(null)
    },
    [code],
  )

  if (!session) return <JoinScreen code={code} notice={notice} onJoined={onJoined} />
  return <RoomScreen code={code} session={session} onLost={onLost} />
}

export default function App() {
  const route = useRoute()
  return (
    <I18nProvider>
      <ToastProvider>
        <div className="app">
          {route.name === 'room' && <RoomGate key={route.code} code={route.code} />}
          {route.name === 'deck' && <DeckPage key={route.id} id={route.id} />}
          {route.name === 'home' && <Home />}
        </div>
      </ToastProvider>
    </I18nProvider>
  )
}

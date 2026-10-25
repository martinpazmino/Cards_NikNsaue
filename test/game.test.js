import test from 'node:test'
import assert from 'node:assert/strict'
import { PACKS } from '../shared/cards/index.js'
import { GameError, NO_CHANGE, joinPlayer, nextJudgeId } from '../shared/game.js'
import { RESULT_MS } from '../shared/constants.js'
import { fillPromptText } from '../shared/text.js'
import { viewFor } from '../shared/view.js'
import { checkCards } from '../scripts/check-cards.js'
import { answerCardCount, cardPick, everyonePlays, judgeFirst, makeRoom, nonJudges } from './helpers.js'

const humans = (s) => s.players.filter((p) => !p.bot)
const pick1Prompt = PACKS.clasico.prompts.find((p) => p.pick === 1).id
const pick2Prompt = PACKS.clasico.prompts.find((p) => p.pick === 2).id

function code(fn) {
  try {
    fn()
  } catch (e) {
    assert.ok(e instanceof GameError, `expected GameError, got ${e}`)
    return e.code
  }
  return null
}

test('built-in cards are valid', () => {
  assert.deepEqual(checkCards(), [])
})

test('a full game runs to a champion with consistent card counts and judge rotation', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro', 'Dani'], { settings: { maxScore: 3 } })
  const { s, ids, act } = room
  act(ids[0], { type: 'start' })
  const total = answerCardCount(s)
  const order = humans(s).map((p) => p.id)
  let judgeIndex = order.indexOf(s.round.judgeId)
  let rounds = 0
  while (s.phase !== 'over') {
    assert.ok(++rounds < 40, 'game should end')
    assert.equal(s.phase, 'picking')
    assert.equal(s.round.judgeId, order[judgeIndex % order.length], 'judge rotates in join order')
    for (const p of humans(s)) assert.equal(p.hand.length, 10)
    everyonePlays(room)
    assert.equal(s.phase, 'judging')
    assert.equal(s.round.subs.length, 3)
    judgeFirst(room)
    assert.equal(s.phase, 'result')
    assert.equal(answerCardCount(s), total, 'no card is lost or duplicated')
    act(s.round.judgeId, { type: 'next' })
    judgeIndex++
  }
  const champion = s.players.find((p) => p.id === s.champion)
  assert.equal(champion.score, 3)
  assert.equal(s.history.length, s.players.reduce((n, p) => n + p.score, 0))
})

test('cannot start without enough players; host-only actions are enforced', () => {
  const { s, ids, act } = makeRoom(['Ana', 'Beto'])
  assert.equal(code(() => act(ids[0], { type: 'start' })), 'NEED_PLAYERS')
  assert.equal(code(() => act(ids[1], { type: 'settings', patch: { rando: true } })), 'HOST_ONLY')
  act(ids[0], { type: 'settings', patch: { rando: true } })
  assert.equal(s.players.at(-1).bot, true, 'Tío Random joins as a bot')
  act(ids[0], { type: 'start' })
  assert.equal(s.phase, 'picking')
})

test('settings are validated', () => {
  const { s, ids, act } = makeRoom()
  assert.equal(code(() => act(ids[0], { type: 'settings', patch: { maxScore: 99 } })), 'BAD_SETTING')
  assert.equal(code(() => act(ids[0], { type: 'settings', patch: { evil: 1 } })), 'BAD_SETTING')
  act(ids[0], { type: 'settings', patch: { packs: ['picante', 'nope', 'picante'], maxScore: 10, timer: 60 } })
  assert.deepEqual(s.settings.packs, ['picante'])
  assert.equal(s.settings.maxScore, 10)
})

test('pick-2 prompts take two cards in order', () => {
  const room = makeRoom()
  const { s, ids, act } = room
  act(ids[0], { type: 'start' })
  s.round.prompt = pick2Prompt
  const p = nonJudges(s)[0]
  const [a, b] = p.hand
  assert.equal(code(() => act(p.id, { type: 'submit', cards: [a] })), 'WRONG_COUNT')
  assert.equal(code(() => act(p.id, { type: 'submit', cards: [a, a] })), 'NOT_IN_HAND')
  act(p.id, { type: 'submit', cards: [b, a] })
  assert.deepEqual(s.round.subs.find((x) => x.pid === p.id).cards, [b, a])
  assert.equal(p.hand.length, 8)
})

test('judges cannot play and players cannot play twice', () => {
  const { s, ids, act } = makeRoom()
  act(ids[0], { type: 'start' })
  s.round.prompt = pick1Prompt
  const judge = s.players.find((p) => p.id === s.round.judgeId)
  assert.equal(code(() => act(judge.id, { type: 'submit', cards: [judge.hand[0]] })), 'JUDGE_CANT_PLAY')
  const p = nonJudges(s)[0]
  act(p.id, { type: 'submit', cards: [p.hand[0]] })
  assert.equal(code(() => act(p.id, { type: 'submit', cards: [p.hand[0]] })), 'ALREADY_PLAYED')
})

test('retract gives the cards back', () => {
  const { s, ids, act } = makeRoom()
  act(ids[0], { type: 'start' })
  s.round.prompt = pick1Prompt
  const p = nonJudges(s)[0]
  const card = p.hand[3]
  act(p.id, { type: 'submit', cards: [card] })
  assert.ok(!p.hand.includes(card))
  act(p.id, { type: 'retract' })
  assert.ok(p.hand.includes(card))
  assert.equal(s.round.subs.length, 0)
})

test('write-in answers use blanks and winning ones join the group cards', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro'], { settings: { blanks: 1 } })
  const { s, ids, act } = room
  act(ids[0], { type: 'start' })
  s.round.prompt = pick1Prompt
  const [writer, other] = nonJudges(s)
  act(writer.id, { type: 'submit', cards: [{ w: '  la moto de   Beto. ' }] })
  assert.equal(writer.blanks, 0)
  act(other.id, { type: 'submit', cards: [other.hand[0]] })
  assert.equal(s.phase, 'judging')
  const judge = s.round.judgeId
  const sub = s.round.subs.find((x) => x.pid === writer.id)
  assert.equal(code(() => act(judge, { type: 'pick', subId: sub.id })), 'NOT_REVEALED')
  act(judge, { type: 'reveal', subId: sub.id })
  const res = act(judge, { type: 'pick', subId: sub.id })
  assert.equal(writer.score, 1)
  const saved = Object.values(s.custom).find((c) => c.text === 'la moto de Beto')
  assert.ok(saved, 'winning write-in saved as a custom answer')
  assert.equal(saved.by, writer.name)
  assert.deepEqual(res.effects.map((e) => e.type), ['deckAdd'])
  act(judge, { type: 'next' })
  if (s.round.judgeId !== writer.id) {
    s.round.prompt = pick1Prompt
    assert.equal(code(() => act(writer.id, { type: 'submit', cards: [{ w: 'otra' }] })), 'NO_BLANKS')
  }
})

test('the judge leaving mid-round skips it and returns played cards', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro', 'Dani'])
  const { s, ids, act } = room
  act(ids[0], { type: 'start' })
  s.round.prompt = pick1Prompt
  const judge = s.round.judgeId
  const order = humans(s).map((p) => p.id)
  const expectedNext = order[(order.indexOf(judge) + 1) % order.length]
  const p = nonJudges(s)[0]
  const card = p.hand[0]
  act(p.id, { type: 'submit', cards: [card] })
  const n = s.round.n
  act(judge, { type: 'leave' })
  assert.equal(s.phase, 'picking')
  assert.equal(s.round.n, n + 1)
  assert.equal(s.round.judgeId, expectedNext)
  assert.ok(p.hand.includes(card), 'card returned to its owner')
  assert.ok(!s.players.some((x) => x.id === judge))
})

test('a player leaving can complete the round; too few players returns to the lobby', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro', 'Dani'])
  const { s, ids, act } = room
  act(ids[0], { type: 'start' })
  s.round.prompt = pick1Prompt
  const [p1, p2, p3] = nonJudges(s)
  act(p1.id, { type: 'submit', cards: [p1.hand[0]] })
  act(p2.id, { type: 'submit', cards: [p2.hand[0]] })
  assert.equal(s.phase, 'picking')
  const host = s.hostId
  const kicker = host === p3.id ? p1.id : host
  if (host !== p3.id) act(kicker, { type: 'kick', pid: p3.id })
  else act(p3.id, { type: 'leave' })
  assert.equal(s.phase, 'judging', 'remaining players had all played')
  act(s.players.find((x) => x.id !== s.round.judgeId).id, { type: 'leave' })
  assert.ok(['lobby', 'picking', 'judging'].includes(s.phase))
  while (humans(s).length > 1) act(humans(s).at(-1).id, { type: 'leave' })
  assert.equal(s.phase, 'lobby')
})

test('host role moves to the next player when the host leaves', () => {
  const { s, ids, act } = makeRoom()
  act(ids[0], { type: 'leave' })
  assert.equal(s.hostId, ids[1])
  act(ids[1], { type: 'makeHost', pid: ids[3] })
  assert.equal(s.hostId, ids[3])
})

test('picking timer moves to judging, or skips the round when nobody played', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro', 'Dani'], { settings: { timer: 60 } })
  const { s, ids, act, clock } = room
  act(ids[0], { type: 'start' })
  s.round.prompt = pick1Prompt
  assert.equal(act(ids[1], { type: 'tick' }), NO_CHANGE)
  const n = s.round.n
  clock.now += 61_000
  act(ids[1], { type: 'tick' })
  assert.equal(s.phase, 'picking', 'nobody played: skipped')
  assert.equal(s.round.n, n + 1)
  s.round.prompt = pick1Prompt
  const p = nonJudges(s)[0]
  act(p.id, { type: 'submit', cards: [p.hand[0]] })
  clock.now += 61_000
  act(ids[2], { type: 'tick' })
  assert.equal(s.phase, 'judging')
  assert.equal(s.round.subs.length, 1)
  judgeFirst(room)
  assert.equal(s.phase, 'result')
  clock.now += RESULT_MS + 1
  act(ids[3], { type: 'tick' })
  assert.equal(s.phase, 'picking', 'timed games auto-advance after the result')
})

test('only the judge or host can advance early; others after the result delay', () => {
  const room = makeRoom()
  const { s, ids, act, clock } = room
  act(ids[0], { type: 'start' })
  everyonePlays(room)
  judgeFirst(room)
  const other = humans(s).find((p) => p.id !== s.round.judgeId && p.id !== s.hostId)
  assert.equal(code(() => act(other.id, { type: 'next' })), 'NOT_YET')
  clock.now += RESULT_MS
  act(other.id, { type: 'next' })
  assert.equal(s.phase, 'picking')
})

test('Tío Random plays every round and can win', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro'], { settings: { rando: true } })
  const { s, ids, act } = room
  act(ids[0], { type: 'start' })
  const bot = s.players.find((p) => p.bot)
  assert.equal(s.round.subs.filter((x) => x.pid === bot.id).length, 1)
  everyonePlays(room)
  const judge = s.round.judgeId
  const botSub = s.round.subs.find((x) => x.pid === bot.id)
  act(judge, { type: 'reveal', subId: botSub.id })
  act(judge, { type: 'pick', subId: botSub.id })
  assert.equal(bot.score, 1)
  assert.notEqual(nextJudgeId(s), bot.id)
  assert.equal(code(() => act(bot.id, { type: 'next' })), 'NOT_IN_ROOM')
})

test('group cards: validation, permissions, boost and removal', () => {
  const room = makeRoom()
  const { s, ids, act } = room
  const added = []
  for (let i = 0; i < 6; i++) added.push(act(ids[i % 4], { type: 'addCard', t: 'a', text: `respuesta del grupo ${i}` }).card)
  act(ids[1], { type: 'addCard', t: 'p', text: 'Lo que Beto nunca admitirá: _' })
  assert.equal(code(() => act(ids[2], { type: 'addCard', t: 'a', text: 'Respuesta del grupo 0' })), 'DUPLICATE')
  assert.equal(code(() => act(ids[2], { type: 'addCard', t: 'p', text: '_ _ _' })), 'TOO_MANY_BLANKS')
  assert.equal(code(() => act(ids[2], { type: 'addCard', t: 'a', text: 'tiene un ___' })), 'ANSWER_BLANK')
  const prompt = Object.values(s.custom).find((c) => c.t === 'p')
  assert.equal(prompt.text, 'Lo que Beto nunca admitirá: ___')
  assert.equal(prompt.pick, 1)
  // Caro (not host, not author) cannot delete Beto's card.
  assert.equal(code(() => act(ids[2], { type: 'removeCard', id: added[1].id })), 'FORBIDDEN')

  act(ids[0], { type: 'start' })
  const dealtOrUpNext = new Set([...s.players.flatMap((p) => p.hand), ...s.piles.a.slice(0, 20)])
  for (const c of added) assert.ok(dealtOrUpNext.has(c.id), 'custom answers are dealt early')

  const late = act(ids[3], { type: 'addCard', t: 'a', text: 'carta agregada en pleno juego' }).card
  assert.ok(s.piles.a.indexOf(late.id) <= Math.ceil(s.piles.a.length / 3), 'mid-game cards go near the top')
  act(ids[3], { type: 'removeCard', id: late.id })
  assert.ok(!s.piles.a.includes(late.id))
  assert.equal(viewFor(s, ids[3]).custom.mine.some((c) => c.id === late.id), false)
})

test('views never leak tokens, other hands or authors before the result', () => {
  const room = makeRoom()
  const { s, ids, act } = room
  act(ids[1], { type: 'addCard', t: 'a', text: 'el carro de Ana' })
  act(ids[0], { type: 'start' })
  const v0 = viewFor(s, ids[0], { now: 1 })
  const json = JSON.stringify(v0)
  for (const p of s.players) assert.ok(!json.includes(p.token), 'no tokens')
  for (const p of s.players.filter((x) => x.id !== ids[0])) {
    for (const c of p.hand) if (!s.players.find((x) => x.id === ids[0]).hand.includes(c)) assert.ok(!json.includes(`"${c}"`), 'no other hands')
  }
  assert.deepEqual(viewFor(s, ids[0]).custom.mine, [])
  assert.equal(viewFor(s, ids[1]).custom.mine.length, 1)
  everyonePlays(room)
  const judge = s.round.judgeId
  const jv = viewFor(s, judge)
  assert.ok(jv.round.subs.every((x) => x.pid === null && x.cards === null), 'anonymous and face down')
  act(judge, { type: 'reveal', subId: s.round.subs[0].id })
  const jv2 = viewFor(s, judge)
  assert.ok(jv2.round.subs[0].cards.length >= 1 && jv2.round.subs[0].pid === null)
  act(judge, { type: 'pick', subId: s.round.subs[0].id })
  const rv = viewFor(s, ids[0])
  assert.ok(rv.round.subs.every((x) => typeof x.pid === 'string' && x.cards))
  assert.equal(rv.round.winner, s.round.subs[0].id)
})

test('joining with the name of an offline player takes over their seat', () => {
  const room = makeRoom()
  const { s, ctx } = room
  const before = s.players.length
  const beto = s.players[1]
  assert.equal(
    (() => {
      try {
        joinPlayer(s, { id: 'px', token: 'new', name: 'beto', avatar: '🦜' }, ctx(), () => true)
      } catch (e) {
        return e.code
      }
    })(),
    'NAME_TAKEN',
  )
  const { player, reclaimed } = joinPlayer(s, { id: 'px', token: 'new', name: 'BETO', avatar: '🦜' }, ctx(), () => false)
  assert.equal(reclaimed, true)
  assert.equal(player.id, beto.id)
  assert.equal(beto.token, 'new')
  assert.equal(s.players.length, before)
})

test('players joining mid-game get a hand and can play', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro'])
  const { s, ids, act, ctx } = room
  act(ids[0], { type: 'start' })
  s.round.prompt = pick1Prompt
  const { player } = joinPlayer(s, { id: 'p9', token: 't9', name: 'Eva', avatar: '🦩' }, ctx(), () => false)
  assert.equal(player.hand.length, 10)
  everyonePlays(room)
  assert.equal(s.phase, 'judging')
  assert.ok(s.round.subs.some((x) => x.pid === 'p9'))
})

test('restart goes back to the lobby keeping group cards; end shows the podium', () => {
  const room = makeRoom()
  const { s, ids, act } = room
  act(ids[0], { type: 'addCard', t: 'a', text: 'el bigote de Dani' })
  act(ids[0], { type: 'start' })
  everyonePlays(room)
  judgeFirst(room)
  act(ids[0], { type: 'end' })
  assert.equal(s.phase, 'over')
  assert.ok(s.champion)
  act(ids[0], { type: 'restart' })
  assert.equal(s.phase, 'lobby')
  assert.ok(s.players.every((p) => p.score === 0 && p.hand.length === 0))
  assert.equal(Object.keys(s.custom).length, 1)
})

test('long games reshuffle the discard pile instead of running out', () => {
  const room = makeRoom(['Ana', 'Beto', 'Caro', 'Dani'], { settings: { packs: ['spanglish'], maxScore: 15, handSize: 12 } })
  const { s, ids, act } = room
  act(ids[0], { type: 'start' })
  const total = answerCardCount(s)
  for (let i = 0; i < 45 && s.phase !== 'over'; i++) {
    everyonePlays(room)
    judgeFirst(room)
    assert.equal(answerCardCount(s), total)
    act(s.round.judgeId, { type: 'next' })
  }
  assert.ok(s.round === null || s.round.n > 24, 'played past the number of prompts')
})

test('prompt filling handles case, punctuation and questions', () => {
  assert.equal(
    fillPromptText('Mi tía siempre llega con ___ y se va con ___.', ['La chancla.', 'Bad Bunny en falda']),
    'Mi tía siempre llega con la chancla y se va con Bad Bunny en falda.',
  )
  assert.equal(fillPromptText('___: el verdadero motivo.', ['la hora latina']), 'La hora latina: el verdadero motivo.')
  assert.equal(fillPromptText('¿Qué guarda mi abuela?', ['el cucuy']), '¿Qué guarda mi abuela? El cucuy')
  assert.equal(cardPick({ round: { prompt: pick2Prompt }, custom: {} }), 2)
})

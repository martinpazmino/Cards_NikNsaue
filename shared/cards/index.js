// Registry of built-in packs. Card ids are derived from a hash of the text so
// they stay stable when cards are added or reordered between deploys.

import clasico from './clasico.js'
import spanglish from './spanglish.js'
import picante from './picante.js'
import { pickCount } from '../text.js'

export const PACK_LIST = [clasico, spanglish, picante]

function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const CARDS = new Map()
export const PACKS = {}

for (const pack of PACK_LIST) {
  const prefix = pack.id.slice(0, 2)
  const prompts = pack.prompts.map((text) => ({ id: `${prefix}.p${hash(text)}`, text, pick: pickCount(text) }))
  const answers = pack.answers.map((text) => ({ id: `${prefix}.a${hash(text)}`, text }))
  for (const card of [...prompts, ...answers]) CARDS.set(card.id, card)
  PACKS[pack.id] = { ...pack, prompts, answers }
}

export const PACK_INFO = PACK_LIST.map((p) => ({
  id: p.id,
  emoji: p.emoji,
  name: p.name,
  description: p.description,
  adult: p.adult,
  prompts: p.prompts.length,
  answers: p.answers.length,
}))

export function builtinCard(id) {
  return CARDS.get(id) || null
}

// Validates the built-in packs: unique ids/texts, blank counts, lengths, style.
// Usage: npm run check:cards

import { PACK_LIST, PACKS } from '../shared/cards/index.js'
import { countBlanks } from '../shared/text.js'
import { LIMITS } from '../shared/constants.js'

export function checkCards() {
  const problems = []
  const seenIds = new Set()
  const seenTexts = new Map()

  for (const raw of PACK_LIST) {
    const pack = PACKS[raw.id]
    for (const card of [...pack.prompts, ...pack.answers]) {
      const isPrompt = pack.prompts.includes(card)
      const where = `${pack.id} ${isPrompt ? 'prompt' : 'answer'} "${card.text}"`
      if (seenIds.has(card.id)) problems.push(`duplicate id ${card.id}: ${where}`)
      seenIds.add(card.id)
      const key = card.text.toLocaleLowerCase('es')
      if (seenTexts.has(key)) problems.push(`duplicate text (${seenTexts.get(key)}): ${where}`)
      seenTexts.set(key, pack.id)
      if (card.text !== card.text.trim()) problems.push(`untrimmed: ${where}`)
      if (isPrompt) {
        if (countBlanks(card.text) > LIMITS.maxBlanks) problems.push(`too many blanks: ${where}`)
        if (card.text.length > LIMITS.promptMax) problems.push(`prompt too long: ${where}`)
      } else {
        if (countBlanks(card.text) > 0) problems.push(`answer with blank: ${where}`)
        if (/\.$/.test(card.text) && !/…$|\.\.\.$/.test(card.text)) problems.push(`answer ends with period: ${where}`)
        if (card.text.length > LIMITS.answerMax) problems.push(`answer too long: ${where}`)
      }
    }
  }
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const raw of PACK_LIST) {
    const pack = PACKS[raw.id]
    const pick2 = pack.prompts.filter((p) => p.pick === 2).length
    console.log(`${pack.emoji} ${pack.id}: ${pack.prompts.length} prompts (${pick2} pick-2), ${pack.answers.length} answers`)
  }
  const problems = checkCards()
  for (const p of problems) console.log('✗', p)
  console.log(problems.length ? `${problems.length} problem(s)` : '✓ all cards OK')
  process.exit(problems.length ? 1 : 0)
}

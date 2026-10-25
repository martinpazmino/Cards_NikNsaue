// Card text helpers: blanks, normalization and filling prompts with answers.

import { LIMITS } from './constants.js'

const BLANK_RE = /_+/g
// Control chars and invisible formatting marks (keeps U+200D so emoji sequences survive).
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u2028-\u202e]/g

export function cleanText(input) {
  return String(input ?? '')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Any run of underscores counts as one blank; store them as "___".
export function normalizePrompt(input) {
  return cleanText(input).replace(BLANK_RE, '___')
}

export function countBlanks(text) {
  return (String(text).match(BLANK_RE) || []).length
}

export function pickCount(text) {
  return Math.min(LIMITS.maxBlanks, Math.max(1, countBlanks(text)))
}

// Leading words that should be lowercase when an answer lands mid-sentence
// ("La chancla" -> "...con la chancla").
const LOWERABLE = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'tu', 'tus',
  'su', 'sus', 'ese', 'esa', 'esos', 'esas', 'este', 'esta', 'estos', 'estas',
  'al', 'del', 'lo', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'cuando',
  'que', 'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'ir', 'hacer', 'tener',
  'ser', 'estar', 'comer', 'decir', 'llorar', 'bailar', 'perrear', 'mucho', 'mucha',
  'the', 'a', 'an', 'my', 'your', 'his', 'her', 'our', 'their', 'some',
])

function firstLetterIndex(s) {
  const m = /\p{L}/u.exec(s)
  return m ? m.index : -1
}

export function capitalize(s) {
  const i = firstLetterIndex(s)
  if (i < 0) return s
  return s.slice(0, i) + s[i].toLocaleUpperCase('es') + s.slice(i + 1)
}

function lowerLeadingArticle(s) {
  const i = firstLetterIndex(s)
  if (i !== 0) return s
  const word = /^\p{L}+/u.exec(s)[0]
  if (!LOWERABLE.has(word.toLocaleLowerCase('es'))) return s
  if (word.length > 1 && word.slice(1) !== word.slice(1).toLocaleLowerCase('es')) return s
  return s[0].toLocaleLowerCase('es') + s.slice(1)
}

// Is the blank at the start of a sentence (so the answer should be capitalized)?
function startsSentence(before) {
  if (!before.trim()) return true
  return /([.!?…]\s+|[¿¡"“«'(]\s*)$/u.test(before)
}

function formatAnswer(answer, before) {
  let s = cleanText(answer).replace(/\.$/, '')
  return startsSentence(before) ? capitalize(s) : lowerLeadingArticle(s)
}

/**
 * Splits a prompt into renderable segments with the answers inserted.
 * Returns { segments, inline } where segments are
 *   { t: string } prompt text, { a: string } answer, { blank: true } unfilled blank.
 * When the prompt has no blanks (a question), answers are appended (inline=false).
 */
export function fillPrompt(prompt, answers = []) {
  const parts = String(prompt).split(BLANK_RE)
  const blanks = parts.length - 1
  if (blanks === 0) {
    const segments = [{ t: prompt }]
    for (const a of answers) if (a) segments.push({ a: capitalize(cleanText(a)) })
    return { segments, inline: false }
  }
  const segments = []
  parts.forEach((part, i) => {
    if (part) segments.push({ t: part })
    if (i < blanks) {
      const a = answers[i]
      segments.push(a ? { a: formatAnswer(a, parts.slice(0, i + 1).join('___')) } : { blank: true })
    }
  })
  return { segments, inline: true }
}

// Plain-text version, used for history and sharing.
export function fillPromptText(prompt, answers = []) {
  const { segments, inline } = fillPrompt(prompt, answers)
  return segments
    .map((s) => (s.t ?? (s.a ? (inline ? s.a : ` ${s.a}`) : '___')))
    .join('')
    .trim()
}

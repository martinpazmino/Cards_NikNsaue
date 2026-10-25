import { useMemo, useRef, useState } from 'react'
import { LIMITS } from '../../shared/constants.js'
import { cleanText, countBlanks, normalizePrompt } from '../../shared/text.js'
import { cx } from '../lib/cx.js'
import { buzz } from '../lib/device.js'
import { useI18n } from '../lib/i18n.jsx'
import { IDEAS } from '../lib/strings.js'
import { AnswerCard, PromptCard } from './Cards.jsx'
import { useToast } from './Toasts.jsx'

function pickIdeas(list, names, seed) {
  let a = Math.floor(seed * 2 ** 31)
  const rnd = () => {
    a = (a * 1103515245 + 12345) % 2 ** 31
    return a / 2 ** 31
  }
  const pool = names.length ? names : ['Luis']
  return [...list]
    .sort(() => rnd() - 0.5)
    .slice(0, 4)
    .map((tpl) => tpl.replaceAll('{n}', pool[Math.floor(rnd() * pool.length)]))
}

/**
 * Write personalized cards. `onAdd(t, text)` and `onRemove(id)` return promises.
 * `mine` lists the cards this person wrote.
 */
export function CardWriter({ names = [], mine = [], onAdd, onRemove, children }) {
  const { t, lang, errorText } = useI18n()
  const toast = useToast()
  const [type, setType] = useState('p')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [seed, setSeed] = useState(() => Math.random())
  const ref = useRef(null)
  const max = type === 'p' ? LIMITS.promptMax : LIMITS.answerMax
  const ideas = useMemo(() => pickIdeas(IDEAS[lang][type], names, seed), [lang, type, names, seed])
  const blanks = countBlanks(text)

  function insertBlank() {
    const el = ref.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const before = text.slice(0, start)
    const after = text.slice(end)
    const pad1 = before && !/\s$/.test(before) ? ' ' : ''
    const pad2 = after && !/^[\s.,:;!?…»)]/.test(after) ? ' ' : ''
    const next = `${before}${pad1}___${pad2}${after}`.slice(0, max)
    setText(next)
    requestAnimationFrame(() => {
      const pos = (before + pad1 + '___').length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  async function add(e) {
    e?.preventDefault()
    if (!cleanText(text) || busy) return
    setBusy(true)
    try {
      await onAdd(type, text)
      setText('')
      setSeed(Math.random())
      toast(t('writer.added'))
      buzz([8, 30, 8])
    } catch (err) {
      toast(errorText(err.code), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    try {
      await onRemove(id)
    } catch (err) {
      toast(errorText(err.code), { tone: 'error' })
    }
  }

  return (
    <div className="writer">
      <div className="segmented writer-type" role="radiogroup">
        {['p', 'a'].map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={type === k}
            className={cx('seg', type === k && 'is-on')}
            onClick={() => {
              setType(k)
              setText('')
            }}
          >
            <span className={cx('swatch', k === 'p' ? 'swatch-black' : 'swatch-white')} />
            {t(k === 'p' ? 'writer.prompt' : 'writer.answer')}
          </button>
        ))}
      </div>

      <div className={cx('writer-preview', !cleanText(text) && 'is-placeholder')}>
        {type === 'p' ? (
          <PromptCard
            prompt={{ text: normalizePrompt(text) || t('writer.promptExample'), pick: Math.min(2, Math.max(1, blanks)) }}
          />
        ) : (
          <AnswerCard card={{ text: cleanText(text) || t('writer.answerExample') }} />
        )}
      </div>

      <form className="writer-form" onSubmit={add}>
        <textarea
          ref={ref}
          value={text}
          maxLength={max}
          rows={2}
          placeholder={t(type === 'p' ? 'writer.promptPlaceholder' : 'writer.answerPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              add()
            }
          }}
          enterKeyHint="done"
          aria-label={t(type === 'p' ? 'writer.prompt' : 'writer.answer')}
        />
        <div className="writer-tools">
          {type === 'p' && (
            <button type="button" className="chip chip-strong" onClick={insertBlank} disabled={blanks >= 2}>
              {t('writer.insertBlank')}
            </button>
          )}
          <span className="counter">
            {text.length}/{max}
          </span>
        </div>
        {type === 'p' && <p className="small muted">{t('writer.blankHint')}</p>}
        <button type="submit" className="btn btn-primary" disabled={!cleanText(text) || busy}>
          {t('writer.add')}
        </button>
      </form>

      <div className="ideas">
        <p className="small muted">{t('writer.ideas')}</p>
        <div className="chips">
          {ideas.map((idea) => (
            <button
              key={idea}
              type="button"
              className="chip"
              onClick={() => {
                buzz(6)
                setText(idea)
              }}
            >
              {idea}
            </button>
          ))}
        </div>
      </div>

      <section className="mine">
        <h3>
          {t('writer.yours')} <span className="count">{mine.length}</span>
        </h3>
        {mine.length ? (
          <ul className="mine-list">
            {mine.map((c) => (
              <li key={c.id} className={cx('mine-card', c.t === 'p' ? 'is-prompt' : 'is-answer')}>
                <span>{c.text}</span>
                <button type="button" className="icon-btn" onClick={() => remove(c.id)} aria-label={t('common.delete')}>
                  🗑
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{t('writer.none')}</p>
        )}
        {children}
      </section>
    </div>
  )
}

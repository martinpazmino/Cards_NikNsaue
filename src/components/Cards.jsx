import { APP_NAME } from '../../shared/constants.js'
import { fillPrompt } from '../../shared/text.js'
import { cx } from '../lib/cx.js'
import { useI18n } from '../lib/i18n.jsx'

// An empty blank is an inline-block, which browsers may wrap away from the
// quotes and punctuation around it ("«" / "___»."). Glue them together.
const OPEN_PUNCT = /[«¿¡"“(']+$/
const CLOSE_PUNCT = /^[»"”)'.,;:!?…]+/

function renderSegments(segments, inline) {
  const out = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (s.t != null) {
      out.push(s.t)
    } else if (s.blank) {
      const prev = typeof out[out.length - 1] === 'string' ? out.pop() : ''
      const open = prev.match(OPEN_PUNCT)?.[0] ?? ''
      if (prev.length > open.length) out.push(prev.slice(0, prev.length - open.length))
      const next = segments[i + 1]
      const close = next?.t?.match(CLOSE_PUNCT)?.[0] ?? ''
      if (close) segments[i + 1] = { t: next.t.slice(close.length) }
      out.push(
        <span key={`b${i}`} className="nowrap">
          {open}
          <span className="blank" aria-label="___" />
          {close}
        </span>,
      )
    } else {
      out.push(
        <mark key={`a${i}-${s.a}`} className={cx('fill', !inline && 'fill-block')}>
          {s.a}
        </mark>,
      )
    }
  }
  return out.map((x, i) => (typeof x === 'string' ? <span key={`t${i}`}>{x}</span> : x))
}

function sizeOf(len) {
  if (len > 150) return 'xs'
  if (len > 105) return 's'
  if (len > 65) return 'm'
  return 'l'
}

// Black card. Answers (strings) fill the blanks and are highlighted.
export function PromptCard({ prompt, answers = [], className, children, compact = false }) {
  const { t } = useI18n()
  const { segments, inline } = fillPrompt(prompt.text, answers)
  const len = prompt.text.length + answers.join(' ').length * (inline ? 1 : 0.6)
  return (
    <div className={cx('card prompt', `size-${compact ? 's' : sizeOf(len)}`, className)}>
      <p className="card-text">{renderSegments(segments, inline)}</p>
      <footer className="card-foot">
        <span className="brand">{APP_NAME}</span>
        <span className="card-foot-right">
          {prompt.by && <span className="tag">✍️ {prompt.by}</span>}
          {prompt.pick === 2 && <span className="pick-badge">{t('card.pick2')}</span>}
        </span>
      </footer>
      {children}
    </div>
  )
}

// White card. Clickable when onClick is given.
export function AnswerCard({ card, selected, order, onClick, className, style, disabled }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={cx('card answer', selected && 'is-selected', card.w && 'is-written', className)}
      onClick={onClick}
      disabled={disabled}
      style={style}
      aria-pressed={onClick ? !!selected : undefined}
    >
      <span className="card-text">{card.text}</span>
      {order ? <span className="order">{order}</span> : null}
      <footer className="card-foot">
        {card.by ? (
          <span className="tag">✍️ {card.by}</span>
        ) : card.w ? (
          <span className="tag">✍️</span>
        ) : (
          <span className="brand">{APP_NAME}</span>
        )}
      </footer>
    </Tag>
  )
}

// A submission during judging: face down until the judge flips it.
export function SubmissionCard({ sub, index, focused, chosen, mine, winner, onClick, author }) {
  const { t } = useI18n()
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={cx('sub', sub.shown && 'is-shown', focused && 'is-focus', chosen && 'is-chosen', winner && 'is-winner')}
      onClick={onClick}
      data-sub={sub.id}
    >
      <div className="sub-inner">
        <div className="sub-face sub-back">
          <span className="sub-num">{t('judging.answer', { n: index + 1 })}</span>
          {onClick && <span className="sub-tap">{t('judging.tap')} 👆</span>}
          {mine && <span className="sub-mine">{t('judging.yours')}</span>}
          <span className="sub-pattern" aria-hidden="true" />
        </div>
        <div className="sub-face sub-front">
          {(sub.cards || []).map((c, i) => (
            <p key={i} className={cx('sub-answer', c.w && 'is-written')}>
              {sub.count > 1 && <span className="sub-order">{i + 1}</span>}
              <span className="card-text">{c.text}</span>
              {c.w && <span className="tag">✍️ {t('result.writeIn')}</span>}
            </p>
          ))}
          <div className="sub-meta">
            {mine && <span className="sub-mine">{t('judging.yours')}</span>}
            {author}
          </div>
        </div>
      </div>
    </Tag>
  )
}

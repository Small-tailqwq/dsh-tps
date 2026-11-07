// TPS badge: live tokens-per-second rendered inside the running-turn status
// row ("Deep diving…"), sharing that row's visibility lifecycle — the row
// exists only while a turn runs, so the badge disappears with it when the
// turn ends or a takeover panel hides the composer flow. The live rate rides
// a rolling window of token samples over the streaming partial, estimated
// from the partial's text and reasoning bytes; settled averages are the
// built-in StatsLine's job, not this plugin's. The badge shows the reading
// alone in a fixed `nn.nn` shape (zero while the rate is unavailable) and
// rolls changed digits like an odometer. A hover dwell fades the badge out
// (click-through while hidden) and a pause restores it; a restore while the
// cursor still rests on the badge does not restart the dwell — the timer
// begins only after the cursor leaves and re-enters.

import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UseSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TpsOverlay.module.css'

/** Hover dwell before the badge starts fading (ms). */
const HIDE_DWELL_MS = 2_000
/** Fade transition duration (ms) — the CSS transition in TpsOverlay.module.css. */
const FADE_MS = 300
/** Grace period (ms) between the cursor leaving the badge area and the restore. */
const HIDE_RESTORE_MS = 3_000
/** Cursor margin (px) around the badge counted as "on the badge" while hidden. */
const HIDE_AREA_PADDING = 8
/** Staleness re-evaluation cadence while a turn is running (ms). */
const LIVE_TICK_MS = 1_000
/** Odometer glyph roll duration (ms) — the matching CSS animation in TpsOverlay.module.css. */
const ROLL_MS = 320

/** Rolling window for live-rate samples. */
export const LIVE_WINDOW_MS = 5_000
/** Sample age beyond which the live rate reads as stale (stream paused). */
export const LIVE_STALE_MS = 1_500
/** Floor for the rate denominator so one fast sample does not explode the rate. */
export const LIVE_MIN_DURATION_MS = 1_000

/** One live-rate sample: estimated output tokens produced at a wall-clock instant. */
export interface TpsSample {
  /** Unix epoch ms when the sampled tokens landed. */
  at: number
  /** Estimated output tokens produced since the previous sample. */
  tokens: number
}

/**
 * Approximate the output tokens of one text/reasoning delta: the oc-tps
 * bytes/5 estimate.
 * @param text - the delta text.
 * @returns the token estimate.
 */
export function estimateDeltaTokens(text: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).byteLength / 5))
}

/**
 * Estimated tokens of a partial assistant projection via the bytes/5
 * approximation. Text and reasoning blocks only — tool-call frames carry
 * arguments, not visible output.
 * @param blocks - the partial's assistant blocks.
 * @returns the estimate.
 */
export function estimatePartialTokens(blocks: readonly { kind: string; text?: string }[]): number {
  let total = 0
  for (const block of blocks) {
    if (block.kind === 'text' || block.kind === 'reasoning') {
      total += estimateDeltaTokens(block.text ?? '')
    }
  }
  return total
}

/**
 * Append one sample, pruning entries that fell out of the window.
 * @param samples - the current window, oldest first.
 * @param sample - the new sample.
 * @returns the next window (a new array; the input stays untouched).
 */
export function pushSample(samples: readonly TpsSample[], sample: TpsSample): TpsSample[] {
  return [...samples.filter(prev => sample.at - prev.at <= LIVE_WINDOW_MS), sample]
}

/**
 * Live tokens/sec over the rolling window, computed at `now`. Null while no
 * sample is fresh enough (the stream is paused or has not produced yet) —
 * a stale reading must never masquerade as a live rate.
 * @param samples - the current window, oldest first.
 * @param now - evaluation instant (Unix epoch ms).
 * @returns the rate, or null when stale/empty.
 */
export function liveRate(samples: readonly TpsSample[], now: number): number | null {
  if (samples.length === 0) return null
  const last = samples[samples.length - 1]
  if (last === undefined || now - last.at > LIVE_STALE_MS) return null
  const relevant = samples.filter(sample => now - sample.at <= LIVE_WINDOW_MS)
  if (relevant.length === 0) return null
  const first = relevant[0]
  const lastRelevant = relevant[relevant.length - 1]
  if (first === undefined || lastRelevant === undefined) return null
  const durationMs = Math.max(lastRelevant.at - first.at, LIVE_MIN_DURATION_MS)
  const totalTokens = relevant.reduce((sum, sample) => sum + sample.tokens, 0)
  return totalTokens / (durationMs / 1_000)
}

/**
 * Fixed-shape rate label: two integer digits (zero-padded) and always two
 * decimals, so every column keeps the same width and the odometer only rolls
 * when a digit actually changes.
 * @param value - tokens per second.
 * @returns the label.
 */
export function formatRate(value: number): string {
  const [whole = '0', fraction = '00'] = Math.max(0, value).toFixed(2).split('.')
  return `${whole.padStart(2, '0')}.${fraction}`
}

/** Badge visibility lifecycle: shown → fading (hover dwell) → hidden (click-through) → shown (restore). */
export type BadgePhase = 'shown' | 'fading' | 'hidden'

/** Props: Session/Chat selectors plus the locale seat. */
export interface TpsOverlayProps {
  useSession: UseSession
  useChat: UseChat
  /** The badge's locale seat (the plugin's `tps` namespace). */
  t: PropsLocale<'tps'>['t']
}

/** A 2D point (client coordinates) and a rectangle (client geometry). */
export interface Point { x: number; y: number }
export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Whether a point falls inside a rectangle, inclusive of the edges.
 * @param point - the point.
 * @param rect - the rectangle.
 * @returns true when the point is inside.
 */
export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

/** Which way the reading rolls: rising values travel upward. */
type RollDirection = 'up' | 'down'

/**
 * Roll direction for one digit change. Digits compare as numbers so an
 * increase travels upward and a decrease downward; anything else (the decimal
 * point, if it ever changes) rolls upward.
 * @param from - the previous glyph.
 * @param to - the next glyph.
 * @returns the direction.
 */
function rollDirection(from: string, to: string): RollDirection {
  const before = Number.parseInt(from, 10)
  const after = Number.parseInt(to, 10)
  if (Number.isNaN(before) || Number.isNaN(after)) return 'up'
  return after >= before ? 'up' : 'down'
}

/**
 * One odometer column. The strip inside keeps the status label's line box, so
 * the digit's baseline matches the label; only a changed digit rolls.
 */
function RollingChar({ char }: { char: string }): ReactElement {
  const previous = useRef(char)
  const [outgoing, setOutgoing] = useState<{ char: string; direction: RollDirection } | null>(null)
  const [direction, setDirection] = useState<RollDirection>('up')

  useEffect(() => {
    if (previous.current === char) return
    const from = previous.current
    const nextDirection = rollDirection(from, char)
    previous.current = char
    setDirection(nextDirection)
    setOutgoing({ char: from, direction: nextDirection })
    const timer = window.setTimeout(() => { setOutgoing(null) }, ROLL_MS)
    return () => { window.clearTimeout(timer) }
  }, [char])

  return (
    <span className={css.column}>
      {outgoing !== null && (
        <span
          className={clsx(css.roller, outgoing.direction === 'up' ? css.exitUp : css.exitDown)}
          aria-hidden="true"
        >
          {outgoing.char}
        </span>
      )}
      <span className={clsx(css.roller, direction === 'up' ? css.enterUp : css.enterDown)}>
        {char}
      </span>
    </span>
  )
}

/**
 * One column per character. Keys count from the right so the decimals keep
 * their columns when the integer part grows; only digits that change roll.
 * @param props.text - the reading, e.g. `24.37`.
 * @returns the odometer.
 */
export function RollingNumber({ text }: { text: string }): ReactElement {
  const chars = [...text]
  return (
    <span className={css.odometer} aria-hidden="true">
      {chars.map((char, index) => (
        <RollingChar key={chars.length - index} char={char} />
      ))}
    </span>
  )
}

type TpsMountProps = TpsOverlayProps & { sessionId: string }

/** The dock supplies session hooks; the badge lives in that session's status row. */
export function TpsMount(props: TpsMountProps) {
  return <SessionTpsMount key={props.sessionId} {...props} />
}

function SessionTpsMount({ sessionId, ...props }: TpsMountProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [target, setTarget] = useState<HTMLSpanElement | null>(null)
  const running = props.useSession(snapshot => snapshot.running)

  useLayoutEffect(() => {
    const scope = anchor.current?.closest('[data-conversation-scroll]')
    if (!running || scope === undefined || scope === null) return

    let row: Element | null = null
    let container: HTMLSpanElement | null = null

    // The status row is Chat's own `RunningStatus` div. Its trailing span is the
    // icon + label line; the badge joins the end of that line.
    const contentOf = (statusRow: Element): Element | null => statusRow.lastElementChild

    const reconcile = () => {
      const next = scope.querySelector('[data-chat-running]') ?? null
      if (next !== row) {
        container?.remove()
        row = next
        container = next === null ? null : document.createElement('span')
        if (container !== null) container.dataset.tpsMount = ''
        const content = next === null ? null : contentOf(next)
        if (content !== null && container !== null) content.appendChild(container)
        setTarget(container)
      }
      // React may re-render the status line later. Only our container moves;
      // host-owned children retain their original parent.
      if (row !== null && container !== null) {
        const content = contentOf(row)
        if (content !== null && content.lastChild !== container) content.appendChild(container)
      }
    }

    const observer = new MutationObserver(records => {
      // Streaming message interiors do not change the status seat. Watch status
      // row changes (including a replaced row), without rescanning each delta.
      if (row === null || !scope.contains(row) || records.some(record =>
        record.target === row || row.contains(record.target) || record.target.contains(row),
      )) reconcile()
    })
    observer.observe(scope, { childList: true, subtree: true })
    reconcile()
    return () => {
      observer.disconnect()
      container?.remove()
      setTarget(null)
    }
  }, [running, sessionId])

  return <>
    <span ref={anchor} hidden data-tps-anchor="" />
    {running && target !== null && createPortal(<TpsOverlay {...props} />, target)}
  </>
}

export const TpsOverlay = memo(function TpsOverlay({ useSession, useChat, t }: TpsOverlayProps) {
  const running = useSession(s => s.running)
  const partial = useChat(s => s.legacy.partial)

  // Live-rate sampling: the effect runs per partial publication (the runtime
  // publishes the partial on every visible delta). Each delta appends an
  // estimated-token sample; a step boundary restarts the window (the new
  // step's observed content opens it, so a fresh stream shows a rate from its
  // first chunk instead of a blank until the second delta).
  const samplesRef = useRef<TpsSample[]>([])
  const stepKeyRef = useRef<string | null>(null)
  const lastTokensRef = useRef(0)
  const [live, setLive] = useState<number | null>(null)

  useEffect(() => {
    if (!running || partial === null) {
      samplesRef.current = []
      stepKeyRef.current = null
      lastTokensRef.current = 0
      setLive(null)
      return
    }
    const stepKey = `${partial.turn}:${partial.step}`
    const total = estimatePartialTokens(partial.blocks)
    if (stepKey !== stepKeyRef.current) {
      stepKeyRef.current = stepKey
      lastTokensRef.current = total
      samplesRef.current = total > 0 ? pushSample([], { at: Date.now(), tokens: total }) : []
      setLive(total > 0 ? liveRate(samplesRef.current, Date.now()) : null)
      return
    }
    const delta = Math.max(0, total - lastTokensRef.current)
    lastTokensRef.current = total
    if (delta > 0) {
      samplesRef.current = pushSample(samplesRef.current, { at: Date.now(), tokens: delta })
    }
    setLive(liveRate(samplesRef.current, Date.now()))
  }, [running, partial])

  // While a turn runs, re-evaluate the live rate on a cadence so a paused
  // stream ages to null instead of freezing the last reading.
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setLive(samplesRef.current.length > 0 ? liveRate(samplesRef.current, Date.now()) : null)
    }, LIVE_TICK_MS)
    return () => { window.clearInterval(timer) }
  }, [running])

  // Hover-fade lifecycle: dwelling on the badge fades it out (the hidden
  // class drops pointer events, so the cursor passes through to whatever is
  // underneath). While hidden the badge stays hidden for as long as the
  // cursor remains on or near its area; once the cursor moves away, a short
  // grace period elapses before it restores — long enough to copy nearby
  // text without the badge popping back under the cursor — and the restore
  // is cancelled if the cursor returns to the badge area meanwhile. Driven
  // by the window mousemove listener (the badge itself cannot see pointer
  // events while hidden). Because the restore only ever happens with the
  // cursor already outside, no synthetic enter can restart the dwell, and a
  // parked cursor can never loop the cycle. Leaving during the dwell or the
  // fade cancels the cycle.
  const badgeRef = useRef<HTMLSpanElement | null>(null)
  const mousePosRef = useRef<Point | null>(null)
  const phaseRef = useRef<BadgePhase>('shown')
  const [phase, setPhase] = useState<BadgePhase>('shown')
  const dwellRef = useRef<number>(0)
  const fadeRef = useRef<number>(0)
  const restoreRef = useRef<number>(0)

  const updatePhase = (next: BadgePhase): void => {
    phaseRef.current = next
    setPhase(next)
  }

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      mousePosRef.current = { x: event.clientX, y: event.clientY }
      if (phaseRef.current !== 'hidden') return
      const badge = badgeRef.current
      const pos = mousePosRef.current
      if (badge === null || pos === null) return
      const rect = badge.getBoundingClientRect()
      const inside = pointInRect(pos, {
        left: rect.left - HIDE_AREA_PADDING,
        top: rect.top - HIDE_AREA_PADDING,
        right: rect.right + HIDE_AREA_PADDING,
        bottom: rect.bottom + HIDE_AREA_PADDING,
      })
      if (inside) {
        // Back on or near the badge: cancel any pending restore.
        window.clearTimeout(restoreRef.current)
        restoreRef.current = 0
      } else if (restoreRef.current === 0) {
        // Left the area: start the delayed restore (one timer only).
        restoreRef.current = window.setTimeout(() => {
          restoreRef.current = 0
          window.clearTimeout(dwellRef.current)
          window.clearTimeout(fadeRef.current)
          updatePhase('shown')
        }, HIDE_RESTORE_MS)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.clearTimeout(dwellRef.current)
      window.clearTimeout(fadeRef.current)
      window.clearTimeout(restoreRef.current)
    }
  }, [])

  const onMouseEnter = (): void => {
    if (phase !== 'shown') return
    dwellRef.current = window.setTimeout(() => {
      updatePhase('fading')
      fadeRef.current = window.setTimeout(() => {
        updatePhase('hidden')
      }, FADE_MS)
    }, HIDE_DWELL_MS)
  }

  const onMouseLeave = (): void => {
    window.clearTimeout(dwellRef.current)
    window.clearTimeout(fadeRef.current)
    if (phase === 'fading') updatePhase('shown')
  }

  // The badge mounts with the running row and shows the fixed zero reading
  // until the first value lands, so the row never grows a badge mid-stream.
  // Mid-turn pauses fall back to the same zero reading.
  const liveText = live === null ? t('zero') : formatRate(live)
  return (
    <span
      ref={badgeRef}
      className={clsx(
        css.root,
        css.enter,
        phase === 'fading' && css.fading,
        phase === 'hidden' && css.hidden,
      )}
      data-tps-badge=""
      aria-label={t('value', { live: liveText })}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <RollingNumber text={t('value', { live: liveText })} />
    </span>
  )
})

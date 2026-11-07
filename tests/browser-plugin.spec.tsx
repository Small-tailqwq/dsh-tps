// @vitest-environment jsdom
/**
 * dsh-tps standalone tests: the plugin registers the TpsMount entry at
 * conversation.composer.dock (verified against the pure SlotCore registry —
 * the standalone build avoids the harness SlotTestRuntime deep-import chain),
 * the hover-fade lifecycle fades the badge out after the dwell and restores
 * it after the pause (click-through while hidden), and a restore while the
 * cursor still rests on the badge does not restart the dwell (leave-and-
 * re-enter required). Component-level rendering covers the direct props
 * contract. The node half is exercised over the same suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot, PartialAssistant } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, zh } from '../src/client/index.ts'
import { TpsMount, TpsOverlay, pointInRect } from '../src/client/TpsOverlay.tsx'
import css from '../src/client/TpsOverlay.module.css'
import { apply as nodeApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const sid = 's1' as SessionSnapshot['sessionId']
const EMPTY_LIST: readonly never[] = []

interface TpsSnapshot {
  running: boolean
  partial: PartialAssistant | null
}

/** A quiescent Session/Chat projection (open window, no traffic). */
function conversationSnapshot(): TpsSnapshot {
  return { running: false, partial: null }
}

/** A session that is mid-stream with one text partial. */
function runningSnapshot(): TpsSnapshot {
  return {
    ...conversationSnapshot(),
    running: true,
    partial: { turn: 1, step: 0, blocks: [{ kind: 'text', text: 'streaming text' }] },
  }
}

/** Selector-faithful Session stub over the lifecycle owner. */
function useSessionOf(snapshot: () => TpsSnapshot): SnapshotSelectorHook<SessionSnapshot> {
  return selector => selector({
    sessionId: sid,
    queue: [],
    pendingSubmissions: [],
    running: snapshot().running,
    subagent: null,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    promptAttempted: true,
    awaitingFirstTurn: false,
  })
}

/** Selector-faithful Chat stub over the target-owned partial. */
function useChatOf(snapshot: () => TpsSnapshot): SnapshotSelectorHook<ChatSnapshot> {
  return selector => selector({
    order: EMPTY_LIST,
    nodes: { get: () => undefined, values: () => EMPTY_LIST },
    locations: { getTurn: () => EMPTY_LIST, getStep: () => EMPTY_LIST },
    navigation: { items: () => EMPTY_LIST },
    timeline: { turnOrder: EMPTY_LIST, turns: new Map() },
    legacy: {
      nodes: EMPTY_LIST,
      turnTimings: new Map(),
      turnEnds: new Map(),
      partial: snapshot().partial,
      runningCalls: EMPTY_LIST,
    },
  })
}

/** Make the badge report a non-empty client rect (jsdom returns all-zero). */
function mockBadgeRect(rect: { left: number; top: number; right: number; bottom: number }): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
}

/** Translate stub over the plugin dictionary (key fallback like LocaleService). */
function makeTranslate(dict: Record<string, string>): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    const template = dict[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

const t = makeTranslate(zh)

/** The badge's accessible reading — odometer cells also hold outgoing glyphs. */
function badgeLabel(container: HTMLElement): string | null {
  return container.querySelector('[data-tps-badge]')?.getAttribute('aria-label') ?? null
}

describe('pointInRect', () => {
  it('includes points on the edges and excludes outside points', () => {
    const rect = { left: 10, top: 20, right: 110, bottom: 50 }
    expect(pointInRect({ x: 10, y: 20 }, rect)).toBe(true)
    expect(pointInRect({ x: 110, y: 50 }, rect)).toBe(true)
    expect(pointInRect({ x: 60, y: 35 }, rect)).toBe(true)
    expect(pointInRect({ x: 9, y: 35 }, rect)).toBe(false)
    expect(pointInRect({ x: 60, y: 51 }, rect)).toBe(false)
  })
})

describe('ui-tps plugin registration', () => {
  it('registers the session dock entry once the slot is declared', async () => {
    const core = new SlotCore()
    // The built-in root declares the slot (declaring is claiming).
    core.register(
      { name: 'root', children: { 'conversation.composer.dock': { kind: 'list', scope: 'session' } } },
      (() => null) as never,
    )
    core.register({ name: 'conversation.composer.dock', id: 'tps', locale: 'tps' }, TpsMount)
    const entries = core.entries('conversation.composer.dock')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.locale).toBe('tps')
    expect(entries[0]?.component).toBe(TpsMount)

    const snapshot = runningSnapshot()
    const view = render(<div data-conversation-scroll="">
      <div data-chat-flow="">
        <div data-chat-running="">
          <span aria-hidden="true">status</span>
          <span><span>考え中…</span></span>
        </div>
      </div>
      <TpsMount sessionId="one" useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />
    </div>)
    const flow = view.container.querySelector('[data-chat-flow]')!
    const row = flow.querySelector('[data-chat-running]')!
    const content = row.lastElementChild!
    expect(content.querySelector('[data-tps-badge]')).not.toBeNull()
    await act(async () => {
      content.firstChild!.textContent = 'جارٍ التفكير…'
      const clock = document.createElement('span')
      clock.textContent = '15s'
      content.appendChild(clock)
    })
    expect(content.lastChild).toBe(content.querySelector('[data-tps-mount]'))
    expect(row.parentElement).toBe(flow)
    const replacement = document.createElement('div')
    replacement.setAttribute('data-chat-running', '')
    replacement.innerHTML = '<span aria-hidden="true">status</span><span><span>Pensando…</span></span>'
    await act(async () => { row.replaceWith(replacement) })
    expect(row.querySelector('[data-tps-mount]')).toBeNull()
    expect(replacement.querySelector('[data-tps-badge]')).not.toBeNull()
  })

  it('declared plugin surface matches the apply contract', () => {
    expect(inject).toEqual(['slots', 'locale'])
    expect(typeof apply).toBe('function')
  })

  it('drops the session dock entry when the registration disposes (HMR safety)', async () => {
    const core = new SlotCore()
    core.register(
      { name: 'root', children: { 'conversation.composer.dock': { kind: 'list', scope: 'session' } } },
      (() => null) as never,
    )
    const dispose = core.register({ name: 'conversation.composer.dock', id: 'tps', locale: 'tps' }, TpsMount)
    expect(core.entries('conversation.composer.dock')).toHaveLength(1)
    dispose()
    expect(core.entries('conversation.composer.dock')).toHaveLength(0)

    const snapshot = runningSnapshot()
    const scope = document.createElement('div')
    scope.setAttribute('data-conversation-scroll', '')
    const flow = document.createElement('div')
    flow.setAttribute('data-chat-flow', '')
    const row = document.createElement('div')
    row.setAttribute('data-chat-running', '')
    const status = document.createElement('span')
    status.setAttribute('aria-hidden', 'true')
    const content = document.createElement('span')
    content.textContent = '深度求索中'
    row.append(status, content)
    flow.appendChild(row)
    const dock = document.createElement('div')
    scope.append(flow, dock)
    document.body.appendChild(scope)
    const view = render(<TpsMount sessionId="one" useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />, { container: dock })
    expect(row.querySelector('[data-tps-mount]')).not.toBeNull()
    view.unmount()
    await act(async () => { row.appendChild(document.createElement('span')) })
    expect(row.querySelector('[data-tps-mount]')).toBeNull()
    expect(row.parentElement).toBe(flow)
    scope.remove()
  })
})

describe('TpsOverlay component', () => {
  it('shows the fixed zero reading until a value lands and returns to it on pauses', () => {
    let snapshot = conversationSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    // The badge is present from the start in the fixed zero shape.
    expect(badgeLabel(view.container)).toBe('00.00')

    // The first value arrives → the reading replaces the zeros.
    snapshot = runningSnapshot()
    view.rerender(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    expect(badgeLabel(view.container)).toBe('03.00')

    // A mid-turn pause returns to the zero reading (and recovery does not
    // remount the badge).
    snapshot = { ...snapshot, partial: null }
    view.rerender(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    expect(badgeLabel(view.container)).toBe('00.00')
    snapshot = runningSnapshot()
    view.rerender(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    expect(badgeLabel(view.container)).toBe('03.00')
  })

  it('samples the streaming partial into a live rate and refreshes on deltas', async () => {
    vi.useFakeTimers()
    let snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    expect(badgeLabel(view.container)).toBe('03.00')

    // A delta lands at t=2000: one more estimated token over a 2s span.
    snapshot = {
      ...snapshot,
      partial: { turn: 1, step: 0, blocks: [{ kind: 'text', text: 'streaming text more' }] },
    }
    await act(async () => { vi.advanceTimersByTime(2_000) })
    view.rerender(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    // 3 tokens at t≈0 + 1 token at t=2000 → 4 / 2s = 2.00.
    expect(badgeLabel(view.container)).toBe('02.00')
  })

  it('resets the live base when the streaming step changes', async () => {
    vi.useFakeTimers()
    let snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    expect(badgeLabel(view.container)).toBe('03.00')

    // A new step restarts accumulation: the previous step's samples drop and
    // the new step's observed content opens a fresh window. 100 × 'x' is 20
    // estimated tokens (100 bytes / 5).
    snapshot = {
      ...snapshot,
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'x'.repeat(100) }] },
    }
    view.rerender(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    expect(badgeLabel(view.container)).toBe('20.00') // 20 tokens

    // The next delta of the new step appends: 5 more x's → 1 token.
    snapshot = {
      ...snapshot,
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'x'.repeat(105) }] },
    }
    await act(async () => { vi.advanceTimersByTime(500) })
    view.rerender(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    // 20 tokens at t≈0 + 1 at t=500 → 21 over the 1s floor.
    expect(badgeLabel(view.container)).toBe('21.00')
  })

  it('ages the live rate to the zero reading while the stream pauses', async () => {
    vi.useFakeTimers()
    const snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    expect(badgeLabel(view.container)).toBe('03.00')

    // No new deltas: the cadence tick ages the sample past LIVE_STALE_MS.
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(badgeLabel(view.container)).toBe('00.00')
  })

  it('fades out after the hover dwell and stays hidden while the cursor stays on it', async () => {
    vi.useFakeTimers()
    mockBadgeRect({ left: 0, top: 0, right: 100, bottom: 30 })
    const snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    const badge = view.container.querySelector('[data-tps-badge]')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain(css.root)
    expect(badge!.className).not.toContain(css.hidden)

    // The cursor moves onto the badge, then dwells it into the hidden state.
    fireEvent.mouseMove(window, { clientX: 50, clientY: 15 })
    fireEvent.mouseEnter(badge!)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(badge!.className).toContain(css.fading)
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(badge!.className).toContain(css.hidden)

    // A parked cursor keeps it hidden: no auto-restore, no re-fade cycle.
    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(badge!.className).toContain(css.hidden)
    expect(badge!.className).not.toContain(css.fading)

    // The cursor leaves the badge area: the restore waits the grace period
    // (copying nearby text must not be interrupted by a popping badge).
    fireEvent.mouseMove(window, { clientX: 200, clientY: 15 })
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(badge!.className).toContain(css.hidden)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(badge!.className).not.toContain(css.hidden)
  })

  it('leaving during the dwell cancels the fade', async () => {
    vi.useFakeTimers()
    const snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    const badge = view.container.querySelector('[data-tps-badge]')!

    fireEvent.mouseEnter(badge)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    fireEvent.mouseLeave(badge)
    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(badge.className).not.toContain(css.fading)
    expect(badge.className).not.toContain(css.hidden)
  })

  it('restores only after the cursor leaves the badge area, and re-hovering restarts the dwell', async () => {
    vi.useFakeTimers()
    mockBadgeRect({ left: 0, top: 0, right: 100, bottom: 30 })
    const snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    const badge = view.container.querySelector('[data-tps-badge]')!

    // Dwell the badge into the hidden state with the cursor parked on it.
    fireEvent.mouseMove(window, { clientX: 50, clientY: 15 })
    fireEvent.mouseEnter(badge)
    await act(async () => { vi.advanceTimersByTime(2_300) })
    expect(badge.className).toContain(css.hidden)

    // A parked cursor never restarts the cycle on its own.
    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(badge.className).toContain(css.hidden)

    // The cursor leaves the badge area: the restore waits the 3s grace
    // period, and because the cursor is outside when it lands, no synthetic
    // enter can restart the dwell.
    fireEvent.mouseMove(window, { clientX: 200, clientY: 15 })
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(badge.className).toContain(css.hidden)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(badge.className).not.toContain(css.hidden)
    await act(async () => { vi.advanceTimersByTime(2_500) })
    expect(badge.className).not.toContain(css.fading)
    expect(badge.className).not.toContain(css.hidden)

    // Moving back onto the badge and hovering starts the timer normally.
    fireEvent.mouseMove(window, { clientX: 50, clientY: 15 })
    fireEvent.mouseEnter(badge)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(badge.className).toContain(css.fading)
  })

  it('stays hidden while the cursor is near the badge and restores after it leaves the padded area', async () => {
    vi.useFakeTimers()
    // Badge rect {0,0,100,30}; the padded hide area extends 8px beyond it.
    mockBadgeRect({ left: 0, top: 0, right: 100, bottom: 30 })
    const snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    const badge = view.container.querySelector('[data-tps-badge]')!

    fireEvent.mouseMove(window, { clientX: 50, clientY: 15 })
    fireEvent.mouseEnter(badge)
    await act(async () => { vi.advanceTimersByTime(2_300) })
    expect(badge.className).toContain(css.hidden)

    // Cursor near the badge: outside the rect (x=106 > right=100) but inside
    // the padded area (right=108) → still hidden.
    fireEvent.mouseMove(window, { clientX: 106, clientY: 15 })
    await act(async () => { vi.advanceTimersByTime(0) })
    expect(badge.className).toContain(css.hidden)

    // Cursor leaves the padded area (x=120 > 108): still hidden during the
    // grace period, then restores.
    fireEvent.mouseMove(window, { clientX: 120, clientY: 15 })
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(badge.className).toContain(css.hidden)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(badge.className).not.toContain(css.hidden)
  })

  it('a return to the badge area during the grace period cancels the pending restore', async () => {
    vi.useFakeTimers()
    mockBadgeRect({ left: 0, top: 0, right: 100, bottom: 30 })
    const snapshot = runningSnapshot()
    const view = render(<TpsOverlay useSession={useSessionOf(() => snapshot)} useChat={useChatOf(() => snapshot)} t={t} />)
    const badge = view.container.querySelector('[data-tps-badge]')!

    fireEvent.mouseMove(window, { clientX: 50, clientY: 15 })
    fireEvent.mouseEnter(badge)
    await act(async () => { vi.advanceTimersByTime(2_300) })
    expect(badge.className).toContain(css.hidden)

    // Leave the area (starts the 3s grace timer), then come back near it
    // before the timer fires: the restore is cancelled, still hidden.
    fireEvent.mouseMove(window, { clientX: 200, clientY: 15 })
    await act(async () => { vi.advanceTimersByTime(1_000) })
    fireEvent.mouseMove(window, { clientX: 106, clientY: 15 }) // inside the 8px margin
    await act(async () => { vi.advanceTimersByTime(3_000) })
    expect(badge.className).toContain(css.hidden)

    // Leaving again restarts the grace period and restores after it.
    fireEvent.mouseMove(window, { clientX: 200, clientY: 15 })
    await act(async () => { vi.advanceTimersByTime(3_000) })
    expect(badge.className).not.toContain(css.hidden)
  })

  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  LIVE_MIN_DURATION_MS, LIVE_STALE_MS, LIVE_WINDOW_MS,
  estimateDeltaTokens, estimatePartialTokens, formatRate,
  liveRate, pushSample,
} from '../src/client/TpsOverlay.tsx'

describe('estimateDeltaTokens', () => {
  it('applies the oc-tps bytes/5 approximation with a one-token floor', () => {
    expect(estimateDeltaTokens('')).toBe(1)
    expect(estimateDeltaTokens('hello')).toBe(1) // 5 bytes / 5
    expect(estimateDeltaTokens('a'.repeat(26))).toBe(6) // 5.2 → ceil → 6
  })

  it('counts multibyte text by UTF-8 bytes (CJK is 3 bytes per char)', () => {
    // 5 chars × 3 bytes = 15 bytes → 3 tokens.
    expect(estimateDeltaTokens('你好世界！')).toBe(3)
  })
})

describe('estimatePartialTokens', () => {
  it('counts text and reasoning blocks and skips tool-call frames', () => {
    const blocks = [
      { kind: 'text', text: 'a'.repeat(25) },
      { kind: 'reasoning', text: 'a'.repeat(10) },
      { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{}' },
      { kind: 'other', block: null },
    ]
    expect(estimatePartialTokens(blocks)).toBe(5 + 2)
  })

  it('treats a missing text field as empty', () => {
    expect(estimatePartialTokens([{ kind: 'text' }])).toBe(1)
  })
})

describe('pushSample', () => {
  it('appends the sample and prunes entries outside the window', () => {
    const base = [
      { at: 0, tokens: 10 },
      { at: 2_000, tokens: 20 },
    ]
    const next = pushSample(base, { at: LIVE_WINDOW_MS + 100, tokens: 5 })
    expect(next).toEqual([
      { at: 2_000, tokens: 20 },
      { at: LIVE_WINDOW_MS + 100, tokens: 5 },
    ])
  })
})

describe('liveRate', () => {
  it('returns null on an empty window', () => {
    expect(liveRate([], 1_000)).toBeNull()
  })

  it('returns null while the newest sample is stale', () => {
    const samples = [{ at: 0, tokens: 10 }]
    expect(liveRate(samples, LIVE_STALE_MS + 1)).toBeNull()
    expect(liveRate(samples, LIVE_STALE_MS)).not.toBeNull()
  })

  it('divides window tokens by the elapsed span, flooring the duration', () => {
    // 20 tokens over a 2s span → 10 tok/s.
    const samples = [
      { at: 0, tokens: 10 },
      { at: 2_000, tokens: 10 },
    ]
    expect(liveRate(samples, 2_000)).toBeCloseTo(10)
    // One fresh sample: the 1s floor keeps the rate finite.
    expect(liveRate([{ at: 0, tokens: 7 }], 500)).toBeCloseTo(7)
  })

  it('ignores samples that fell out of the window', () => {
    const samples = [
      { at: -1, tokens: 100 },
      { at: LIVE_WINDOW_MS, tokens: 5 },
    ]
    const rate = liveRate(samples, LIVE_WINDOW_MS)
    expect(rate).not.toBeNull()
    expect(rate!).toBeCloseTo(5 / (LIVE_MIN_DURATION_MS / 1_000))
  })
})

describe('formatRate', () => {
  it('keeps the fixed nn.nn shape with a zero-padded integer part', () => {
    expect(formatRate(123.4)).toBe('123.40')
    expect(formatRate(12.34)).toBe('12.34')
    expect(formatRate(1.234)).toBe('01.23')
    expect(formatRate(0)).toBe('00.00')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { isApplePlatform, isAppleWebKit } from '../browser'

afterEach(() => vi.unstubAllGlobals())

const stubNavigator = (platform: string, userAgent: string, maxTouchPoints = 0): void => {
  vi.stubGlobal('navigator', { platform, userAgent, maxTouchPoints })
}

describe('browser detection', () => {
  it('keeps Apple platform detection independent of the browser', () => {
    stubNavigator(
      'MacIntel',
      'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
    )

    expect(isApplePlatform()).toBe(true)
    expect(isAppleWebKit()).toBe(false)
  })

  it('detects Safari on macOS', () => {
    stubNavigator(
      'MacIntel',
      'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    )

    expect(isAppleWebKit()).toBe(true)
  })

  it('detects WebKit browsers on iOS and desktop-mode iPadOS', () => {
    stubNavigator('iPhone', 'Mozilla/5.0 CriOS/128.0 Mobile/15E148 Safari/604.1')
    expect(isAppleWebKit()).toBe(true)

    stubNavigator('MacIntel', 'Mozilla/5.0 CriOS/128.0 Mobile/15E148 Safari/604.1', 5)
    expect(isAppleWebKit()).toBe(true)
  })
})

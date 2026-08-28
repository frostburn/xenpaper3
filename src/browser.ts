/** Whether the current browser is running on an Apple platform. */
export const isApplePlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false

  const platform = navigator.platform.toLowerCase()
  return (
    platform.includes('mac') ||
    platform.includes('iphone') ||
    platform.includes('ipad') ||
    platform.includes('ipod')
  )
}

/** Whether the current browser uses WebKit on an Apple platform. */
export const isAppleWebKit = (): boolean => {
  if (!isApplePlatform()) return false

  const platform = navigator.platform.toLowerCase()
  if (
    platform.includes('iphone') ||
    platform.includes('ipad') ||
    platform.includes('ipod') ||
    (platform.includes('mac') && navigator.maxTouchPoints > 1)
  ) {
    // Every browser on iOS/iPadOS uses WebKit, including browsers with desktop-mode UAs.
    return true
  }

  const userAgent = navigator.userAgent.toLowerCase()
  return (
    userAgent.includes('safari') && !userAgent.includes('chrome') && !userAgent.includes('chromium')
  )
}

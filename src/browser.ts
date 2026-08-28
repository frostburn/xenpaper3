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

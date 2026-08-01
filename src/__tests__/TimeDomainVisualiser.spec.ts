import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import TimeDomainVisualiser from '../components/TimeDomainVisualiser.vue'

const props = {
  analyser: null,
  height: 100,
  lineWidth: 2,
  strokeStyle: 'black',
  width: 200,
}

describe('TimeDomainVisualiser', () => {
  it('draws from the analyser passed to initialize', () => {
    let drawFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      drawFrame = callback
      return 1
    })
    const getFloatTimeDomainData = vi.fn<(buffer: Float32Array<ArrayBuffer>) => void>((buffer) => {
      buffer.fill(0)
    })
    const analyser = { fftSize: 32, getFloatTimeDomainData } as unknown as AnalyserNode
    const wrapper = mount(TimeDomainVisualiser, { props })

    wrapper.vm.initialize(analyser)
    drawFrame!(0)

    expect(getFloatTimeDomainData).toHaveBeenCalledOnce()
    expect(getFloatTimeDomainData.mock.calls[0]![0]).toHaveLength(32)
    wrapper.unmount()
  })
})

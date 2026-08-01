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

  it('follows analyser prop replacements when initialized from the prop', async () => {
    let drawFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      drawFrame = callback
      return 1
    })
    const firstRead = vi.fn<(buffer: Float32Array<ArrayBuffer>) => void>()
    const secondRead = vi.fn<(buffer: Float32Array<ArrayBuffer>) => void>()
    const firstAnalyser = {
      fftSize: 16,
      getFloatTimeDomainData: firstRead,
    } as unknown as AnalyserNode
    const secondAnalyser = {
      fftSize: 64,
      getFloatTimeDomainData: secondRead,
    } as unknown as AnalyserNode
    const wrapper = mount(TimeDomainVisualiser, {
      props: { ...props, analyser: firstAnalyser },
    })

    await wrapper.setProps({ analyser: secondAnalyser })
    drawFrame!(0)

    expect(firstRead).not.toHaveBeenCalled()
    expect(secondRead).toHaveBeenCalledOnce()
    expect(secondRead.mock.calls[0]![0]).toHaveLength(64)
    wrapper.unmount()
  })

  it('preserves an analyser passed explicitly when the prop changes', async () => {
    let drawFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      drawFrame = callback
      return 1
    })
    const propRead = vi.fn<(buffer: Float32Array<ArrayBuffer>) => void>()
    const explicitRead = vi.fn<(buffer: Float32Array<ArrayBuffer>) => void>()
    const propAnalyser = {
      fftSize: 16,
      getFloatTimeDomainData: propRead,
    } as unknown as AnalyserNode
    const explicitAnalyser = {
      fftSize: 32,
      getFloatTimeDomainData: explicitRead,
    } as unknown as AnalyserNode
    const wrapper = mount(TimeDomainVisualiser, { props })

    wrapper.vm.initialize(explicitAnalyser)
    await wrapper.setProps({ analyser: propAnalyser })
    drawFrame!(0)

    expect(propRead).not.toHaveBeenCalled()
    expect(explicitRead).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})

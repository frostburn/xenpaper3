export const UNARY_MATH_FUNCTIONS = [
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atanh',
  'cbrt',
  'ceil',
  'cos',
  'cosh',
  'clz32',
  'exp',
  'expm1',
  'floor',
  'fround',
  'log',
  'log10',
  'log1p',
  'log2',
  'round',
  'sign',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
  'trunc',
] as const

export const MULTI_MATH_FUNCTIONS = ['atan2', 'hypot', 'imul', 'max', 'min', 'pow'] as const

export const WORKLET_SOURCE = `
/** Base class for stoppable, sample-by-sample SW Patch worklets. */
class SwPatchWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.stopped = false
    this.port.onmessage = ({ data }) => { if (data === 'stop') this.stopped = true }
  }
  process(inputs, outputs) {
    if (this.stopped) return false
    const output = outputs[0] || []
    for (let channel = 0; channel < output.length; channel++) {
      for (let sample = 0; sample < output[channel].length; sample++) {
        const values = inputs.map(input => {
          const source = input[channel] || input[0]
          return source ? source[sample] : 0
        })
        output[channel][sample] = this.transform(...values)
      }
    }
    return true
  }
}
class SwPatchInvertProcessor extends SwPatchWorkletProcessor {
  transform(value) { return 1 / value }
}
class SwPatchAtodbProcessor extends SwPatchWorkletProcessor {
  transform(value) { return 20 * Math.log10(Math.abs(value)) }
}
class SwPatchDbtoaProcessor extends SwPatchWorkletProcessor {
  transform(value) { return 10 ** (value / 20) }
}
class SwPatchModuloProcessor extends SwPatchWorkletProcessor {
  transform(left, right) {
    const remainder = ((left % right) + right) % right
    return Object.is(remainder, -0) ? 0 : remainder
  }
}
class SwPatchLessThanProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a < b) } }
class SwPatchGreaterThanProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a > b) } }
class SwPatchLessThanOrEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a <= b) } }
class SwPatchGreaterThanOrEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a >= b) } }
class SwPatchEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a === b) } }
class SwPatchNotEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a !== b) } }
class SwPatchWhereProcessor extends SwPatchWorkletProcessor { transform(test, yes, no) { return test ? yes : no } }
registerProcessor('sw-patch-invert', SwPatchInvertProcessor)
registerProcessor('sw-patch-atodb', SwPatchAtodbProcessor)
registerProcessor('sw-patch-dbtoa', SwPatchDbtoaProcessor)
registerProcessor('sw-patch-modulo', SwPatchModuloProcessor)
registerProcessor('sw-patch-less-than', SwPatchLessThanProcessor)
registerProcessor('sw-patch-greater-than', SwPatchGreaterThanProcessor)
registerProcessor('sw-patch-less-than-or-equal', SwPatchLessThanOrEqualProcessor)
registerProcessor('sw-patch-greater-than-or-equal', SwPatchGreaterThanOrEqualProcessor)
registerProcessor('sw-patch-equal', SwPatchEqualProcessor)
registerProcessor('sw-patch-not-equal', SwPatchNotEqualProcessor)
registerProcessor('sw-patch-where', SwPatchWhereProcessor)
${UNARY_MATH_FUNCTIONS.map(
  (name) => `
class SwPatchMath${name}Processor extends SwPatchWorkletProcessor {
  transform(value) { return Math.${name}(value) }
}
registerProcessor('sw-patch-${name}', SwPatchMath${name}Processor)`,
).join('')}
${MULTI_MATH_FUNCTIONS.map(
  (name) => `
class SwPatchMath${name}Processor extends SwPatchWorkletProcessor {
  transform(...values) { return Math.${name}(...values) }
}
registerProcessor('sw-patch-${name}', SwPatchMath${name}Processor)`,
).join('')}
class SwPatchScheduledSourceProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.startedAt = Infinity
    this.stoppedAt = Infinity
    this.ended = false
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') this.startedAt = data.when
      if (data.type === 'stop') this.stoppedAt = data.when
    }
  }
  valueAt() { return 0 }
  process(_inputs, outputs, parameters) {
    if (currentTime >= this.stoppedAt) {
      if (!this.ended) {
        this.ended = true
        this.port.postMessage('ended')
      }
      return false
    }
    const output = outputs[0] || []
    for (const channel of output) for (let sample = 0; sample < channel.length; sample++) {
      const time = currentTime + sample / sampleRate
      channel[sample] = time >= this.startedAt && time < this.stoppedAt
        ? this.valueAt(time, sample, parameters) : 0
    }
    return true
  }
}
class SwPatchTimeProcessor extends SwPatchScheduledSourceProcessor {
  valueAt(time) { return time - this.startedAt }
}
class SwPatchPhaserProcessor extends SwPatchScheduledSourceProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 440 },
      { name: 'detune', defaultValue: 0 },
    ]
  }
  constructor() { super(); this.phase = 0 }
  valueAt(_time, sample, parameters) {
    const frequency = parameters.frequency.length === 1 ? parameters.frequency[0] : parameters.frequency[sample]
    const detune = parameters.detune.length === 1 ? parameters.detune[0] : parameters.detune[sample]
    const value = this.phase
    const computedFrequency = frequency * 2 ** (detune / 1200)
    this.phase = ((this.phase + computedFrequency / sampleRate) % 1 + 1) % 1
    return value
  }
}
class SwPatchSoftOscillatorProcessor extends SwPatchPhaserProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 440 },
      { name: 'detune', defaultValue: 0 },
      { name: 'bite', defaultValue: 0.5 },
    ]
  }
  phaseAndBite(sample, parameters) {
    super.valueAt(0, sample, parameters)
    const rawBite = parameters.bite.length === 1 ? parameters.bite[0] : parameters.bite[sample]
    // Keep inverse-trigonometric inputs and the square transform away from
    // their singular limits. Individual shapes apply their own bite mapping.
    const bite = Math.min(1 - 1e-6, Math.max(1e-6, rawBite))
    return [bite, 2 * Math.PI * this.phase]
  }
}
class SwPatchSoftTriangleProcessor extends SwPatchSoftOscillatorProcessor {
  valueAt(_time, sample, parameters) {
    const [rawBite, angle] = this.phaseAndBite(sample, parameters)
    const bite = rawBite ** 0.4
    const sine = Math.sin(angle)
    return Math.asin(bite * sine) / Math.asin(bite)
  }
}
class SwPatchSoftSawtoothProcessor extends SwPatchSoftOscillatorProcessor {
  valueAt(_time, sample, parameters) {
    const [bite, angle] = this.phaseAndBite(sample, parameters)
    const sine = Math.sin(angle)
    const cosine = Math.cos(angle)
    return Math.atan(bite * sine / (1 + bite * cosine)) / Math.asin(bite)
  }
}
class SwPatchSoftSquareProcessor extends SwPatchSoftOscillatorProcessor {
  valueAt(_time, sample, parameters) {
    const [bite, angle] = this.phaseAndBite(sample, parameters)
    const shapedBite = 2 * bite / (1 - bite ** 2)
    return Math.atan(shapedBite * Math.sin(angle)) / (2 * Math.atan(bite))
  }
}
class SwPatchSoftParabolicProcessor extends SwPatchSoftOscillatorProcessor {
  valueAt(_time, sample, parameters) {
    const [rawBite, angle] = this.phaseAndBite(sample, parameters)
    const bite = rawBite ** 0.4
    const cosine = Math.cos(angle)
    const shapedCosine = Math.asin(bite * cosine)
    const shapedBite = Math.asin(bite)
    return (shapedCosine - (shapedCosine ** 2 - shapedBite ** 2) / Math.PI) / shapedBite
  }
}
class SwPatchNoiseProcessor extends SwPatchScheduledSourceProcessor {
  valueAt() { return Math.random() * 2 - 1 }
}
class SwPatchDrivenNoiseProcessor extends SwPatchScheduledSourceProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 440, minValue: 0 },
      { name: 'detune', defaultValue: 0 },
    ]
  }
  constructor(options) {
    super()
    const processorOptions = options.processorOptions || {}
    const colors = ['brown', 'pink', 'white', 'blue', 'violet']
    const interpolations = ['impulse', 'constant', 'linear']
    this.color = colors.includes(processorOptions.color) ? processorOptions.color : 'white'
    this.interpolation = interpolations.includes(processorOptions.interpolation)
      ? processorOptions.interpolation : 'constant'
    this.phase = 1
    this.currentValue = 0
    this.previousWhite = 0
    this.previousPink = 0
    this.brown = 0
    this.pinkOctaves = new Float64Array(15)
    this.pinkIndex = 0
    this.pinkChunk = []
    this.nextValue = this.coloredSample()
  }
  whiteSample() { return Math.random() * 2 - 1 }
  refillPinkChunk() {
    const chunk = new Float64Array(128)
    for (let sample = 0; sample < chunk.length; sample++) {
      this.pinkIndex = (this.pinkIndex + 1) >>> 0
      let octave = 0
      let index = this.pinkIndex
      while ((index & 1) === 0 && octave < this.pinkOctaves.length - 1) {
        octave += 1
        index >>>= 1
      }
      this.pinkOctaves[octave] = this.whiteSample()
      let sum = this.whiteSample()
      for (const value of this.pinkOctaves) sum += value
      chunk[sample] = sum / (this.pinkOctaves.length + 1)
    }
    // Treat the widest octave as a DC blocker for the chunk that will be
    // consumed next. This keeps slow random drift without accumulating bias.
    let mean = 0
    for (const value of chunk) mean += value
    mean /= chunk.length
    let peak = 0
    for (const value of chunk) peak = Math.max(peak, Math.abs(value - mean))
    this.pinkChunk = Array.from(chunk, value => peak === 0 ? 0 : (value - mean) / peak)
  }
  pinkSample() {
    if (this.pinkChunk.length === 0) this.refillPinkChunk()
    return this.pinkChunk.shift()
  }
  coloredSample() {
    const white = this.whiteSample()
    if (this.color === 'brown') {
      this.brown = (this.brown + 0.02 * white) / 1.02
      return Math.max(-1, Math.min(1, this.brown * 4))
    }
    if (this.color === 'violet') {
      const violet = (white - this.previousWhite) / 2
      this.previousWhite = white
      return violet
    }
    if (this.color === 'pink' || this.color === 'blue') {
      const pink = this.pinkSample()
      if (this.color === 'pink') return pink
      const blue = (pink - this.previousPink) * 1.5
      this.previousPink = pink
      return blue
    }
    return white
  }
  valueAt(_time, sample, parameters) {
    const frequency = parameters.frequency.length === 1 ? parameters.frequency[0] : parameters.frequency[sample]
    const detune = parameters.detune.length === 1 ? parameters.detune[0] : parameters.detune[sample]
    const effectiveFrequency = Math.min(sampleRate, Math.max(0, frequency * 2 ** (detune / 1200)))
    let triggered = false
    if (this.phase >= 1) {
      this.phase -= 1
      this.currentValue = this.nextValue
      this.nextValue = this.coloredSample()
      triggered = true
    }
    let value = this.currentValue
    if (this.interpolation === 'impulse') value = triggered ? this.currentValue : 0
    if (this.interpolation === 'linear') {
      value = this.currentValue + (this.nextValue - this.currentValue) * this.phase
    }
    this.phase += effectiveFrequency / sampleRate
    return value
  }
}
class SwPatchRandomProcessor extends SwPatchScheduledSourceProcessor {
  valueAt() { return Math.random() }
}
registerProcessor('sw-patch-time', SwPatchTimeProcessor)
registerProcessor('sw-patch-phaser', SwPatchPhaserProcessor)
registerProcessor('sw-patch-soft-triangle', SwPatchSoftTriangleProcessor)
registerProcessor('sw-patch-soft-sawtooth', SwPatchSoftSawtoothProcessor)
registerProcessor('sw-patch-soft-square', SwPatchSoftSquareProcessor)
registerProcessor('sw-patch-soft-parabolic', SwPatchSoftParabolicProcessor)
registerProcessor('sw-patch-noise', SwPatchNoiseProcessor)
registerProcessor('sw-patch-driven-noise', SwPatchDrivenNoiseProcessor)
registerProcessor('sw-patch-random', SwPatchRandomProcessor)
`

<script setup lang="ts">

// Dummy audio code just to get something going
const ctx = new AudioContext({latencyHint: 'interactive'})
const inputDelay = 0.01

class Synth {
  context: BaseAudioContext
  oscillatorType: 'sine' | 'square' | 'sawtooth' | 'triangle'

  constructor(context: BaseAudioContext) {
    this.context = context
    this.oscillatorType = 'triangle'
  }

  on(destination: AudioNode, start: number, pitch: AudioNode, velocity: number, attack = 0.1, decay = 0.2, sustain = 0.7, release = 0.3) {
    const osc = new OscillatorNode(this.context, {type: this.oscillatorType})
    const attackEnv = new GainNode(this.context, {gain: 0})
    const decayEnv = new GainNode(this.context, {gain: 1})
    osc.connect(attackEnv).connect(decayEnv).connect(destination)
    pitch.connect(osc.detune)

    osc.addEventListener('ended', () => {
      pitch.disconnect(osc.detune)
      decayEnv.disconnect(destination)
      attackEnv.disconnect(decayEnv)
      osc.disconnect(attackEnv)
    })

    osc.start(start)
    attackEnv.gain.setValueAtTime(0, start)

    attackEnv.gain.linearRampToValueAtTime(velocity, start + attack)

    decayEnv.gain.setValueAtTime(1, start + attack)
    decayEnv.gain.setTargetAtTime(sustain, start + attack, decay)

    let called = false

    function off(end: number) {
      if (called) {
        throw new Error('Multiple calls to a `once fn`.')
      }
      called = true

      attackEnv.gain.cancelAndHoldAtTime(end)
      decayEnv.gain.cancelAndHoldAtTime(end)
      decayEnv.gain.setTargetAtTime(0, end, release)

      const cutTime = end + 5 * release
      osc.stop(cutTime)

      return cutTime
    }

    return off.bind(this)
  }
}

const synth = new Synth(ctx)

const noteOffs = new Map()

window.addEventListener('keydown', (e) => {
  console.log('down', e.keyCode)
  if (noteOffs.has(e.keyCode)) {
    console.log('nope')
    return
  }
  const pitch = new ConstantSourceNode(ctx, {offset: 1200 * (e.keyCode % 10) / 10})
  pitch.start()
  const off = synth.on(ctx.destination, ctx.currentTime + inputDelay, pitch, 0.2)
  noteOffs.set(e.keyCode, [off, pitch])
})

window.addEventListener('keyup', (e) => {
  console.log('up', e.keyCode)
  if (noteOffs.has(e.keyCode)) {
    const [off, pitch] = noteOffs.get(e.keyCode)
    const cutTime = off(ctx.currentTime + inputDelay)
    pitch.stop(cutTime)
  }
  noteOffs.delete(e.keyCode)
})

</script>

<template>
  <h1>You did it!</h1>
  <p>
    Visit <a href="https://vuejs.org/" target="_blank" rel="noopener">vuejs.org</a> to read the
    documentation
  </p>
</template>

<style scoped></style>

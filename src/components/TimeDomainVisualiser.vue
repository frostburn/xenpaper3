<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue'

const props = defineProps<{
  analyser: AnalyserNode | null
  width: number
  height: number
  lineWidth: number
  strokeStyle: string
}>()

defineExpose({ initialize })

const canvas = useTemplateRef('canvas')
let animationFrame: number | undefined
let activeAnalyser: AnalyserNode | undefined
let buffer: Float32Array<ArrayBuffer> | undefined
let context: CanvasRenderingContext2D | null = null
let contextIsTranslated = false

function stopDrawing() {
  if (animationFrame !== undefined) {
    window.cancelAnimationFrame(animationFrame)
    animationFrame = undefined
  }
}

function draw() {
  if (context === null || activeAnalyser === undefined || buffer === undefined) return

  const numSamples = activeAnalyser.fftSize
  if (buffer.length !== numSamples) buffer = new Float32Array(numSamples)
  const offsetWidth = canvas.value?.offsetWidth || props.width

  context.lineWidth = (props.lineWidth * props.width) / offsetWidth
  context.strokeStyle = props.strokeStyle
  context.clearRect(-0.5, -0.5, props.width + 1, props.height + 1)
  context.beginPath()

  const dx = props.width / numSamples
  activeAnalyser.getFloatTimeDomainData(buffer)
  context.moveTo(0, props.height * 0.5 * (1 - buffer[0]!))
  for (let i = 1; i < numSamples; ++i) {
    const x = dx * i
    const y = props.height * 0.5 * (1 - buffer[i]!)
    context.lineTo(x, y)
  }
  context.stroke()
  animationFrame = window.requestAnimationFrame(draw)
}

function initialize(analyser?: AnalyserNode) {
  const resolvedAnalyser = analyser ?? props.analyser ?? undefined
  stopDrawing()
  activeAnalyser = resolvedAnalyser

  if (resolvedAnalyser === undefined) {
    buffer = undefined
    return
  }
  buffer = new Float32Array(resolvedAnalyser.fftSize)

  context = canvas.value?.getContext('2d') ?? null
  if (context !== null) {
    // Move origin to the middle of a pixel
    if (!contextIsTranslated) {
      context.translate(0.5, 0.5)
      contextIsTranslated = true
    }
    animationFrame = window.requestAnimationFrame(draw)
  }
}

onMounted(initialize)

onUnmounted(() => {
  stopDrawing()
})
</script>

<template>
  <canvas ref="canvas" :width="width" :height="height"> </canvas>
</template>

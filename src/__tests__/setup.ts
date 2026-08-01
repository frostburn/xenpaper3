import { vi } from 'vitest'

const context = {
  beginPath: vi.fn<() => void>(),
  clearRect: vi.fn<(x: number, y: number, width: number, height: number) => void>(),
  lineTo: vi.fn<(x: number, y: number) => void>(),
  lineWidth: 1,
  moveTo: vi.fn<(x: number, y: number) => void>(),
  stroke: vi.fn<() => void>(),
  strokeStyle: '',
  translate: vi.fn<(x: number, y: number) => void>(),
}

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  () => context as unknown as CanvasRenderingContext2D,
)

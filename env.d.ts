/// <reference types="vite/client" />

declare module 'audiobuffer-to-wav' {
  export default function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer
}

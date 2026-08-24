import { beatToNumber, type DawProject } from './project'

const tempoPoints = (project: DawProject) => {
  const points = project.globalTrack.tempoChanges
    .map(({ beat, bpm }) => ({ beat: beatToNumber(beat), bpm }))
    .filter(({ beat, bpm }) => beat >= 0 && bpm > 0)
    .sort((left, right) => left.beat - right.beat)
  if (!points.length || points[0]!.beat > 0) points.unshift({ beat: 0, bpm: 120 })
  return points
}

/** Integrate the piecewise-constant tempo map from beat zero. */
export const projectBeatToSeconds = (project: DawProject, targetBeat: number): number => {
  const points = tempoPoints(project)
  let seconds = 0
  let cursor = 0
  let bpm = points[0]!.bpm
  for (const point of points) {
    if (point.beat <= cursor) {
      bpm = point.bpm
      continue
    }
    if (point.beat >= targetBeat) break
    seconds += ((point.beat - cursor) * 60) / bpm
    cursor = point.beat
    bpm = point.bpm
  }
  return seconds + ((targetBeat - cursor) * 60) / bpm
}

/** Invert the tempo map so an audio clock can drive the beat playhead. */
export const projectSecondsToBeat = (project: DawProject, seconds: number): number => {
  const points = tempoPoints(project)
  let elapsed = 0
  let beat = 0
  let bpm = points[0]!.bpm
  for (const point of points) {
    if (point.beat <= beat) {
      bpm = point.bpm
      continue
    }
    const segment = ((point.beat - beat) * 60) / bpm
    if (elapsed + segment >= seconds) return beat + ((seconds - elapsed) * bpm) / 60
    elapsed += segment
    beat = point.beat
    bpm = point.bpm
  }
  return beat + ((seconds - elapsed) * bpm) / 60
}

import basics01 from './basics-01.json'
import basics02 from './basics-02.json'
import type { InstrumentSource } from '../../daw/project'

export type InteractiveTutorialDemo = {
  id: string
  title: string
  description?: string
  html?: string
  props: {
    source: string
    instrument: InstrumentSource
    gain: number
    laneSource: string
    simplified: boolean
    rows: number
    editorLabel: string
  }
}

// JSON imports widen instrument discriminants to strings.
export const interactiveTutorialPages = [basics01, basics02] as InteractiveTutorialDemo[][]

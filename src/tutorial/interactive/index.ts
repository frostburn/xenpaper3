import basics from './basics.json'
import advancedScoreConstruction from './advanced-score-construction.json'
import diatonicNotation from './diatonic-notation.json'
import diamondMosNotation from './diamond-mos-notation.json'
import additionalFeatures from './additional-features.json'
import type { InstrumentSource } from '../../daw/project'

export type InteractiveTutorialDemo = {
  id: string
  title: string
  description?: string
  html?: string
  // Warning codes intentionally demonstrated by this lesson.
  expectedWarnings?: string[]
  props?: {
    source: string
    instrument: InstrumentSource
    gain: number
    laneSource: string
    simplified: boolean
    rows: number
    editorLabel: string
  }
}

export type InteractiveTutorialPage = {
  index: number
  title: string
  demos: InteractiveTutorialDemo[]
}

let pageIndex = 0

function paginate(demos: InteractiveTutorialDemo[]): InteractiveTutorialPage[] {
  const pages: InteractiveTutorialPage[] = []
  for (let start = 0; start < demos.length; start += 10) {
    const pageDemos = demos.slice(start, start + 10)
    pages.push({
      index: pageIndex++,
      title: `${pageDemos[0]!.title} – ${pageDemos[pageDemos.length - 1]!.title}`,
      demos: pageDemos,
    })
  }
  return pages
}

// Each interactive chapter owns its content and complete snippet configuration.
// Keep chapter order and demo IDs stable to preserve page and example permalinks.
export const interactiveTutorialChapters = [
  { id: 'basics', title: 'Basics', demos: basics },
  { id: 'advanced', title: 'Advanced score construction', demos: advancedScoreConstruction },
  { id: 'diatonic', title: 'Diatonic notation', demos: diatonicNotation },
  { id: 'diamond-mos', title: 'Diamond-mos notation', demos: diamondMosNotation },
  { id: 'features', title: 'More score features', demos: additionalFeatures },
].map(({ id, title, demos }) => ({
  id,
  title,
  // JSON imports widen instrument discriminants to strings.
  pages: paginate(demos as InteractiveTutorialDemo[]),
}))

export const interactiveTutorialPageInfo = interactiveTutorialChapters.flatMap((chapter) =>
  chapter.pages.map((page) => ({ ...page, chapterTitle: chapter.title })),
)
export const interactiveTutorialPages = interactiveTutorialPageInfo.map((page) => page.demos)

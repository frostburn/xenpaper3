import basics01 from './basics-01.json'
import basics02 from './basics-02.json'
import titles from './titles.json'
import type { InstrumentSource } from '../../daw/project'
import { tutorialChapters } from '..'

export type InteractiveTutorialDemo = {
  id: string
  title: string
  description?: string
  html?: string
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

// Preserve the original demos' instruments, titles, and permalink IDs.
// JSON imports widen instrument discriminants to strings.
const configuredBasics = [...basics01, ...basics02] as InteractiveTutorialDemo[]
const chapterIds = ['basics', 'advanced', 'diatonic', 'diamond-mos'] as const
const chapterTitles = [
  [...configuredBasics.map((demo) => demo.title), ...titles.basics],
  titles.advanced,
  titles.diatonic,
  titles['diamond-mos'],
]
let pageIndex = 0

// Reuse all sidebar material so examples and explanations have one source of truth.
export const interactiveTutorialChapters = tutorialChapters.map((chapter, chapterIndex) => {
  const id = chapterIds[chapterIndex]!
  const material = chapter.sections.flatMap((section) => section.demos)
  const demos = material.map((demo, demoIndex): InteractiveTutorialDemo => {
    if (chapterIndex === 0 && demoIndex < configuredBasics.length)
      return configuredBasics[demoIndex]!
    const title = chapterTitles[chapterIndex]![demoIndex]!
    return {
      id: `${id}-${String(demoIndex + 1).padStart(2, '0')}`,
      title,
      description: demo.description,
      html: demo.html,
      props: demo.tune
        ? {
            source: demo.tune,
            instrument: { type: 'patch', patchPreset: 'default', oscillatorType: 'semisine' },
            gain: 0.35,
            laneSource: '@tempo(240bpm) @adsr(10ms, 100ms, 70%, 100ms)',
            simplified: true,
            rows: Math.max(3, Math.min(12, demo.tune.split('\n').length)),
            editorLabel: `${title} source`,
          }
        : undefined,
    }
  })
  const pages: InteractiveTutorialPage[] = []
  for (let start = 0; start < demos.length; start += 10) {
    const pageDemos = demos.slice(start, start + 10)
    pages.push({
      index: pageIndex++,
      title: `${pageDemos[0]!.title} – ${pageDemos[pageDemos.length - 1]!.title}`,
      demos: pageDemos,
    })
  }
  return { id, title: chapter.title, pages }
})

export const interactiveTutorialPageInfo = interactiveTutorialChapters.flatMap((chapter) =>
  chapter.pages.map((page) => ({ ...page, chapterTitle: chapter.title })),
)
export const interactiveTutorialPages = interactiveTutorialPageInfo.map((page) => page.demos)

import basics01 from './basics-01.json'
import basics02 from './basics-02.json'
import titles from './titles.json'
import additionalFeatures from './additional-features.json'
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

type TutorialFeature = Pick<InteractiveTutorialDemo, 'id' | 'title' | 'description' | 'html'> & {
  source?: string
  laneSource?: string
  instrument?: InstrumentSource
}

function createDemo(feature: TutorialFeature): InteractiveTutorialDemo {
  const { id, title, description, html, source } = feature
  return {
    id,
    title,
    description,
    html,
    props: source
      ? {
          source,
          instrument: feature.instrument ?? {
            type: 'patch',
            patchPreset: 'default',
            oscillatorType: 'semisine',
          },
          gain: 0.35,
          laneSource: feature.laneSource ?? '@tempo(240bpm) @adsr(10ms, 100ms, 70%, 100ms)',
          simplified: true,
          rows: Math.max(3, Math.min(12, source.split('\n').length)),
          editorLabel: `${title} source`,
        }
      : undefined,
  }
}

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

// Reuse all sidebar material so examples and explanations have one source of truth.
const existingChapters = tutorialChapters.map((chapter, chapterIndex) => {
  const id = chapterIds[chapterIndex]!
  const material = chapter.sections.flatMap((section) => section.demos)
  const demos = material.map((demo, demoIndex): InteractiveTutorialDemo => {
    if (chapterIndex === 0 && demoIndex < configuredBasics.length)
      return configuredBasics[demoIndex]!
    const title = chapterTitles[chapterIndex]![demoIndex]!
    return createDemo({
      id: `${id}-${String(demoIndex + 1).padStart(2, '0')}`,
      title,
      description: demo.description,
      html: demo.html,
      source: demo.tune,
    })
  })
  return { id, title: chapter.title, pages: paginate(demos) }
})

// Append new material so the existing page and example permalinks keep working.
export const interactiveTutorialChapters = [
  ...existingChapters,
  {
    id: 'features',
    title: 'More score features',
    pages: paginate((additionalFeatures as TutorialFeature[]).map(createDemo)),
  },
]

export const interactiveTutorialPageInfo = interactiveTutorialChapters.flatMap((chapter) =>
  chapter.pages.map((page) => ({ ...page, chapterTitle: chapter.title })),
)
export const interactiveTutorialPages = interactiveTutorialPageInfo.map((page) => page.demos)

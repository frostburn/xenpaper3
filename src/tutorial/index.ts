import advancedScoreConstruction from './advanced-score-construction.json'
import basics from './basics.json'
import diatonicNotation from './diatonic-notation.json'
import diamondMosNotation from './diamond-mos-notation.json'
import type { TutorialChapter } from './types'

export const tutorialChapters: TutorialChapter[] = [
  { title: 'Basics', sections: basics },
  { title: 'Advanced score construction', sections: advancedScoreConstruction },
  { title: 'Diatonic notation', sections: diatonicNotation },
  { title: 'Diamond-mos notation', sections: diamondMosNotation },
]

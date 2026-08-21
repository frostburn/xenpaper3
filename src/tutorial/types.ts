export type SidebarSection = {
  title: string
  demos: SidebarDemo[]
}

export type SidebarDemo = {
  description?: string
  tune?: string
  link?: string
  href?: string
}

export type TutorialChapter = {
  title: string
  sections: SidebarSection[]
}

import { createRouter, createWebHistory } from 'vue-router'
import PatchTestingView from '../views/PatchTestingView.vue'
import XenpaperLangTestingView from '../views/XenpaperLangTestingView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: { template: '<span />' } },
    { path: '/patch-testing', name: 'patch-testing', component: PatchTestingView },
    {
      path: '/xenpaper-lang-testing',
      name: 'xenpaper-lang-testing',
      component: XenpaperLangTestingView,
    },
  ],
})

export default router

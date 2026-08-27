import { defineRouter } from '#q-app'
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router'

import routes from './routes.js'
import { getToken } from '@/services/api'

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default defineRouter((/* { store, ssrContext } */) => {
  const createHistory = import.meta.env.QUASAR_SERVER
    ? createMemoryHistory
    : (import.meta.env.QUASAR_VUE_ROUTER_MODE === 'history' ? createWebHistory : createWebHashHistory)

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE)
  })

  // Every page except /login assumed it was only ever reached via a
  // successful login (MenuPage's own auth check, or a link from an
  // already-loaded page) — nothing actually enforced that. "В открытое
  // море" renders unconditionally on MenuPage before its own async
  // api.me() check even resolves, so a fast click (or, just as often, a
  // fresh browser with no session at all — no token in THIS origin's
  // localStorage, e.g. opening the LAN dev URL on a phone for the first
  // time) could reach /world with nothing to authenticate the realtime
  // join with, which then just failed silently in a loop (direct
  // feedback — a blank canvas, no redirect, no explanation). Synchronous
  // and route-level on purpose: catches this before the target page even
  // mounts, not after something inside it has already tried and failed.
  Router.beforeEach((to) => {
    if (to.path !== '/login' && !getToken()) return '/login'
  })

  return Router
})

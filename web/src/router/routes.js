const routes = [
  { path: '/login', component: () => import('@/pages/LoginPage.vue') },

  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('@/pages/MenuPage.vue') },
      { path: 'controls', component: () => import('@/pages/ControlsPage.vue') },
      { path: 'world', component: () => import('@/pages/WorldPage.vue') },
      // Port used to be its own route ('port/:id') — now a modal opened
      // directly over the world (see PortModal.vue, WorldPage.vue's
      // activePortId), so the realtime room connection never has to drop
      // and rejoin just to visit a port (see the giant comment on
      // this.autoDispose in WorldRoom.js for why that used to be risky).
      { path: 'abordage/pve', component: () => import('@/pages/AbordagePage.vue') },
      { path: 'abordage/:id', component: () => import('@/pages/AbordagePage.vue'), props: true },
      { path: 'loot/:id', component: () => import('@/pages/LootPage.vue'), props: true },
    ],
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('@/pages/ErrorNotFound.vue'),
  },
]

export default routes

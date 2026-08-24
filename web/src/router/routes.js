const routes = [
  { path: '/login', component: () => import('@/pages/LoginPage.vue') },

  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('@/pages/MenuPage.vue') },
      { path: 'controls', component: () => import('@/pages/ControlsPage.vue') },
      { path: 'world', component: () => import('@/pages/WorldPage.vue') },
      { path: 'port/:id', component: () => import('@/pages/PortPage.vue'), props: true },
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

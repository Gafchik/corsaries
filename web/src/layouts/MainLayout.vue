<template>
  <q-layout view="lHh Lpr lFf">
    <q-header class="app-header">
      <q-toolbar>
        <q-btn
          v-if="$route.path !== '/'"
          flat
          dense
          round
          icon="arrow_back"
          aria-label="Назад"
          @click="$router.push('/')"
        />
        <q-toolbar-title class="app-header__title">
          <svg class="app-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="16" y1="12" x2="21" y2="12"/><line x1="14.83" y1="14.83" x2="18.36" y2="18.36"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="9.17" y1="14.83" x2="5.64" y2="18.36"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="9.17" y1="9.17" x2="5.64" y2="5.64"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="14.83" y1="9.17" x2="18.36" y2="5.64"/></svg>
          Corsaries
        </q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.app-header {
  background: var(--c-bg-deep);
  color: var(--c-ink);
  box-shadow: none;
  border-bottom: 3px solid var(--c-gold);
}
.app-header__title {
  font-family: var(--font-display);
  font-weight: 400;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.app-header__icon {
  width: 20px;
  height: 20px;
  color: var(--c-gold-bright);
  flex: none;
}
</style>

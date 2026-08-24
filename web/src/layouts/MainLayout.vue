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
          <span class="app-header__emoji">🏴‍☠️</span> Corsaries
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
  background: var(--ba-ink);
  color: #fff;
  box-shadow: none;
  border-bottom: 3px solid var(--ba-block);
}
.app-header__title {
  font-weight: 800;
  letter-spacing: 0.01em;
}
.app-header__emoji {
  margin-right: 2px;
}
</style>

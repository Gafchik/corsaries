<template>
  <div class="not-found fullscreen text-center flex flex-center">
    <div>
      <svg class="not-found__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="12,4 14,12 12,20 10,12"/></svg>
      <div class="not-found__code">404</div>
      <div class="not-found__text">Такой страницы нет — сбились с курса</div>

      <q-btn
        class="q-mt-lg"
        color="accent"
        text-color="secondary"
        unelevated
        to="/"
        label="На главную"
      />
    </div>
  </div>
</template>

<style scoped>
.not-found {
  background: var(--c-bg-deep);
  color: var(--c-ink);
}
.not-found__icon {
  width: 56px;
  height: 56px;
  color: var(--c-gold-bright);
  margin-bottom: 8px;
}
.not-found__code {
  font-family: var(--font-display);
  font-size: 15vh;
  line-height: 1;
  opacity: 0.9;
}
.not-found__text {
  font-size: 16px;
  color: var(--c-ink-soft);
  margin-top: 8px;
}
</style>

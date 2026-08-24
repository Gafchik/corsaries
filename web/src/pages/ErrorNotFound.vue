<template>
  <div class="not-found fullscreen text-center flex flex-center">
    <div>
      <div class="not-found__emoji">🥊</div>
      <div class="not-found__code">404</div>
      <div class="not-found__text">Такой страницы нет</div>

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
  background: var(--ba-ink);
  color: #fff;
}
.not-found__emoji {
  font-size: 64px;
  margin-bottom: 8px;
}
.not-found__code {
  font-size: 15vh;
  font-weight: 800;
  line-height: 1;
  opacity: 0.9;
}
.not-found__text {
  font-size: 16px;
  color: #C6CBE0;
  margin-top: 8px;
}
</style>

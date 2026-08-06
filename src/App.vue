<template>
  <main>
    <template v-if="$route.name === 'home'">
      <h1>Xenpaper 3 test pages</h1>
      <nav>
        <RouterLink to="/patch-testing">Test sw-patch</RouterLink>
        <RouterLink to="/xenpaper-lang-testing">Test xenpaper-lang</RouterLink>
      </nav>
    </template>
    <RouterView v-else />
  </main>
</template>

<style scoped>
nav {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}
</style>

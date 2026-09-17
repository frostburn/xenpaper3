<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: boolean
    disabled?: boolean
  }>(),
  {
    modelValue: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <button
    type="button"
    class="toggle-switch"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="toggle-switch-track" aria-hidden="true"><span /></span>
    <slot />
  </button>
</template>

<style scoped>
.toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.toggle-switch-track {
  position: relative;
  display: inline-block;
  flex: none;
  width: 1.5rem;
  height: 0.8rem;
  border: 1px solid var(--xenpaper-slate-400);
  border-radius: 999px;
  background: var(--xenpaper-slate-900);
}
.toggle-switch-track span {
  position: absolute;
  top: 0.1rem;
  left: 0.1rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--xenpaper-teal-700);
  transition: transform 120ms ease;
}
.toggle-switch[aria-checked='true'] {
  border-color: var(--xenpaper-cyan);
  color: var(--xenpaper-cyan);
}
.toggle-switch[aria-checked='true'] .toggle-switch-track {
  border-color: var(--xenpaper-cyan);
  background: color-mix(in srgb, var(--xenpaper-cyan) 35%, var(--xenpaper-slate-900));
}
.toggle-switch[aria-checked='true'] .toggle-switch-track span {
  background: var(--xenpaper-cyan);
  transform: translateX(0.7rem);
}
</style>

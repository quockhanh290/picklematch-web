let _trigger: (() => void) | null = null

export const refreshBus = {
  register: (fn: () => void) => { _trigger = fn },
  unregister: () => { _trigger = null },
  emit: () => { _trigger?.() },
}

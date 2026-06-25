<script setup lang="ts">
defineProps<{ active?: boolean }>()
defineEmits<{ 'open-settings': [] }>()
</script>

<template>
  <header class="topbar">
    <div class="brandrow">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2v6M12 2l4 3M12 2L8 5" stroke="#0a0e17" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="12" cy="15" r="6" stroke="#0a0e17" stroke-width="2.2" />
          <circle cx="12" cy="15" r="2" fill="#0a0e17" />
        </svg>
      </div>
      <div class="brand">
        <h1>Beacon</h1>
        <div class="sub">SSI&nbsp;Growth&nbsp;Engine</div>
      </div>
      <div class="status" :class="{ idle: active === false }">
        <span class="dot"></span>{{ active === false ? 'Idle' : 'Active' }}
      </div>
      <button class="gear" data-testid="open-settings" title="Настройки" @click="$emit('open-settings')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg>
      </button>
    </div>
  </header>
</template>

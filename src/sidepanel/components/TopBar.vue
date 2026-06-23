<script setup lang="ts">
defineProps<{ active?: boolean }>()
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
    </div>
  </header>
</template>

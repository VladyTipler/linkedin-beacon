<script setup lang="ts">
import { computed } from 'vue'
import TopBar from './components/TopBar.vue'
import BottomNav from './components/BottomNav.vue'
import DashScreen from './screens/DashScreen.vue'
import ModulesScreen from './screens/ModulesScreen.vue'
import InboxScreen from './screens/InboxScreen.vue'
import SafetyScreen from './screens/SafetyScreen.vue'
import ReportsScreen from './screens/ReportsScreen.vue'
import SettingsScreen from './screens/SettingsScreen.vue'
import ContentScreen from './screens/ContentScreen.vue'
import { useNavigation } from './composables/useNavigation'
import { useSsi } from './composables/useSsi'
import { useModules } from './composables/useModules'
import { useEngagement } from './composables/useEngagement'
import { useAutopilot } from './composables/useAutopilot'
import { DEMO_LEADS } from './lib/demo'

const { active, go } = useNavigation()
const { snapshot, pillars, total, isReal, refreshing, refresh } = useSsi()
const { modules, toggle, setLimit } = useModules()
const { quarantined, cancel } = useEngagement()
const { status: autopilotStatus, reports, start: startAutopilot, stop: stopAutopilot } = useAutopilot()

const anyActive = computed(() => modules.value.some((m) => m.available && m.enabled))

function pauseAll() {
  modules.value.forEach((m) => {
    if (m.available && m.enabled) toggle(m.id)
  })
}
</script>

<template>
  <div class="app">
    <TopBar :active="anyActive" @open-settings="go('v-settings')" />
    <main class="body">
      <DashScreen
        v-if="active === 'v-dash'"
        :snapshot="snapshot"
        :pillars="pillars"
        :total="total"
        :is-real="isReal"
        :refreshing="refreshing"
        :autopilot-running="autopilotStatus?.running ?? false"
        @refresh="refresh"
        @start-autopilot="startAutopilot"
        @stop-autopilot="stopAutopilot"
      />
      <ModulesScreen
        v-else-if="active === 'v-auto'"
        :modules="modules"
        @toggle="toggle"
        @set-limit="setLimit"
      />
      <InboxScreen v-else-if="active === 'v-inbox'" :leads="DEMO_LEADS" />
      <ReportsScreen v-else-if="active === 'v-reports'" :reports="reports" />
      <SettingsScreen v-else-if="active === 'v-settings'" />
      <ContentScreen v-else-if="active === 'v-content'" />
      <SafetyScreen
        v-else
        :quarantined="quarantined"
        @pause-all="pauseAll"
        @cancel="cancel"
      />
    </main>
    <BottomNav :active="active" @go="go" />
  </div>
</template>

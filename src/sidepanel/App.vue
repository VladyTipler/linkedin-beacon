<script setup lang="ts">
import TopBar from './components/TopBar.vue'
import BottomNav from './components/BottomNav.vue'
import DashScreen from './screens/DashScreen.vue'
import ModulesScreen from './screens/ModulesScreen.vue'
import ReportsScreen from './screens/ReportsScreen.vue'
import SettingsScreen from './screens/SettingsScreen.vue'
import ContentScreen from './screens/ContentScreen.vue'
import ProfileAuditScreen from './screens/ProfileAuditScreen.vue'
import { useNavigation } from './composables/useNavigation'
import { useSsi } from './composables/useSsi'
import { useModules } from './composables/useModules'
import { useAutopilot } from './composables/useAutopilot'
import { enabledModules } from '@lib/autopilot/startGate'

const { active, go } = useNavigation()
const { snapshot, history, pillars, total, isReal, refreshing, refresh } = useSsi()
const { modules, toggle, setLimit } = useModules()
const {
  status: autopilotStatus,
  stage: autopilotStage,
  reports,
  startHint,
  start: startAutopilot,
  stop: stopAutopilot
} = useAutopilot()

function pauseAll() {
  enabledModules(modules.value).forEach((m) => toggle(m.id))
}
</script>

<template>
  <div class="app">
    <TopBar :active="autopilotStatus?.running ?? false" @open-settings="go('v-settings')" />
    <main class="body">
      <ProfileAuditScreen v-if="active === 'v-profile'" @back="go('v-dash')" />
      <DashScreen
        v-else-if="active === 'v-dash'"
        :snapshot="snapshot"
        :pillars="pillars"
        :total="total"
        :history="history"
        :is-real="isReal"
        :refreshing="refreshing"
        :autopilot-running="autopilotStatus?.running ?? false"
        :autopilot-stage="autopilotStage"
        :start-hint="startHint"
        @refresh="refresh"
        @start-autopilot="startAutopilot"
        @stop-autopilot="stopAutopilot"
        @pause-all="pauseAll"
        @open-audit="go('v-profile')"
      />
      <ModulesScreen
        v-else-if="active === 'v-auto'"
        :modules="modules"
        @toggle="toggle"
        @set-limit="setLimit"
      />
      <ReportsScreen v-else-if="active === 'v-reports'" :reports="reports" />
      <SettingsScreen v-else-if="active === 'v-settings'" />
      <ContentScreen v-else-if="active === 'v-content'" />
    </main>
    <BottomNav :active="active" @go="go" />
  </div>
</template>

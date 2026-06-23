import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

// MV3 manifest. See docs/plans/phase-1.md §manifest and design-spec §12.
// Permissions kept minimal; host access scoped to LinkedIn only.
export default defineManifest({
  manifest_version: 3,
  name: 'Beacon — LinkedIn SSI Engine',
  short_name: 'Beacon',
  description: pkg.description,
  version: pkg.version,
  icons: {
    16: 'public/icons/icon-16.png',
    48: 'public/icons/icon-48.png',
    128: 'public/icons/icon-128.png'
  },
  action: {
    default_title: 'Beacon'
  },
  background: {
    service_worker: 'src/service-worker/index.ts',
    type: 'module'
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html'
  },
  content_scripts: [
    {
      matches: ['https://www.linkedin.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ],
  permissions: ['sidePanel', 'storage', 'scripting', 'alarms', 'tabs'],
  host_permissions: ['https://www.linkedin.com/*'],
  minimum_chrome_version: '116'
})

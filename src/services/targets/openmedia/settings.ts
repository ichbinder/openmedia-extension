import { TargetSettings } from '../settings'

import { categoriesDefaultSettings } from '@/services/categories'

export const defaultSettings: TargetSettings = {
  type: 'openmedia',
  name: 'OpenMedia',
  isActive: false,
  settings: {
    apiUrl: 'https://api.mediatoken.de',
    apiToken: '',
    timeout: 30000,
  },
  categories: categoriesDefaultSettings,
}

export type Settings = {
  apiUrl: string
  apiToken: string
  timeout: number
}

import { i18n } from '#i18n'

export const type = 'openmedia'
export const name = 'OpenMedia'
export const description = i18n.t('targets.openmedia.description')
export const canHaveCategories = false
export const hasTargetCategories = false
export const hasConnectionTest = true
export const hasAdvancedSettings = false
export * from './functions'
export { defaultSettings, type Settings } from './settings'

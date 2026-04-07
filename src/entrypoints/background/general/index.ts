import registerConnectionTestHandler from './connectionTestHandler'
import registerNzblnkHandler from './nzblnkHandler'
import registerContextMenus from './registerContextMenus'
import searchEnginesUpdate from './searchEnginesUpdate'

import { initJobTracker } from '@/services/targets/openmedia/jobTracker'

export default function (): void {
  registerContextMenus()
  registerNzblnkHandler()
  registerConnectionTestHandler()
  searchEnginesUpdate()
  initJobTracker()
}

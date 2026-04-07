import { storage } from '#imports'
import log from '@/services/logger/debugLogger'
import notifications from '@/services/notifications'
import { FetchOptions, JSONparse, useFetch } from '@/utils/fetchUtilities'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrackedJob = {
  jobId: string
  apiUrl: string
  apiToken: string
  title: string
  status: string
  progress: number
  createdAt: string
}

type JobApiResponse = {
  job?: {
    id: string
    status: string
    progress: number
    error?: string
    nzbFile?: {
      movie?: {
        titleEn: string
      }
    }
  }
  error?: string
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'local:openmedia_tracked_jobs'

const trackedJobsStorage = storage.defineItem<TrackedJob[]>(STORAGE_KEY, {
  fallback: [],
})

// ---------------------------------------------------------------------------
// Polling state (in-memory, not persisted)
// ---------------------------------------------------------------------------

let pollingInterval: ReturnType<typeof setInterval> | null = null
const POLL_INTERVAL_MS = 10_000

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a newly created job for status tracking.
 */
export async function addJob(
  jobId: string,
  apiUrl: string,
  apiToken: string,
  title: string
): Promise<void> {
  const jobs = await trackedJobsStorage.getValue()

  // Don't add duplicates
  if (jobs.some((j) => j.jobId === jobId)) return

  jobs.push({
    jobId,
    apiUrl: apiUrl.replace(/\/+$/, ''),
    apiToken,
    title,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
  })

  await trackedJobsStorage.setValue(jobs)
  log.info(`[job-tracker] Tracking job ${jobId} "${title}"`)

  ensurePolling()
}

/**
 * Get all tracked jobs (for UI display).
 */
export async function getTrackedJobs(): Promise<TrackedJob[]> {
  return trackedJobsStorage.getValue()
}

/**
 * Remove a job from tracking (user dismisses it).
 */
export async function removeJob(jobId: string): Promise<void> {
  const jobs = await trackedJobsStorage.getValue()
  await trackedJobsStorage.setValue(jobs.filter((j) => j.jobId !== jobId))
}

/**
 * Start polling if there are active jobs. Called from background script init.
 */
export async function initJobTracker(): Promise<void> {
  const jobs = await trackedJobsStorage.getValue()
  const activeJobs = jobs.filter((j) => !isTerminal(j.status))
  if (activeJobs.length > 0) {
    log.info(`[job-tracker] Resuming tracking for ${activeJobs.length} active job(s)`)
    ensurePolling()
  }
}

// ---------------------------------------------------------------------------
// Polling internals
// ---------------------------------------------------------------------------

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed'
}

function ensurePolling(): void {
  if (pollingInterval) return
  pollingInterval = setInterval(pollAllJobs, POLL_INTERVAL_MS)
  // Also do an immediate poll
  pollAllJobs()
}

function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

async function pollAllJobs(): Promise<void> {
  const jobs = await trackedJobsStorage.getValue()
  const activeJobs = jobs.filter((j) => !isTerminal(j.status))

  if (activeJobs.length === 0) {
    stopPolling()
    return
  }

  let changed = false

  for (const job of activeJobs) {
    try {
      const newStatus = await fetchJobStatus(job)
      if (newStatus && newStatus.status !== job.status) {
        const oldStatus = job.status
        job.status = newStatus.status
        job.progress = newStatus.progress
        changed = true

        log.info(`[job-tracker] Job ${job.jobId} status: ${oldStatus} → ${newStatus.status}`)

        // Notify on meaningful transitions
        if (newStatus.status === 'completed') {
          notifications.success(`${job.title} — Download abgeschlossen`, job.jobId)
        } else if (newStatus.status === 'failed') {
          notifications.error(`${job.title} — Download fehlgeschlagen`, job.jobId)
        } else if (newStatus.status === 'downloading' && oldStatus !== 'downloading') {
          notifications.info(`${job.title} — Download gestartet`, job.jobId)
        }
      } else if (newStatus && newStatus.progress !== job.progress) {
        job.progress = newStatus.progress
        changed = true
      }
    } catch (e) {
      log.error(`[job-tracker] Poll failed for job ${job.jobId}`, e instanceof Error ? e : new Error(String(e)))
    }
  }

  if (changed) {
    await trackedJobsStorage.setValue(jobs)
  }
}

async function fetchJobStatus(
  job: TrackedJob
): Promise<{ status: string; progress: number } | null> {
  try {
    const options: FetchOptions = {
      url: `${job.apiUrl}/downloads/jobs/${job.jobId}`,
      init: {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${job.apiToken}`,
        },
      },
      timeout: 15000,
    }

    const response = await useFetch(options)
    if (response.status === 404) {
      // Job was deleted — mark as failed
      return { status: 'failed', progress: 0 }
    }
    if (!response.ok) return null

    const data = JSONparse(await response.text()) as JobApiResponse
    if (data.job) {
      return { status: data.job.status, progress: data.job.progress }
    }
    return null
  } catch {
    return null
  }
}

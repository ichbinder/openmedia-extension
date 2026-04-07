import { TargetSettings } from '../settings'

import { Settings } from './settings'

import { addJob } from './jobTracker'

import { i18n } from '#imports'
import log from '@/services/logger/debugLogger'
import { NZBFileObject } from '@/services/nzbfile'
import { FetchOptions, JSONparse, useFetch } from '@/utils/fetchUtilities'
import { Semaphore } from '@/utils/generalUtilities'

const MAX_CONCURRENT = 5

const dlSemaphore = new Semaphore(MAX_CONCURRENT)

type OpenMediaUploadResponse = {
  job?: {
    id: string
    status: string
    nzbFile?: {
      id: string
      hash: string
      movie?: {
        id: string
        titleEn: string
      }
    }
  }
  reused?: boolean
  error?: string
  // 409 Conflict — active download in progress
  existingJobId?: string
  existingStatus?: string
  // 200 alreadyAvailable — film already on S3
  alreadyAvailable?: boolean
  message?: string
  movie?: {
    id: string
    titleEn: string
    titleDe?: string
  }
  // 410 Gone — NZB is broken
  reason?: string
  failedAttempts?: number
  hint?: string
}

/**
 * Push an NZB file to the OpenMedia API.
 * Sends the NZB content as a JSON string to POST /downloads/request.
 *
 * Handles these response codes:
 * - 201: Download job created
 * - 200 alreadyAvailable: Film already on S3 (no download needed)
 * - 409: Active download already running for this NZB
 * - 410: NZB is marked as broken (3+ failed attempts) — user should find another version
 */
export const push = async (
  nzb: NZBFileObject,
  targetSettings: TargetSettings & { selectedCategory?: string }
): Promise<void> => {
  const release = await dlSemaphore.acquire()
  try {
    const settings = targetSettings.settings as Settings
    log.info(`pushing file "${nzb.title}" to ${targetSettings.name}`)
    try {
      const nzbContent = nzb.getAsTextFile()
      const body = JSON.stringify({
        nzbContent,
        title: nzb.title || nzb.getFilename(),
        password: nzb.password || undefined,
        filename: nzb.getFilename(),
      })

      const options: FetchOptions = {
        url: `${normalizeUrl(settings.apiUrl)}/downloads/request`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiToken}`,
          },
          body,
        },
        timeout: settings.timeout,
      }

      const response = await useFetch(options)
      const responseText = await response.text()
      const data = JSONparse(responseText) as OpenMediaUploadResponse

      if (response.status === 201) {
        const jobId = data.job?.id || 'unknown'
        const movieTitle = data.job?.nzbFile?.movie?.titleEn || nzb.title
        log.info(
          `successfully pushed "${movieTitle}" to ${targetSettings.name} — job ${jobId} (reused: ${data.reused})`
        )

        // Track the job for status polling
        if (jobId !== 'unknown') {
          addJob(jobId, settings.apiUrl, settings.apiToken, movieTitle).catch((err) => {
            log.error(`[openmedia] Failed to track job ${jobId}`, err instanceof Error ? err : new Error(String(err)))
          })
        }

        return
      }

      if (response.status === 200 && data.alreadyAvailable) {
        // Film is already on S3 — no download needed. Not an error.
        const movieTitle = data.movie?.titleEn || nzb.title
        log.info(
          `"${movieTitle}" is already available on ${targetSettings.name} — no download needed`
        )
        // Throw a "soft" info error so the UI shows the message to the user
        throw new Error(i18n.t('targets.openmedia.errors.alreadyAvailable', [movieTitle]))
      }

      if (response.status === 409) {
        // Active download already exists — not an error per se
        log.info(
          `download already active for "${nzb.title}" on ${targetSettings.name} — job ${data.existingJobId} (${data.existingStatus})`
        )
        throw new Error(data.error || i18n.t('errors.unknownError'))
      }

      if (response.status === 410) {
        // NZB is broken — user should find a different version
        const attempts = data.failedAttempts ?? 0
        const reason = data.reason || i18n.t('errors.unknownError')
        log.info(
          `NZB rejected as broken by ${targetSettings.name} — ${attempts} failures: ${reason}`
        )
        throw new Error(i18n.t('targets.openmedia.errors.brokenNzb', [String(attempts), reason]))
      }

      throw new Error(data.error || `HTTP ${response.status}`)
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      log.error(`error while pushing file "${nzb.title}" to ${targetSettings.name}`, error)
      throw error
    }
  } finally {
    release()
  }
}

/**
 * Test the connection to the OpenMedia API by hitting the /health endpoint.
 */
export const testConnection = async (targetSettings: TargetSettings): Promise<boolean> => {
  const settings = targetSettings.settings as Settings
  log.info(`testing connection to ${targetSettings.name}`)
  try {
    const options: FetchOptions = {
      url: `${normalizeUrl(settings.apiUrl)}/health`,
      init: {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${settings.apiToken}`,
        },
      },
      timeout: settings.timeout,
    }

    const response = await useFetch(options)
    const responseText = await response.text()
    const data = JSONparse(responseText) as { status?: string; db?: string }

    if (response.status === 200 && data.status === 'ok') {
      log.info(`connection to ${targetSettings.name} successful (db: ${data.db})`)
      return true
    }

    throw new Error(data.status || `HTTP ${response.status}`)
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    log.error(`error while testing connection to ${targetSettings.name}`, error)
    throw error
  }
}

/**
 * Categories are not supported for OpenMedia target.
 */
export const getCategories = async (targetSettings: TargetSettings): Promise<string[]> => {
  log.info(`getting the categories from ${targetSettings.name}`)
  try {
    throw new Error('not implemented')
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    log.error(`error while getting the categories from ${targetSettings.name}`, error)
    throw error
  }
}

/**
 * Normalize the API URL: remove trailing slashes.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

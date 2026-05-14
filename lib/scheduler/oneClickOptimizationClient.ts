import {
  runOneClickOptimization,
  type OneClickOptimizationInput,
  type OneClickOptimizationProgress,
  type OptimizationResult,
} from './oneClickOptimization'

type WorkerResponse =
  | {
      requestId: number
      type: 'progress'
      progress: OneClickOptimizationProgress
    }
  | {
      requestId: number
      type: 'done'
      results: OptimizationResult[]
    }
  | {
      requestId: number
      type: 'error'
      error: string
    }

let requestCounter = 0
const WORKER_URL = '/workers/one-click-optimization-worker.js?v=20260513-rotation-worker'

const waitForUiFrame = () => new Promise<void>(resolve => {
  setTimeout(resolve, 0)
})

async function runFallbackOptimization(
  input: OneClickOptimizationInput,
  onProgress?: (progress: OneClickOptimizationProgress) => void
) {
  await waitForUiFrame()
  const results = runOneClickOptimization(input, onProgress)
  await waitForUiFrame()
  return results
}

function canUseWebWorker() {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined'
}

function runWorkerOptimization(
  input: OneClickOptimizationInput,
  onProgress?: (progress: OneClickOptimizationProgress) => void
) {
  return new Promise<OptimizationResult[]>((resolve, reject) => {
    const requestId = ++requestCounter
    const worker = new Worker(WORKER_URL)

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestId) return

      if (message.type === 'progress') {
        onProgress?.(message.progress)
        return
      }

      worker.terminate()
      if (message.type === 'done') {
        resolve(message.results)
      } else {
        reject(new Error(message.error || 'Failed to optimize schedule'))
      }
    }

    worker.onerror = event => {
      worker.terminate()
      reject(new Error(event.message || 'Failed to start optimization worker'))
    }

    worker.postMessage({ requestId, input })
  })
}

export async function runOneClickOptimizationAsync(
  input: OneClickOptimizationInput,
  onProgress?: (progress: OneClickOptimizationProgress) => void
) {
  if (canUseWebWorker()) {
    try {
      return await runWorkerOptimization(input, onProgress)
    } catch (error) {
      console.warn('[oneClickOptimization] Worker failed, using fallback.', error)
    }
  }

  return runFallbackOptimization(input, onProgress)
}

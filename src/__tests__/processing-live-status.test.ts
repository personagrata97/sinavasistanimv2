import { describe, it, expect, beforeEach } from "vitest"
import {
  HEARTBEAT_PAGE_LEFT_MESSAGE,
  HEARTBEAT_STALE_MESSAGE,
  resolveLiveProcessingState,
} from "@/lib/course-processing-status"
import {
  activeProcesses,
  clearHeartbeat,
  getHeartbeatEntry,
  recordHeartbeat,
  releaseProcessing,
  tryClaimProcessing,
} from "@/lib/process-registry"

describe("processing live status honesty", () => {
  const slug = "zeliha-kvkk-prosedur"

  beforeEach(() => {
    activeProcesses.clear()
    clearHeartbeat(slug)
    releaseProcessing(slug)
  })

  it("processing + worker + heartbeat → workerLive true", () => {
    tryClaimProcessing(slug)
    recordHeartbeat(slug, true)
    const live = resolveLiveProcessingState("processing", slug)
    expect(live.status).toBe("processing")
    expect(live.workerLive).toBe(true)
    expect(live.needsPause).toBe(false)
  })

  it("processing without heartbeat → paused (page left)", () => {
    tryClaimProcessing(slug)
    const live = resolveLiveProcessingState("processing", slug)
    expect(live.status).toBe("paused")
    expect(live.workerLive).toBe(false)
    expect(live.needsPause).toBe(true)
    expect(live.pauseReason).toBe("page_left")
    expect(live.pauseMessage).toBe(HEARTBEAT_PAGE_LEFT_MESSAGE)
  })

  it("processing with stale heartbeat → paused", () => {
    tryClaimProcessing(slug)
    recordHeartbeat(slug, true)
    const hb = getHeartbeatEntry(slug)!
    hb.lastAt = Date.now() - 120_000

    const live = resolveLiveProcessingState("processing", slug)
    expect(live.status).toBe("paused")
    expect(live.workerLive).toBe(false)
    expect(live.pauseReason).toBe("heartbeat_stale")
    expect(live.pauseMessage).toBe(HEARTBEAT_STALE_MESSAGE)
  })

  it("processing without in-memory worker → paused even with heartbeat", () => {
    recordHeartbeat(slug, true)
    const live = resolveLiveProcessingState("processing", slug)
    expect(live.status).toBe("paused")
    expect(live.workerLive).toBe(false)
    expect(live.pauseReason).toBe("worker_dead")
  })

  it("ready status is not rewritten", () => {
    const live = resolveLiveProcessingState("ready", slug)
    expect(live.status).toBe("ready")
    expect(live.workerLive).toBe(false)
    expect(live.needsPause).toBe(false)
  })
})

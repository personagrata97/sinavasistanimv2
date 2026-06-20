import { describe, it, expect, beforeEach } from "vitest"
import {
  activeProcesses,
  cancelledProcesses,
  cancelCourseProcessing,
  clearCancelSignal,
  clearHeartbeat,
  getHeartbeatEntry,
  isCancelled,
  isHeartbeatStale,
  isWorkerLive,
  recordHeartbeat,
  releaseProcessing,
  tryClaimProcessing,
  HEARTBEAT_STALE_VISIBLE_MS,
} from "@/lib/process-registry"

describe("process-registry", () => {
  beforeEach(() => {
    activeProcesses.clear()
    cancelledProcesses.clear()
    clearCancelSignal("test-slug", "Test Course")
    clearHeartbeat("test-slug")
    clearHeartbeat("live-slug")
    clearHeartbeat("hb-slug")
  })

  it("allows only one global active slug at a time", () => {
    expect(tryClaimProcessing("course-a")).toEqual({ ok: true })
    expect(tryClaimProcessing("course-b")).toEqual({ ok: false, blockedBy: "course-a" })
    releaseProcessing("course-a")
    expect(tryClaimProcessing("course-b")).toEqual({ ok: true })
  })

  it("sets and clears cancel signals by slug and course name", () => {
    cancelCourseProcessing("test-slug", "Test Course")
    expect(isCancelled("test-slug", "Test Course")).toBe(true)
    clearCancelSignal("test-slug", "Test Course")
    expect(isCancelled("test-slug", "Test Course")).toBe(false)
  })

  it("marks heartbeat stale after visible timeout", () => {
    recordHeartbeat("hb-slug", true)
    const entry = getHeartbeatEntry("hb-slug")!
    entry.lastAt = Date.now() - HEARTBEAT_STALE_VISIBLE_MS - 1
    expect(isHeartbeatStale("hb-slug")).toBe(true)
  })

  it("hidden tab heartbeat stays fresh until timeout (background processing)", () => {
    recordHeartbeat("hb-slug", false)
    expect(isHeartbeatStale("hb-slug")).toBe(false)
    const entry = getHeartbeatEntry("hb-slug")!
    entry.lastAt = Date.now() - HEARTBEAT_STALE_VISIBLE_MS - 1
    expect(isHeartbeatStale("hb-slug")).toBe(true)
  })

  it("treats missing heartbeat as stale", () => {
    expect(isHeartbeatStale("never-seen")).toBe(true)
  })

  it("isWorkerLive requires active process and fresh heartbeat", () => {
    recordHeartbeat("live-slug", true)
    expect(isWorkerLive("live-slug")).toBe(false)
    tryClaimProcessing("live-slug")
    expect(isWorkerLive("live-slug")).toBe(true)
    clearHeartbeat("live-slug")
    expect(isWorkerLive("live-slug")).toBe(false)
    releaseProcessing("live-slug")
  })
})

import { describe, it, expect } from "vitest"
import { courseHasUploadedPdf } from "@/lib/course-upload-meta"

describe("courseHasUploadedPdf", () => {
  it("totalPages > 0 ise PDF yüklü sayılır", () => {
    expect(courseHasUploadedPdf({ totalPages: 16, pdfPath: null, status: "not_started" })).toBe(true)
  })

  it("pdfPath doluysa PDF yüklü sayılır", () => {
    expect(courseHasUploadedPdf({ totalPages: 0, pdfPath: "/uploads/test.pdf", status: "not_started" })).toBe(true)
  })

  it("status uploaded ise PDF yüklü sayılır", () => {
    expect(courseHasUploadedPdf({ totalPages: 0, pdfPath: null, status: "uploaded" })).toBe(true)
  })

  it("hepsi boşsa PDF yüklenmemiş", () => {
    expect(courseHasUploadedPdf({ totalPages: 0, pdfPath: null, status: "not_started" })).toBe(false)
  })
})

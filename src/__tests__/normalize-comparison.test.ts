import { expect, test } from "vitest"
import { normalizeForComparison } from "@/lib/ai-service"

test("normalizeForComparison basic and Turkish character behavior", () => {
  // Büyük-küçük harf dönüşümü ve Türkçe karakterlerin korunması
  expect(normalizeForComparison("Merhaba Dünya")).toBe("merhabadünya")
  expect(normalizeForComparison("ıişğüçöâîû")).toBe("ıişğüçöâîû")
  expect(normalizeForComparison("IİŞĞÜÇÖÂÎÛ")).toBe("ıişğüçöâîû")
  
  // Özel karakterlerin temizlenmesi
  expect(normalizeForComparison("A-B_C.123!")).toBe("abc123")
  expect(normalizeForComparison("Boşluklu  Cümle  Yapısı")).toBe("boşluklucümleyapısı")
  expect(normalizeForComparison("Tablolar & Şemalar")).toBe("tablolarşemalar")
})

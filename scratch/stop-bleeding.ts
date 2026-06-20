/**
 * Acil durum: prosedür hariç tüm arka plan işlerini durdur (veri silmez).
 * Kullanım: npx tsx scratch/stop-bleeding.ts
 */
import { stopAllProcessingExcept } from "../src/lib/process-startup"

async function main() {
  const paused = await stopAllProcessingExcept("zeliha-kvkk-prosedur")
  console.log("Duraklatılan slug'lar:", paused.length ? paused.join(", ") : "(yok)")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma")
    await prisma.$disconnect()
  })

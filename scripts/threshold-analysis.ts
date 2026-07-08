import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("=== YAMA EŞİK DEĞERİ (THRESHOLD) ANALİZ RAPORU ===")
  
  const sections = await prisma.section.findMany({
    where: {
      verificationIssues: { not: null }
    },
    select: {
      id: true,
      title: true,
      verificationIssues: true
    }
  })

  console.log(`Toplam analiz edilen bölüm sayısı: ${sections.length}\n`)

  let totalAttempts = 0
  let totalRewrites = 0
  let totalPatches = 0
  let successfulPatches = 0
  let failedPatches = 0
  let patchSavesCount = 0 // Yamayla kurtarılan (son skoru 100 olan) durumlar

  const initialScores: number[] = []
  const sub75Attempts: any[] = []

  for (const sec of sections) {
    try {
      const parsed = JSON.parse(sec.verificationIssues || "{}")
      const history = parsed.attemptHistory || []
      if (!Array.isArray(history) || history.length === 0) continue

      totalAttempts += history.length

      // İlk deneme skoru
      const firstAttempt = history.find(h => h.attempt === 1)
      if (firstAttempt) {
        initialScores.push(firstAttempt.score)
        if (firstAttempt.score < 75) {
          sub75Attempts.push({
            sectionId: sec.id,
            title: sec.title,
            firstScore: firstAttempt.score,
            history
          })
        }
      }

      // Yama ve Baştan Yazım Sayımları
      let hasPatch = false
      let patchSuccess = false
      history.forEach((h: any) => {
        if (h.isSmartInject) {
          hasPatch = true
          if (h.score === 100) patchSuccess = true
        }
      })

      if (hasPatch) {
        totalPatches++
        if (patchSuccess) {
          successfulPatches++
        } else {
          failedPatches++
        }
      }

      // Son skora bak
      const lastAttempt = history[history.length - 1]
      if (lastAttempt && lastAttempt.score === 100 && hasPatch) {
        patchSavesCount++
      }

    } catch (e) {
      // ignore parse errors
    }
  }

  // İstatistiksel Özet
  if (initialScores.length === 0) {
    console.log("Henüz analiz edilebilecek deneme geçmişi verisi bulunamadı.")
    await prisma.$disconnect()
    return
  }

  const avgInitialScore = initialScores.reduce((a, b) => a + b, 0) / initialScores.length
  const minInitialScore = Math.min(...initialScores)
  const maxInitialScore = Math.max(...initialScores)

  console.log("1. İlk Deneme Skor Dağılımı:")
  console.log(`   - Ortalama İlk Skor: %${avgInitialScore.toFixed(1)}`)
  console.log(`   - En Düşük İlk Skor: %${minInitialScore}`)
  console.log(`   - En Yüksek İlk Skor: %${maxInitialScore}`)
  
  console.log("\n2. Yama (Patch) Başarı İstatistikleri:")
  console.log(`   - Toplam Yama Denenen Bölüm: ${totalPatches}`)
  console.log(`   - Başarılı Yama (Deneme Anında %100 Alan): ${successfulPatches} (%${totalPatches > 0 ? ((successfulPatches/totalPatches)*100).toFixed(1) : 0})`)
  console.log(`   - Yamayla 100 Puanla Kurtarılan Toplam Bölüm: ${patchSavesCount}`)

  console.log("\n3. 75 Puan Altı (<75) Analizi (Potansiyel Yama Fırsatları):")
  console.log(`   - İlk Denemede 75 Puan Altında Kalan Bölüm Sayısı: ${sub75Attempts.length} (%${((sub75Attempts.length / initialScores.length)*100).toFixed(1)})`)
  
  // 50-74 arası potansiyel yama aralığı analizi
  const potentialPatchRange = sub75Attempts.filter(a => a.firstScore >= 50 && a.firstScore < 75)
  console.log(`   - İlk Denemede 50-74 Puan Arasında Kalan Bölüm Sayısı: ${potentialPatchRange.length}`)
  console.log(`     (Eğer eşik değer 75 yerine 50 olsaydı, bu ${potentialPatchRange.length} bölüm için baştan yazım yerine yama denenecekti.)`)

  const successRateOfSub75Rewrites = sub75Attempts.filter(a => {
    const last = a.history[a.history.length - 1]
    return last && last.score === 100
  }).length

  console.log(`   - Baştan Yazılan Bölümlerin Başarıyla %100'e Ulaşma Oranı: ${sub75Attempts.length > 0 ? ((successRateOfSub75Rewrites/sub75Attempts.length)*100).toFixed(1) : 0}%`)

  console.log("\n=== ÖNERİ ===")
  const currentPatchSuccessRate = totalPatches > 0 ? (successfulPatches / totalPatches) : 0
  if (currentPatchSuccessRate > 0.7 && potentialPatchRange.length > 0) {
    console.log(`Yama başarı oranınız oldukça yüksek (%${(currentPatchSuccessRate*100).toFixed(1)}). Eşik değerini 75'ten 65'e düşürmek, kaliteden ödün vermeden Google API kota tüketimini ve süresini azaltabilir.`)
  } else {
    console.log("Mevcut 75 eşik değeri ideal görünmektedir. Yama başarı oranlarını izlemeye devam edin.")
  }

  await prisma.$disconnect()
}

main().catch(console.error)

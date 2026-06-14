import "dotenv/config"
import { prisma } from "./src/lib/prisma"
import { auditNotesAgainstSourceSpecific } from "./src/lib/ai-service"

async function runAuditForSection(sectionOrder: number) {
  console.log(`\n============================================================`)
  console.log(`🔍 [MÜFETTİŞ DERİN DENETİMİ] Bölüm #${sectionOrder} için derin denetim başlatılıyor...`)

  const sec = await prisma.section.findFirst({
    where: { 
      course: { slug: "bd-bilgi-sistemleri-guvenligi" },
      order: sectionOrder
    }
  })

  if (!sec) {
    console.error(`❌ Bölüm #${sectionOrder} bulunamadı!`)
    return
  }

  let topics: string[] = []
  try {
    topics = sec.topics ? JSON.parse(sec.topics) : []
  } catch {
    console.warn("  ⚠️ Konular parse edilemedi.")
  }

  if (topics.length === 0) {
    console.warn("  ⚠️ Bu bölüm için konu listesi bulunamadı. Denetim atlanıyor.")
    return
  }

  console.log(`📌 Bölüm Konu Sayısı: ${topics.length} adet konu tespit edildi.`)
  console.log(`   Herhangi bir detay kaybı ve dikkat dağınıklığını önlemek için,`)
  console.log(`   tüm konular 3'erli paketler halinde SIRALI MİKRO-ÇAĞRILAR (Sequential Micro-Calls) ile denetlenecektir.`)

  // Konuları 3'erli paketlere böl
  const packages: string[][] = []
  for (let i = 0; i < topics.length; i += 3) {
    packages.push(topics.slice(i, i + 3))
  }

  console.log(`📦 Toplam Paket Sayısı: ${packages.length} paket denetlenecek.`)

  let overallPassed = true
  const allMissingDetails: string[] = []
  const allContradictions: string[] = []
  const auditedTopics: string[] = []

  let packIdx = 1
  for (const pack of packages) {
    console.log(`\n   👉 [Paket ${packIdx}/${packages.length}] Denetlenen Konular:`)
    pack.forEach((t, idx) => console.log(`      ${idx + 1}. ${t}`))

    // API kotalarını aşmamak için nefes payı
    await new Promise(r => setTimeout(r, 4000))

    try {
      const result = await auditNotesAgainstSourceSpecific(
        sec.rawContent,
        sec.notes || "",
        sec.title,
        pack,
        undefined,
        sec.pageStart,
        sec.pageEnd
      )

      auditedTopics.push(...pack)

      if (result.passed) {
        console.log(`      ✅ [MÜFETTİŞ DURUMU: PASS] Bu pakette hiçbir kılcal eksik veya bilgi hatası bulunamadı.`)
      } else {
        overallPassed = false
        console.warn(`      ❌ [MÜFETTİŞ DURUMU: FAIL] Eksiklikler veya hatalar tespit edildi!`)
        if (result.missingDetails && result.missingDetails.length > 0) {
          console.warn(`         Eksikler:`, result.missingDetails)
          allMissingDetails.push(...result.missingDetails)
        }
        if (result.contradictions && result.contradictions.length > 0) {
          console.warn(`         Hatalar:`, result.contradictions)
          allContradictions.push(...result.contradictions)
        }
      }
    } catch (err: any) {
      console.error(`      ❌ Paket denetlenirken hata oluştu:`, err.message)
      overallPassed = false
      allMissingDetails.push(`[Paket ${packIdx} Hatası] API çağrısı başarısız oldu: ${err.message}`)
    }

    packIdx++
  }

  console.log(`\n============================================================`)
  console.log(`📊 [MÜFETTİŞ BÖLÜM RAPORU - BÖLÜM ${sectionOrder}]`)
  console.log(`   Genel Sonuç: ${overallPassed ? "🟢 GEÇTİ (PASS)" : "🔴 EKSİK/HATA VAR (FAIL)"}`)
  console.log(`   Denetlenen Toplam Konu Sayısı: ${auditedTopics.length}/${topics.length}`)
  console.log(`   Toplam Tespit Edilen Eksik (Omission): ${allMissingDetails.length}`)
  console.log(`   Toplam Tespit Edilen Bilgi Hatası (Contradiction): ${allContradictions.length}`)

  // DB METADATA GÜNCELLEME (Arayüz modalında göstermek üzere)
  let issuesObj: any = {}
  try {
    issuesObj = sec.verificationIssues ? JSON.parse(sec.verificationIssues) : {}
  } catch {}

  issuesObj.auditResult = {
    passed: overallPassed,
    selectedTopics: auditedTopics, // Artık sadece 3 rastgele konu değil, TÜM konular!
    missingDetails: allMissingDetails,
    contradictions: allContradictions
  }

  await prisma.section.update({
    where: { id: sec.id },
    data: {
      verificationIssues: JSON.stringify(issuesObj)
    }
  })

  console.log(`💾 Müfettiş derin denetim sonuçları veritabanına başarıyla kaydedildi!`)
}

async function main() {
  const targetSections = [1] // Bölüm 1 için derin müfettiş denetimini salıyoruz!
  console.log(`🚀 [EKSİKSİZ MÜFETTİŞ SEFERBERLİĞİ] Hedef bölümler: ${targetSections.join(", ")}`)

  for (const order of targetSections) {
    await runAuditForSection(order)
  }

  console.log("\n✨ Müfettiş derin denetim seferberliği tamamlandı!")
}

main().catch(console.error).finally(() => prisma.$disconnect())

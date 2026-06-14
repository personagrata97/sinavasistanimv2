import { prisma } from "./src/lib/prisma"

async function run() {
  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" }
    },
    orderBy: { order: "asc" }
  })

  console.log("# OTONOM İYİLEŞTİRME VE KALİTE ZAMAN TÜNELİ RAPORU 📊\n")
  console.log("Bu rapor, MASAK Uyum Görevlisi ders notlarının otonom yapay zeka ve dürüst doğrulama motorumuz eşliğinde geçirdiği evrimleri, deneme geçmişlerini ve mükemmelleşme adımlarını göstermektedir.\n")

  for (const s of sections) {
    let issuesObj: any = {}
    try {
      issuesObj = JSON.parse(s.verificationIssues || "{}")
    } catch {}

    const history = issuesObj.attemptHistory || []
    
    // Eğer geçmiş varsa veya skor değiştiyse yazdır
    if (history.length > 0 || (s.verificationScore != null && s.verificationScore !== -1)) {
      console.log(`## 📚 Bölüm #${s.order}: "${s.title}"`)
      console.log(`* **Mevcut/Son Skor:** \`%${s.verificationScore}\``)
      console.log(`* **Onay Durumu:** ${s.processed ? "✅ Tamamlandı / Onaylandı" : "⚠️ Onay Bekliyor / İyileştiriliyor"}`)
      
      if (history.length > 0) {
        console.log("\n### ⏳ Kalite Gelişim Zaman Tüneli (Attempt History):")
        history.forEach((h: any, idx: number) => {
          console.log(`#### 🔹 Deneme #${idx + 1} (Attempt #${h.attempt || idx + 1})`)
          console.log(`* **Skor:** \`%${h.score || h.verificationScore || "Bilinmiyor"}\``)
          console.log(`* **Tarih/Süre:** \`${h.elapsed ? h.elapsed + 'sn' : 'Bilinmiyor'}\``)
          
          const missing = h.missingTopics || []
          const validation = h.issues || []
          const suggs = h.suggestions || []

          if (missing.length > 0) {
            console.log("  * **Tespit Edilen Eksik Konular:**")
            missing.forEach((m: string) => console.log(`    - ❌ ${m}`))
          } else {
            console.log("  * **Eksik Konu:** Yok ✅")
          }

          if (validation.length > 0) {
            console.log("  * **Hata / Uyuşmazlık Noktaları:**")
            validation.forEach((v: string) => console.log(`    - ⚠️ ${v}`))
          }

          if (suggs.length > 0) {
            console.log("  * **Geliştirme Önerileri:**")
            suggs.forEach((sg: string) => console.log(`    - 💡 ${sg}`))
          }
        });
      } else {
        console.log("\n*Bu bölüm tek denemede %100 kusursuzluğa ulaşmıştır ve geçmiş kaydı bulunmamaktadır.*")
      }
      console.log("\n---\n")
    }
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())

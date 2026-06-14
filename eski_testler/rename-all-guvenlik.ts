import { prisma } from "./src/lib/prisma"

const UPDATED_TITLES = [
  { order: 1, title: "Kısaltmalar ve Terimler" },
  { order: 2, title: "BİLGİ GÜVENLİĞİ YÖNETİMİ" },
  { order: 3, title: "VARLIK YÖNETİMİ" },
  { order: 4, title: "FİZİKSEL VE ÇEVRESEL GÜVENLİK" },
  { order: 5, title: "Ağ Güvenliği Giriş ve Temel Kavramlar" },
  { order: 6, title: "İnternet Katmanları (Surface, Deep, Dark Web)" },
  { order: 7, title: "Ağ Çeşitleri (PAN, LAN, WAN, MAN)" },
  { order: 8, title: "Ağ Modelleri (OSI ve TCP/IP Katmanları)" },
  { order: 9, title: "Uygulama Katmanı Protokolleri (SMTP, DNS, HTTP)" },
  { order: 10, title: "Ağ Servisleri ve Port Numaraları" },
  { order: 11, title: "IP Adres Sınıfları (A, B, C, D, E Sınıfları)" },
  { order: 12, title: "Sınıfsız Adresleme (CIDR) ve IPv6 Mimarisi" },
  { order: 13, title: "Kablosuz Ağ Bileşenleri ve Yapısı (AP, BSS, ESS)" },
  { order: 14, title: "Kablosuz Ağ Standartları ve Güvenlik Zafiyetleri" },
  { order: 15, title: "ERİŞİM GÜVENLİĞİ" },
  { order: 16, title: "VERİ VE İZ KAYITLARININ GÜVENLİĞİ" },
  { order: 17, title: "ÜÇÜNCÜ TARAFLARLA İLETİŞİM GÜVENLİĞİ" },
  { order: 18, title: "Bilgi Sistemleri Güvenliği Kaynakçası" }
]

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })

  if (!course) {
    console.error("Course not found!")
    return
  }

  console.log(`🚀 Starting database synchronization for 18 sections under "${course.name}"...`)

  for (const update of UPDATED_TITLES) {
    const result = await prisma.section.updateMany({
      where: {
        courseId: course.id,
        order: update.order
      },
      data: {
        title: update.title
      }
    })
    console.log(`✅ Synced: Section #${update.order} -> "${update.title}"`)
  }

  console.log("\n🎉 Database section title cleanup completed successfully!")
}

run().catch(console.error).finally(() => prisma.$disconnect())

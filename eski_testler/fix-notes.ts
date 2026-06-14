import { prisma } from './src/lib/prisma';
import fs from 'fs';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } } }
  })
  
  if (!course) return;
  const sec1 = course.sections[0];
  let notes = sec1.notes || "";

  // 1. ATM Hatası Düzeltmesi (Gerçek bilgi hatası formatına uygun)
  notes = notes.replace(
    /\|\s*\*\*ATM\*\*\s*\|\s*Asynchrous Transfer Mode \*\(\u26A0\uFE0F Önemli Detay: Kaynak metinde "Asynchronous" kelimesi "Asynchrous" şeklinde yazılmıştır\.\)\*\s*\|/g,
    '| **ATM** | Asynchrous Transfer Mode *(⚠️ Önemli Detay: SPL\'nin resmi çalışma notlarında bu terim "Asynchrous" olarak geçmektedir, ancak literatürdeki doğrusu "Asynchronous" şeklindedir.)* |'
  );

  // 2. Wi-Fi OCR Hatası Düzeltmesi (Sessizce düzeltme ve boşlukları temizleme)
  notes = notes.replace(
    /\|\s*\*\*Wi-Fi\*\*\s*\|\s*W ireless F idelity \( Kablosuz Bağlantı Alanı \) \*\(\u26A0\uFE0F Önemli Detay: Kaynak metinde "Wireless Fidelity" kelimeleri "W ireless F idelity" şeklinde, "W" ile "ireless" ve "F" ile "idelity" arasında birer boşluk olacak şekilde yazılmıştır\.\)\*\s*\|/g,
    '| **Wi-Fi** | Wireless Fidelity (Kablosuz Bağlantı Alanı) |'
  );

  // 3. TTK Bilgi Hatası Düzeltmesi (Doğrusunu öğreterek)
  notes = notes.replace(
    /\|\s*\*\*TTK\*\*\s*\|\s*610 sayılı Türk Ticaret Kanunu \*\(\u26A0\uFE0F Önemli Detay: Kaynak metinde kanun numarası "610" olarak belirtilmiştir\.\)\*\s*\|/g,
    '| **TTK** | 610 sayılı Türk Ticaret Kanunu *(⚠️ Önemli Detay: SPL\'nin resmi çalışma notlarında kanun numarası hatalı olarak "610" geçmektedir, ancak gerçekte Türk Ticaret Kanunu\'nun numarası 6102\'dir.)* |'
  );

  await prisma.section.update({
    where: { id: sec1.id },
    data: { notes }
  });

  console.log("Düzeltmeler yapıldı ve veritabanına kaydedildi. Yeni uzunluk:", notes.length);
}
main().catch(console.error).finally(() => prisma.$disconnect())

import { prisma } from "./src/lib/prisma"

async function run() {
  const sec7 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 7
    }
  })

  if (!sec7 || !sec7.notes) {
    console.error("Section 7 or notes not found!")
    return
  }

  let notes = sec7.notes

  // 1. Replace the combined Table 2 with a clean 2-column table and callout box
  const oldTable2 = `| Durum | Bildirim Süresi | Ana Kuruluş Sayılmayan İstisnalar |
| :--- | :--- | :--- |
| **Finansal Grubun İlk Oluşumu** | Koşulların gerçekleştiği tarihten itibaren **10 gün** içinde | Türkiye Varlık Fonu (TVF) |
| **Gruba Yeni Katılan veya Gruptan Çıkan Kuruluş Olması** | Değişikliğin meydana geldiği tarihten itibaren **30 gün** içinde | Tasarruf Mevduatı Sigorta Fonu (TMSF) |
| **-** | - | Vakıflar Genel Müdürlüğü |`

  const newTable2 = `| Durum | Bildirim Süresi |
| :--- | :--- |
| **Finansal Grubun İlk Oluşumu** | Koşulların gerçekleştiği tarihten itibaren **10 gün** içinde |
| **Gruba Yeni Katılan veya Gruptan Çıkan Kuruluş Olması** | Değişikliğin meydana geldiği tarihten itibaren **30 gün** içinde |

> ℹ️ **Ana Kuruluş Sayılmayan İstisnalar (Kritik Sınav Detayı):**
> Türkiye Varlık Fonu (TVF), Tasarruf Mevduatı Sigorta Fonu (TMSF) ve Vakıflar Genel Müdürlüğü gibi finansal kuruluşlarda ortaklığı bulunan kamusal niteliği haiz kurum ve kuruluşlar, finansal grup oluşumu bakımından **ana kuruluş olarak değerlendirilmez.**`

  if (notes.includes(oldTable2)) {
    notes = notes.replace(oldTable2, newTable2)
    console.log("✅ Successfully replaced Table 2!")
  } else {
    console.warn("⚠️ Table 2 not found! Checking alternative match...")
    // Fallback simple match if whitespace or format slightly differs
    const lines = notes.split("\n")
    const table2StartIndex = lines.findIndex(l => l.includes("Finansal Grubun İlk Oluşumu") && l.includes("Varlık Fonu"))
    if (table2StartIndex !== -1) {
      // Find where table ends
      let endIdx = table2StartIndex
      while (endIdx < lines.length && lines[endIdx].trim().startsWith("|")) {
        endIdx++
      }
      lines.splice(table2StartIndex - 2, endIdx - table2StartIndex + 2, newTable2)
      notes = lines.join("\n")
      console.log("✅ Replaced Table 2 using fallback lines parser!")
    }
  }

  // 2. Replace the combined Table 4 with structured list and callout box
  const oldTable4 = `| Uyum Programı Oluşturmakla Yükümlü Olanlar | Bu Yükümlülükten Hariç Tutulanlar / İstisnalar |
| :--- | :--- |
| • Bankalar | • **Türkiye Cumhuriyet Merkez Bankası (TCMB)** |
| • Sermaye piyasası aracı kurumları | • **İstanbul Takas ve Saklama Bankası A.Ş. (Takasbank)** |
| • Sigorta ve emeklilik şirketleri | • Ödeme kuruluşlarından; *münhasıran fatura ödemelerine aracılık hizmeti*, *münhasıran ödeme emri başlatma hizmeti* ve *münhasıran ödeme hesabına ilişkin bilgilerin sunulması hizmeti* sağlayanlar. |
| • Posta ve Telgraf Teşkilatı A.Ş. (Bankacılık Faaliyeti) | |
| • A grubu yetkili müesseseler | |
| • Finansman, faktoring ve finansal kiralama şirketleri | |
| • Portföy yönetim şirketleri | |
| • Kıymetli madenler aracı kuruluşları | |
| • Elektronik para kuruluşları | |
| • Ödeme kuruluşları (İstisnalar hariç) | |
| • Kripto varlık hizmet sağlayıcılar | |`

  const newTable4 = `#### 🏢 Uyum Programı Oluşturmakla Yükümlü Olanlar
Uyum programı oluşturmakla yükümlü olan finansal kuruluşlar şunlardır:
* **Bankalar** *(Aşağıdaki TCMB ve Takasbank istisnası hariç)*
* **Sermaye Piyasası Aracı Kurumları**
* **Sigorta ve Emeklilik Şirketleri** *(Hiçbir yasal istisnası yoktur, tamamen yükümlüdür!)*
* **Posta ve Telgraf Teşkilatı A.Ş. (PTT)** *(Sadece bankacılık faaliyetleri ile sınırlı olarak)*
* **A Grubu Yetkili Müesseseler** *(Döviz büroları)*
* **Finansman, Faktoring ve Finansal Kiralama Şirketleri**
* **Portföy Yönetim Şirketleri**
* **Kıymetli Madenler Aracı Kuruluşları**
* **Elektronik Para Kuruluşları**
* **Ödeme Kuruluşları** *(Aşağıda belirtilen spesifik faaliyet istisnaları hariç)*
* **Kripto Varlık Hizmet Sağlayıcılar (KVHS)**

> 🚫 **Uyum Programı Yükümlülüğünden Muaf Tutulanlar (İstisnalar):**
> * **Bankacılık Sektörü İstisnaları:** **Türkiye Cumhuriyet Merkez Bankası (TCMB)** ve **İstanbul Takas ve Saklama Bankası A.Ş. (Takasbank)** uyum programı oluşturma yükümlülüğünden tamamen hariç tutulmuştur.
> * **Ödeme Hizmetleri Sektörü İstisnaları:** Ödeme kuruluşlarından yalnızca aşağıda belirtilen üç faaliyeti yürütenler uyum programı yükümlülüğünden muaftır:
>   1. Münhasıran fatura ödemelerine aracılık hizmeti sunanlar.
>   2. Münhasıran ödeme emri başlatma hizmeti sunanlar.
>   3. Münhasıran ödeme hesabına ilişkin bilgilerin sunulması hizmetini sağlayanlar.
> * **Diğer Yükümlüler (Sınav Tuzağı!):** Sigorta ve emeklilik şirketleri, yetkili müesseseler, leasing/faktoring, portföy yönetim, kıymetli madenler, elektronik para ve kripto varlık hizmet sağlayıcılar için **mevzuatta hiçbir istisna/muafiyet bulunmamaktadır.** Bu kuruluşlar doğrudan uyum programı oluşturmakla yükümlüdür.`

  if (notes.includes(oldTable4)) {
    notes = notes.replace(oldTable4, newTable4)
    console.log("✅ Successfully replaced Table 4!")
  } else {
    console.warn("⚠️ Table 4 not found! Checking alternative match...")
    const lines = notes.split("\n")
    const table4StartIndex = lines.findIndex(l => l.includes("Bankalar") && l.includes("TCMB") && l.includes("Uyum Programı"))
    if (table4StartIndex !== -1) {
      let endIdx = table4StartIndex
      while (endIdx < lines.length && lines[endIdx].trim().startsWith("|")) {
        endIdx++
      }
      lines.splice(table4StartIndex - 2, endIdx - table4StartIndex + 2, newTable4)
      notes = lines.join("\n")
      console.log("✅ Replaced Table 4 using fallback lines parser!")
    }
  }

  // Update in the database
  await prisma.section.update({
    where: { id: sec7.id },
    data: { notes }
  })
  console.log("🎉 Section 7 notes database record updated successfully!")
}

run().catch(console.error).finally(() => prisma.$disconnect())

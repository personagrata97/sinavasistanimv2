import { remark } from 'remark';
import { visit } from 'unist-util-visit';
import { callAI, extractCleanJson } from './ai-service';

// Tip tanımları
interface ASTNode {
  type: string;
  depth?: number;
  children?: ASTNode[];
  value?: string;
  position?: any;
}

/**
 * AST-Tabanlı Cerrahi Yama Motoru (Surgical Micro-Patching Engine)
 */
export async function generateAndInjectPatch(
  markdownContent: string,
  missingFacts: string[],
  fullCourseName: string,
  rawContent: string,
  sectionTitle: string
): Promise<{ success: boolean; newMarkdown: string; failedFacts: string[] }> {
  console.log(`[PATCH_ENGINE] 🚀 Yama motoru başlatılıyor. Toplam eksik: ${missingFacts.length}`);

  if (missingFacts.length === 0) {
    return { success: true, newMarkdown: markdownContent, failedFacts: [] };
  }

  // 1. Markdown'u AST'ye çevir
  const ast = remark().parse(markdownContent);

  // 2. Belgenin İskeletini (Outline) Çıkar
  const outline: { title: string; index: number; depth: number }[] = [];
  let headingIndex = 0;

  visit(ast, 'heading', (node: any) => {
    let title = '';
    visit(node, 'text', (textNode: any) => {
      title += textNode.value;
    });
    outline.push({ title: title.trim(), index: headingIndex++, depth: node.depth });
  });

  let isFallback = false;
  if (outline.length === 0) {
    console.log(`[PATCH_ENGINE] ⚠️ Belgede hiç başlık bulunamadı. Fallback moduna geçiliyor.`);
    // Fallback: Tüm metni tek bir yama işlemine sok (Çok riskli ama başlık yoksa mecburi)
    isFallback = true;
    outline.push({ title: "Genel Kapsam", index: 0, depth: 1 });
  }

  const outlineText = outline.map(h => `${'#'.repeat(h.depth)} ${h.title} (ID: ${h.index})`).join('\n');
  console.log(`[PATCH_ENGINE] 🗺️ Belge İskeleti Çıkarıldı:\n${outlineText}`);

  // 3. Micro-Finder (Yer Tespit Ajanı)
  console.log(`[PATCH_ENGINE] 🕵️‍♂️ Micro-Finder: Eksik bilgilerin rotası çiziliyor...`);
  const finderPrompt = `[LOG_CONTEXT: ${fullCourseName} > ${sectionTitle}]
Sen bir yer tespit ajanısın. Aşağıda bir ders notunun "Başlık İskeleti" ve nota eklenmesi unutulmuş "Eksik Bilgiler" listesi var.
Görev: Her eksik bilginin mantıksal olarak hangi başlığın (ID) altına eklenmesi gerektiğini bul. Eğer hiçbir başlık uygun değilse, tamamen yeni bir alt konuysa ID olarak -1 ver (Evsiz Bilgi).

İSKELET:
${outlineText}

EKSİK BİLGİLER:
${missingFacts.map((f, i) => `[F${i}] ${f}`).join('\n')}

SADECE şu JSON formatında cevap ver:
{
  "routing": [
    { "factId": "F0", "targetHeadingId": 2 },
    { "factId": "F1", "targetHeadingId": -1 }
  ]
}
`;

  let routing: { factId: string; targetHeadingId: number }[] = [];
  try {
    const finderRaw = await callAI(finderPrompt, 1, "cerrahi_yama");
    const parsed = extractCleanJson(finderRaw) as any;
    if (parsed && parsed.routing) {
      routing = parsed.routing;
    } else {
      throw new Error("Invalid routing format");
    }
  } catch (err) {
    console.log(`[PATCH_ENGINE] 🚨 Micro-Finder çuvalladı. Hata: ${err}`);
    return { success: false, newMarkdown: markdownContent, failedFacts: missingFacts };
  }

  // Gruplama (Çarpışan Yamaları Engelleme)
  const groupedFacts = new Map<number, string[]>();
  for (const route of routing) {
    const factIndex = parseInt(route.factId.replace('F', ''));
    if (isNaN(factIndex) || factIndex < 0 || factIndex >= missingFacts.length) continue;
    
    const factText = missingFacts[factIndex];
    const targetId = route.targetHeadingId;
    
    if (!groupedFacts.has(targetId)) {
      groupedFacts.set(targetId, []);
    }
    groupedFacts.get(targetId)!.push(factText);
  }

  console.log(`[PATCH_ENGINE] 📦 Eksikler gruplandı. Hedef Nokta Sayısı: ${groupedFacts.size}`);

  let currentMarkdown = markdownContent;
  const stillFailedFacts: string[] = [];

  // 4. Chunk İşleme ve Micro-Writer (Sıralı işlem, çarpışmayı önler)
  // Not: İşlemleri AST üzerinde yapmak yerine, şimdilik güvenilir olması için her adımda string -> ast -> string yapıyoruz,
  // çünkü düğüm indeksleri değişebilir.

  for (const [targetId, facts] of groupedFacts.entries()) {
    console.log(`[PATCH_ENGINE] 🛠️ Düğüm ID: ${targetId} işleniyor. Eklenecek ${facts.length} bilgi var.`);
    
    const isGlossary = sectionTitle.toLocaleLowerCase('tr-TR').includes("kısaltma") || sectionTitle.toLocaleLowerCase('tr-TR').includes("sözlük");
    const tempAst = remark().parse(currentMarkdown);
    
    if (targetId === -1) {
      // Evsiz Bilgiler (En alta yeni bölüm olarak ekle)
      console.log(`[PATCH_ENGINE] 🏠 Evsiz Bilgi (Orphan Fact) tespiti. Yeni modül üretiliyor...`);
      
      const glossaryConstraints = isGlossary ? `
🚨 KISALTMALAR / SÖZLÜK BÖLÜMÜ KURALLARI:
- Bu bölüm bir kısaltma/sözlük listesidir! KESİNLİKLE hikaye, analoji, derin analiz (örn: Kurumsal Yapı Analizi) YAZMA!
- ASLA MERMAID (AKIŞ ŞEMASI) ÇİZME!
- Eksik olan bu bilgiyi SADECE mevcut formata uygun, sade bir şekilde listeye/tabloya dahil et.
` : `gerekirse açıklayıcı bir tablo veya hikaye/analoji içeren profesyonel bir Markdown modülü üret.`;

      const writerPrompt = `[LOG_CONTEXT: ${fullCourseName} > ${sectionTitle}]
Aşağıdaki bilgiler notta tamamen unutulmuş ve eklenecek mevcut bir başlık yok.
Senden bu bilgileri kapsayan, konunun formatına uygun (### Alt Başlık) bir Markdown modülü üretmeni istiyorum.

${glossaryConstraints}

⚠️ GEÇİCİ TEST KURALI: Eklediğin tüm metinleri ve bilgileri MUTLAKA <span style="color: #22c55e; font-weight: bold;">...</span> etiketleri arasına alarak yeşil renkli yap. Kesinlikle unutma!

🚨 KAYNAK HATALARINI YÖNETME MUHAKEMESİ (TRIVIAL vs CRITICAL):
Eksik bilgileri eklerken kaynak metinde yazar veya dizgi kaynaklı bir hata (Standart/Standard gibi harf, imla veya telaffuz farklılığı) fark edersen, KESİNLİKLE uyarı veya şerh düşme! Okunabilirliği bozmamak için kaynağa BİREBİR sadık kal, kaynakta ne yazıyorsa aynen yaz ve geç. Asla "Doğrusu budur" diye ukalalık yapma. SADECE yanlış kanun veya ceza miktarı gibi yasal/sayısal hatalarda parantez içinde uyarı ekleyebilirsin.

EKSİK BİLGİLER:
${facts.join('\n')}

SADECE EKLENECEK MARKDOWN METNİNİ ÜRET. (Başına ve sonuna json vs yazma, direkt markdown ver).`;
      
      try {
        const newModule = await callAI(writerPrompt, 1, "notes_generation"); // Micro-Writer yüksek zekalı model kullanmalı
        currentMarkdown += `\n\n${newModule.trim()}\n`;
        console.log(`[PATCH_ENGINE] ✅ Evsiz modül belge sonuna başarıyla eklendi.`);
      } catch (err) {
        console.log(`[PATCH_ENGINE] ❌ Evsiz modül üretilemedi.`);
        stillFailedFacts.push(...facts);
      }
      continue;
    }

    // Mevcut bir başlığa yama yapılacak
    // Başlığı ve altındaki içeriği AST'den çek
    let chunkText = '';
    let inTargetHeading = false;
    let targetDepth = 0;
    
    let headingCounter = 0;
    let chunkStartIndex = -1;
    let chunkEndIndex = -1;

    // AST'nin root.children dizisini tarayalım
    const children = (tempAst as any).children || [];
    
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.type === 'heading') {
        if (headingCounter === targetId) {
          inTargetHeading = true;
          targetDepth = node.depth;
          chunkStartIndex = i;
        } else if (inTargetHeading) {
          // Başka bir başlığa geldik. Eğer derinliği hedef başlığa eşit veya daha büyükse (daha küçük rakam) o bölüm bitmiştir.
          if (node.depth <= targetDepth) {
            inTargetHeading = false;
            chunkEndIndex = i;
            break;
          }
        }
        headingCounter++;
      }
    }
      
    if (chunkEndIndex === -1) chunkEndIndex = children.length;

    // Position ile ham stringden kesit alalım
    let startPos = -1;
    let endPos = -1;

    if (isFallback) {
      startPos = 0;
      endPos = currentMarkdown.length;
    } else if (chunkStartIndex !== -1) {
      startPos = children[chunkStartIndex].position.start.offset;
      endPos = chunkEndIndex < children.length ? children[chunkEndIndex].position.start.offset : currentMarkdown.length;
    }

    if (startPos !== -1) {
      const originalChunk = currentMarkdown.substring(startPos, endPos);
      
      console.log(`[PATCH_ENGINE] ✂️ Kesit alındı (${originalChunk.length} karakter). Yama ajanına gönderiliyor...`);

      const writerPrompt = `[LOG_CONTEXT: ${fullCourseName} > ${sectionTitle}]
Sen bir cerrahi yama (surgical patch) uzmanısın. Ders notunun belli bir paragrafı (Mevcut Metin) ve oraya ustaca kaynaştırılması gereken yeni bilgiler (Eksik Bilgiler) sana veriliyor.

MEVCUT KESİT:
${originalChunk}

EKSİK BİLGİLER (Şu an kesitte yok, sen ekleyeceksin):
${facts.join('\n')}

GÖREV: Mevcut kesiti al, eksik bilgileri içine kusursuzca (sanki ilk seferde yazılmış gibi) yedirerek KESİTİ YENİDEN YAZ.
- Mevcut kesitteki hikayeler, tablolar veya listeler varsa ASLA BOZMA.
- Eksik bilgi bir süreç/hiyerarşi gerektiriyorsa şema (mermaid) kullanabilirsin, tanım gerektiriyorsa tabloya ekleyebilirsin veya sadece doğal bir paragraf olarak yedirebilirsin.
- Eksik bilgiyi körü körüne sonuna yapıştırma, mantıklı olan yere yedir.

🚨 KAYNAK HATALARINI YÖNETME MUHAKEMESİ (TRIVIAL vs CRITICAL):
Eksik bilgileri eklerken kaynak metinde yazar veya dizgi kaynaklı bir hata (Standart/Standard gibi harf, imla veya telaffuz farklılığı) fark edersen, KESİNLİKLE uyarı veya şerh düşme! Okunabilirliği bozmamak için kaynağa BİREBİR sadık kal, kaynakta ne yazıyorsa aynen yaz ve geç. Asla "Doğrusu budur" diye ukalalık yapma. SADECE yanlış kanun veya ceza miktarı gibi yasal/sayısal hatalarda parantez içinde uyarı ekleyebilirsin.

⚠️ GEÇİCİ TEST KURALI: Cümlelerin akışını bozmadan, içine yedirdiğin ve yeni eklediğin tüm kelimeleri/cümleleri MUTLAKA <span style="color: #22c55e; font-weight: bold;">...</span> etiketleri arasına alarak yeşil renkte parlamasını sağla. Mevcut kesitteki orijinal metinlere bu etiketi ekleme.

SADECE yenilenmiş kesiti Markdown formatında ver. Başka hiçbir açıklama yazma.
`;

      try {
        let patchedChunk = await callAI(writerPrompt, 1, "notes_generation");
        patchedChunk = patchedChunk.replace(/^```markdown/g, '').replace(/```$/g, '').trim();
        
        // String değişimi
        currentMarkdown = currentMarkdown.substring(0, startPos) + patchedChunk + "\n\n" + currentMarkdown.substring(endPos);
        console.log(`[PATCH_ENGINE] ✅ Yama başarıyla kesite enjekte edildi.`);
      } catch (err) {
        console.log(`[PATCH_ENGINE] ❌ Yama ajanı çuvalladı. Bu düğüm atlanıyor.`);
        stillFailedFacts.push(...facts);
      }
    } else {
      console.log(`[PATCH_ENGINE] ❌ Hedef düğüm AST'de bulunamadı.`);
      stillFailedFacts.push(...facts);
    }
  }

  const success = stillFailedFacts.length === 0;
  console.log(`[PATCH_ENGINE] 🎉 Yama operasyonu bitti. Başarı: ${success}. Çözülemeyen eksik: ${stillFailedFacts.length}`);

  return { success, newMarkdown: currentMarkdown, failedFacts: stillFailedFacts };
}

import { remark } from 'remark';
import { callAI, extractCleanJson } from './ai-service';

export async function generateAndInjectPatch(
  markdownContent: string,
  missingFacts: string[],
  fullCourseName: string,
  rawContent: string,
  sectionTitle: string
): Promise<{ success: boolean; newMarkdown: string; failedFacts: string[] }> {
  console.log(`[PATCH_ENGINE] 🚀 AST Enjeksiyon Motoru başlatılıyor. Toplam eksik: ${missingFacts.length}`);

  if (missingFacts.length === 0) {
    return { success: true, newMarkdown: markdownContent, failedFacts: [] };
  }

  // 1. Markdown'u AST'ye çevir
  const ast: any = remark().parse(markdownContent);
  const children = ast.children || [];

  if (children.length === 0) {
    console.log(`[PATCH_ENGINE] ⚠️ Belge boş. Fallback iptal.`);
    return { success: false, newMarkdown: markdownContent, failedFacts: missingFacts };
  }

  // 2. Blok Numaralandırma (Indexleme)
  const blockList = children.map((node: any, idx: number) => {
    // Sadece bu node'u string'e çevirip içeriğine bakıyoruz
    const blockText = remark().stringify({ type: 'root', children: [node] } as any).trim();
    return { id: idx, text: blockText, type: node.type };
  });

  const numberedBlocksText = blockList.map((b: any) => `[ID: ${b.id}] (${b.type})\n${b.text}`).join('\n\n');

  // 3. Micro-Finder (Hedef Belirleyici)
  console.log(`[PATCH_ENGINE] 🕵️‍♂️ Micro-Finder: Blok hedefleri belirleniyor...`);
  const finderPrompt = `[LOG_CONTEXT: ${fullCourseName} > ${sectionTitle}]
Sen bir Cerrahi Yama (AST) Yer Tespit Ajanısın.
Aşağıda, her bir paragrafı, başlığı ve listesi numaralandırılmış ([ID: X]) bir ders notu var.
Ayrıca bu nota eklenmesi/düzeltilmesi gereken "Eksik/Hatalı Bilgiler" listesi var.

Görev: Her bilgi için notta MÜDAHALE EDİLECEK EN MANTIKLI bloğu (ID) seç.
- Yeni bir bilgi eklenecekse, o bilginin mantıksal olarak hangi bloğun DEVAMINA (altına) gelmesi gerektiğini bul ve "insert_after" seç.
- Çelişkili/hatalı bir bilginin düzeltilmesi isteniyorsa ([ÇELİŞKİ DÜZELTMESİ]), o hatalı bilginin geçtiği bloğu (ID) bul ve "replace" seç.

NUMARALANDIRILMIŞ BELGE İSKELETİ:
${numberedBlocksText}

EKSİK/HATALI BİLGİLER:
${missingFacts.map((f, i) => `[F${i}] ${f}`).join('\n')}

SADECE şu JSON formatında cevap ver:
{
  "routing": [
    { "factId": "F0", "action": "insert_after", "targetBlockId": 2 },
    { "factId": "F1", "action": "replace", "targetBlockId": 5 }
  ]
}
Dikkat: targetBlockId belge içindeki geçerli bir ID olmalıdır.
`;

  let routing: { factId: string; action: string; targetBlockId: number }[] = [];
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
    // AST tabanlı yama başarısız olursa, fallback olarak eski cerrahi yama (smartInject) dene
    console.log(`[PATCH_ENGINE] 🔄 AST Fallback: smartInjectCourseNotes ile yedek yama deneniyor...`);
    try {
      const { smartInjectCourseNotes } = await import('./ai-service');
      const fallbackResult = await smartInjectCourseNotes(
        markdownContent,
        missingFacts.join("\n"),
        sectionTitle,
        fullCourseName,
        "",
        ""
      );
      if (fallbackResult && fallbackResult.length > markdownContent.length * 0.5) {
        console.log(`[PATCH_ENGINE] ✅ Fallback yama başarılı (${fallbackResult.length} karakter).`);
        return { success: true, newMarkdown: fallbackResult, failedFacts: [] };
      }
    } catch (fallbackErr) {
      console.log(`[PATCH_ENGINE] ❌ Fallback yama da başarısız:`, fallbackErr);
    }
    return { success: false, newMarkdown: markdownContent, failedFacts: missingFacts };
  }

  // Gruplama (Hedef Block ID'sine ve Action'a göre)
  const targetOps = new Map<number, { replaceFacts: string[]; insertAfterFacts: string[] }>();
  for (const route of routing) {
    const factIndex = parseInt(route.factId.replace('F', ''));
    if (isNaN(factIndex) || factIndex < 0 || factIndex >= missingFacts.length) continue;
    
    // Geçerli bir target ID mi?
    if (route.targetBlockId < 0 || route.targetBlockId >= children.length) continue;

    const factText = missingFacts[factIndex];
    if (!targetOps.has(route.targetBlockId)) {
      targetOps.set(route.targetBlockId, { replaceFacts: [], insertAfterFacts: [] });
    }
    
    const op = targetOps.get(route.targetBlockId)!;
    if (route.action === 'replace') {
      op.replaceFacts.push(factText);
    } else if (route.action === 'insert_after') {
      op.insertAfterFacts.push(factText);
    }
  }

  console.log(`[PATCH_ENGINE] 📦 Hedef bloklar gruplandı. Blok Sayısı: ${targetOps.size}`);

  const stillFailedFacts: string[] = [];
  
  // AST'yi kopyalayalım, çünkü üzerine eklemeler/değiştirmeler yapacağız
  let newChildren = [...children];
  
  // targetBlockId'ye göre azalan sırada (büyükten küçüğe) sıralayalım
  const sortedTargetIds = Array.from(targetOps.keys()).sort((a, b) => b - a);

  for (const targetId of sortedTargetIds) {
    const ops = targetOps.get(targetId)!;
    const targetBlockText = blockList[targetId].text;
    const succeedingBlockText = blockList[targetId + 1]?.text || undefined;

    let replacementLength = 1; // Başlangıçta hedef blok 1 element boyutundadır.

    // 1. Önce REPLACE (Varsa)
    if (ops.replaceFacts.length > 0) {
      console.log(`[PATCH_ENGINE] 🛠️ REPLACE Operasyonu: ID=${targetId}, Fact Sayısı=${ops.replaceFacts.length}`);
      
      let writerPrompt = `[LOG_CONTEXT: ${fullCourseName} > ${sectionTitle}]
Sen bir Cerrahi Yama Yazarı (Micro-Writer) ajanısın. Görevin bir Markdown bloğuna noktasal müdahale yapmaktır.
Sana bir hedef blok verilecek ve bazı eksik/hatalı bilgiler verilecek.

HEDEF BLOK:
${targetBlockText}

EKSİK/HATALI BİLGİLER:
${ops.replaceFacts.join('\n')}

GÖREV:
Bu hedef blokta çelişkili veya yanlış bir bilgi var. Bu bloğu DÜZELTEREK baştan yaz. Sadece düzeltilmiş bloğu (markdown) ver. Ekstra bir şey yazma.

🚨 GİZLİLİK KURALI (STEALTH MODE): Eklediğin veya değiştirdiğin metnin başına ASLA "Ayrıca", "Ek olarak", "Bunun yanı sıra", "Belirtmek gerekir ki", "Özetle", "Not:" gibi yapay geçiş kelimeleri KOYMA. Önceki metnin %100 organik bir parçası gibi davran, sonradan yama yapıldığını ASLA belli etme. Üslup, format ve tonlama hedef blokla BİREBİR aynı olmalıdır.

⚠️ GEÇİCİ TEST KURALI: Eklediğin veya değiştirdiğin tüm metinleri MUTLAKA <span style="color: #22c55e; font-weight: bold;">...</span> etiketleri arasına alarak yeşil renkli yap.

SADECE MARKDOWN KODUNU DÖNDÜR. (Başına ve sonuna json vs yazma).`;

      try {
        const newModule = await callAI(writerPrompt, 1, "notes_generation");
        const generatedAst: any = remark().parse(newModule.trim());
        const generatedNodes = generatedAst.children || [];
        
        // targetId'deki 1 elementi sil ve yeni node'ları ekle
        newChildren.splice(targetId, 1, ...generatedNodes);
        replacementLength = generatedNodes.length; // Array'de kapladığı yeni boyut
        console.log(`[PATCH_ENGINE] ✅ [ID:${targetId}] değişimi (REPLACE) başarılı. Yeni blok sayısı: ${replacementLength}`);
      } catch (err) {
        console.log(`[PATCH_ENGINE] ❌ [ID:${targetId}] REPLACE operasyonu başarısız:`, err);
        stillFailedFacts.push(...ops.replaceFacts);
      }
    }

    // 2. Sonra INSERT_AFTER (Varsa)
    if (ops.insertAfterFacts.length > 0) {
      console.log(`[PATCH_ENGINE] 🛠️ INSERT_AFTER Operasyonu: ID=${targetId}, Fact Sayısı=${ops.insertAfterFacts.length}`);
      
      let writerPrompt = `[LOG_CONTEXT: ${fullCourseName} > ${sectionTitle}]
Sen bir Cerrahi Yama Yazarı (Micro-Writer) ajanısın. Görevin bir Markdown bloğuna noktasal müdahale yapmaktır.
Sana bir hedef blok verilecek ve bazı eksik/hatalı bilgiler verilecek.

HEDEF BLOK:
${targetBlockText}
`;

      if (succeedingBlockText) {
        writerPrompt += `
HEDEFTEN HEMEN SONRA GELEN BLOK (BAĞLAM):
${succeedingBlockText}
`;
      }

      writerPrompt += `
EKSİK/HATALI BİLGİLER:
${ops.insertAfterFacts.join('\n')}

GÖREV:
Bu hedef bloğu YENİDEN YAZMA. Sadece bu bilgileri anlatan, bu bloğun altına eklenecek YENİ BİR metin üret. DİKKAT: Hedef blok bir tablo ise yeni bir tablo satırı, bir liste ise yeni bir liste maddesi, bir hikaye/senaryo ise senaryonun devamı niteliğinde, akademik bir metinse akademik bir paragraf üret. Sadece YENİ EKLENECEK markdown metnini ver.${succeedingBlockText ? " Ürettiğin yeni metin, hem kendisinden önceki HEDEF BLOK ile hem de kendisinden sonra gelen HEDEFTEN HEMEN SONRA GELEN BLOK ile dilsel, anlamsal ve akış olarak kusursuz bir köprü oluşturmalıdır." : ""}

🚨 GİZLİLİK KURALI (STEALTH MODE): Eklediğin veya değiştirdiğin metnin başına ASLA "Ayrıca", "Ek olarak", "Bunun yanı sıra", "Belirtmek gerekir ki", "Özetle", "Not:" gibi yapay geçiş kelimeleri KOYMA. Önceki metnin %100 organik bir parçası gibi davran, sonradan yama yapıldığını ASLA belli etme. Üslup, format ve tonlama hedef blokla BİREBİR aynı olmalıdır.

⚠️ GEÇİCİ TEST KURALI: Eklediğin veya değiştirdiğin tüm metinleri MUTLAKA <span style="color: #22c55e; font-weight: bold;">...</span> etiketleri arasına alarak yeşil renkli yap.

SADECE MARKDOWN KODUNU DÖNDÜR. (Başına ve sonuna json vs yazma).`;

      try {
        const newModule = await callAI(writerPrompt, 1, "notes_generation");
        const generatedAst: any = remark().parse(newModule.trim());
        const generatedNodes = generatedAst.children || [];
        
        // Ekleme noktasını hesapla:
        // Eğer replace işlemi yapıldıysa, yeni düğümlerin bittiği yere yerleştir (targetId + replacementLength)
        // Eğer replace yapılmadıysa, hedef bloğun hemen arkasına yerleştir (targetId + 1)
        const insertPos = targetId + replacementLength;
        newChildren.splice(insertPos, 0, ...generatedNodes);
        console.log(`[PATCH_ENGINE] ✅ [ID:${targetId}] sonrasına enjeksiyon (INSERT_AFTER) başarılı.`);
      } catch (err) {
        console.log(`[PATCH_ENGINE] ❌ [ID:${targetId}] INSERT_AFTER operasyonu başarısız:`, err);
        stillFailedFacts.push(...ops.insertAfterFacts);
      }
    }
  }

  // Sonuç ağacını tekrar string'e çevir
  ast.children = newChildren;
  const finalMarkdown = remark().stringify(ast);
  
  const success = stillFailedFacts.length === 0;
  return { success, newMarkdown: finalMarkdown, failedFacts: stillFailedFacts };
}

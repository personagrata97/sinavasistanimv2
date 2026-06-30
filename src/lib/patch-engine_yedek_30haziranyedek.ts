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
  // key format: "targetId_action"
  const groupedFacts = new Map<string, string[]>();
  for (const route of routing) {
    const factIndex = parseInt(route.factId.replace('F', ''));
    if (isNaN(factIndex) || factIndex < 0 || factIndex >= missingFacts.length) continue;
    
    // Geçerli bir target ID mi?
    if (route.targetBlockId < 0 || route.targetBlockId >= children.length) continue;

    const factText = missingFacts[factIndex];
    const key = `${route.targetBlockId}_${route.action}`;
    
    if (!groupedFacts.has(key)) {
      groupedFacts.set(key, []);
    }
    groupedFacts.get(key)!.push(factText);
  }

  console.log(`[PATCH_ENGINE] 📦 Eksikler hedeflere gruplandı. Operasyon Sayısı: ${groupedFacts.size}`);

  const stillFailedFacts: string[] = [];
  
  // AST'yi kopyalayalım, çünkü üzerine eklemeler/değiştirmeler yapacağız
  let newChildren = [...children];
  // Index kaymalarını takip etmek için bir offset map kullanacağız
  // Veya tersten işlem yapabiliriz! Tersten işlersek (Büyük ID'den küçüğe), eklediğimiz şeyler önceki ID'leri kaydırmaz.
  
  // Anahtarları targetId'ye göre azalan sırada sıralayalım.
  const sortedKeys = Array.from(groupedFacts.keys()).sort((a, b) => {
    const idA = parseInt(a.split('_')[0]);
    const idB = parseInt(b.split('_')[0]);
    return idB - idA; // Büyükten küçüğe
  });

  for (const key of sortedKeys) {
    const [idStr, action] = key.split('_');
    const targetId = parseInt(idStr);
    const facts = groupedFacts.get(key)!;
    
    const targetBlockText = blockList[targetId].text;
    const succeedingBlockText = blockList[targetId + 1]?.text || undefined;

    console.log(`[PATCH_ENGINE] 🛠️ Operasyon: ID=${targetId}, Action=${action}. Bekleyen ${facts.length} fact var.`);
    
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
${facts.join('\n')}

GÖREV:
${action === 'insert_after' 
  ? `Bu hedef bloğu YENİDEN YAZMA. Sadece bu bilgileri anlatan, bu bloğun altına eklenecek YENİ BİR metin üret. DİKKAT: Hedef blok bir tablo ise yeni bir tablo satırı, bir liste ise yeni bir liste maddesi, bir hikaye/senaryo ise senaryonun devamı niteliğinde, akademik bir metinse akademik bir paragraf üret. Sadece YENİ EKLENECEK markdown metnini ver.${succeedingBlockText ? " Ürettiğin yeni metin, hem kendisinden önceki HEDEF BLOK ile hem de kendisinden sonra gelen HEDEFTEN HEMEN SONRA GELEN BLOK ile dilsel, anlamsal ve akış olarak kusursuz bir köprü oluşturmalıdır." : ""}` 
  : "Bu hedef blokta çelişkili veya yanlış bir bilgi var. Bu bloğu DÜZELTEREK baştan yaz. Sadece düzeltilmiş bloğu (markdown) ver. Ekstra bir şey yazma."}

🚨 GİZLİLİK KURALI (STEALTH MODE): Eklediğin veya değiştirdiğin metnin başına ASLA "Ayrıca", "Ek olarak", "Bunun yanı sıra", "Belirtmek gerekir ki", "Özetle", "Not:" gibi yapay geçiş kelimeleri KOYMA. Önceki metnin %100 organik bir parçası gibi davran, sonradan yama yapıldığını ASLA belli etme. Üslup, format ve tonlama hedef blokla BİREBİR aynı olmalıdır.

⚠️ GEÇİCİ TEST KURALI: Eklediğin veya değiştirdiğin tüm metinleri MUTLAKA <span style="color: #22c55e; font-weight: bold;">...</span> etiketleri arasına alarak yeşil renkli yap.

SADECE MARKDOWN KODUNU DÖNDÜR. (Başına ve sonuna json vs yazma).`;

    try {
      const newModule = await callAI(writerPrompt, 1, "notes_generation");
      const generatedAst: any = remark().parse(newModule.trim());
      const generatedNodes = generatedAst.children || [];

      if (action === 'insert_after') {
        // targetId'nin hemen sonrasına ekle
        newChildren.splice(targetId + 1, 0, ...generatedNodes);
        console.log(`[PATCH_ENGINE] ✅ [ID:${targetId}] sonrasına enjeksiyon başarılı.`);
      } else if (action === 'replace') {
        // targetId ile değiştir
        newChildren.splice(targetId, 1, ...generatedNodes);
        console.log(`[PATCH_ENGINE] ✅ [ID:${targetId}] değişimi başarılı.`);
      }

    } catch (err) {
      console.log(`[PATCH_ENGINE] ❌ [ID:${targetId}] operasyonu başarısız:`, err);
      stillFailedFacts.push(...facts);
    }
  }

  // Sonuç ağacını tekrar string'e çevir
  ast.children = newChildren;
  const finalMarkdown = remark().stringify(ast);
  
  const success = stillFailedFacts.length === 0;
  return { success, newMarkdown: finalMarkdown, failedFacts: stillFailedFacts };
}

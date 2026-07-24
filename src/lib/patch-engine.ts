import { remark } from 'remark';
import { callAI, extractCleanJson } from './ai-service';

export interface PatchResult {
  success: boolean;
  partialSuccess: boolean;
  successRatio: number;
  patchedCount: number;
  newMarkdown: string;
  failedFacts: string[];
}

export async function generateAndInjectPatch(
  markdownContent: string,
  missingFacts: string[],
  fullCourseName: string,
  rawContent: string,
  sectionTitle: string
): Promise<PatchResult> {
  console.log(`[PATCH_ENGINE] 🚀 AST Enjeksiyon Motoru başlatılıyor. Toplam eksik: ${missingFacts.length}`);

  if (missingFacts.length === 0) {
    return { success: true, partialSuccess: true, successRatio: 1, patchedCount: 0, newMarkdown: markdownContent, failedFacts: [] };
  }

  // 1. Markdown'u AST'ye çevir
  const ast: any = remark().parse(markdownContent);
  const children = ast.children || [];

  if (children.length === 0) {
    console.log(`[PATCH_ENGINE] ⚠️ Belge boş. Fallback iptal.`);
    return { success: false, partialSuccess: false, successRatio: 0, patchedCount: 0, newMarkdown: markdownContent, failedFacts: missingFacts };
  }

  // 2. Blok Numaralandırma (Indexleme)
  const blockList = children.map((node: any, idx: number) => {
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
- Bilgi mevcut hiçbir bloğa doğrudan ait değilse (notta o konu hiç işlenmemişse), "new_section" seç ve bu bilginin EN YAKIN olduğu bloğun ID'sini targetBlockId olarak ver. Yeni içerik o bloğun sonrasına eklenecektir.

NUMARALANDIRILMIŞ BELGE İSKELETİ:
${numberedBlocksText}

EKSİK/HATALI BİLGİLER:
${missingFacts.map((f, i) => `[F${i}] ${f}`).join('\n')}

SADECE şu JSON formatında cevap ver:
{
  "routing": [
    { "factId": "F0", "action": "insert_after", "targetBlockId": 2 },
    { "factId": "F1", "action": "replace", "targetBlockId": 5 },
    { "factId": "F2", "action": "new_section", "targetBlockId": 8 }
  ]
}
Dikkat: targetBlockId belge içindeki geçerli bir ID olmalıdır.
`;

  let routing: { factId: string; action: string; targetBlockId: number }[] = [];
  try {
    // BULGU 4: API deneme sayısı 1 -> 3 yükseltildi
    const finderRaw = await callAI(finderPrompt, 3, "cerrahi_yama");
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
        return { success: true, partialSuccess: true, successRatio: 1, patchedCount: missingFacts.length, newMarkdown: fallbackResult, failedFacts: [] };
      }
    } catch (fallbackErr) {
      console.log(`[PATCH_ENGINE] ❌ Fallback yama da başarısız:`, fallbackErr);
    }
    return { success: false, partialSuccess: false, successRatio: 0, patchedCount: 0, newMarkdown: markdownContent, failedFacts: missingFacts };
  }

  const stillFailedFacts: string[] = [];

  // BULGU 2: Yönlendirilen bilgileri takip et, evsiz kalanları tespit et
  const routedFactIndices = new Set<number>();
  const targetOps = new Map<number, { replaceFacts: string[]; insertAfterFacts: string[] }>();

  for (const route of routing) {
    const factIndex = parseInt(route.factId.replace('F', ''));
    if (isNaN(factIndex) || factIndex < 0 || factIndex >= missingFacts.length) continue;
    if (route.targetBlockId < 0 || route.targetBlockId >= children.length) {
      console.warn(`[PATCH_ENGINE] ⚠️ F${factIndex} için geçersiz blok ID (${route.targetBlockId})`);
      continue;
    }

    routedFactIndices.add(factIndex);
    const factText = missingFacts[factIndex];
    if (!targetOps.has(route.targetBlockId)) {
      targetOps.set(route.targetBlockId, { replaceFacts: [], insertAfterFacts: [] });
    }

    const op = targetOps.get(route.targetBlockId)!;
    if (route.action === 'replace') {
      op.replaceFacts.push(factText);
    } else { // insert_after or new_section
      op.insertAfterFacts.push(factText);
    }
  }

  // BULGU 2: Hiç yönlendirilmemiş evsiz bilgileri tespit et ve kayda geçir
  missingFacts.forEach((fact, idx) => {
    if (!routedFactIndices.has(idx)) {
      console.warn(`[PATCH_ENGINE] ⚠️ EVSİZ BİLGİ (F${idx}): Hiçbir bloğa yönlendirilemedi.`);
      stillFailedFacts.push(fact);
    }
  });

  console.log(`[PATCH_ENGINE] 📦 Hedef bloklar gruplandı. Yönlendirilen Blok Sayısı: ${targetOps.size}, Evsiz Bilgi: ${stillFailedFacts.length}`);

  let newChildren = [...children];
  const sortedTargetIds = Array.from(targetOps.keys()).sort((a, b) => b - a);

  // BULGU 3: Üslup parmak izi (notun genel sesini gösteren 2 örnek paragraf)
  const styleSample = blockList
    .filter((b: any) => b.type === 'paragraph' && b.text.length > 80)
    .slice(0, 2)
    .map((b: any) => b.text)
    .join('\n\n');

  // BULGU 3: Kaynak alıntısı (rawContent içerisinden ilk 3000 karakter)
  const sourceExcerpt = rawContent ? rawContent.slice(0, 3000) : "";

  for (const targetId of sortedTargetIds) {
    const ops = targetOps.get(targetId)!;
    const targetBlockText = blockList[targetId].text;
    const precedingBlockText = blockList[targetId - 1]?.text || undefined;
    const succeedingBlockText = blockList[targetId + 1]?.text || undefined;

    let replacementLength = 1;

    // 1. Önce REPLACE (Varsa)
    if (ops.replaceFacts.length > 0) {
      console.log(`[PATCH_ENGINE] 🛠️ REPLACE Operasyonu: ID=${targetId}, Fact Sayısı=${ops.replaceFacts.length}`);

      let writerPrompt = `[LOG_CONTEXT: ${fullCourseName} > ${sectionTitle}]
Sen bir Cerrahi Yama Yazarı (Micro-Writer) ajanısın. Görevin bir Markdown bloğuna noktasal müdahale yapmaktır.
Sana bir hedef blok verilecek ve bazı eksik/hatalı bilgiler verilecek.

HEDEF BLOK:
${targetBlockText}
`;

      if (precedingBlockText) {
        writerPrompt += `\nHEDEFTEN HEMEN ÖNCEKİ BLOK (BAĞLAM):\n${precedingBlockText}\n`;
      }
      if (succeedingBlockText) {
        writerPrompt += `\nHEDEFTEN HEMEN SONRA GELEN BLOK (BAĞLAM):\n${succeedingBlockText}\n`;
      }
      if (sourceExcerpt) {
        writerPrompt += `\nKAYNAK METİN (bilginin aslı — burada yazılanlara sadık kal, kendi bilginden uydurma):\n${sourceExcerpt}\n`;
      }
      if (styleSample) {
        writerPrompt += `\nNOTUN ÜSLUP ÖRNEĞİ (bu sesle yaz — cümle uzunluğu, terim tercihi, tonlama):\n${styleSample}\n\n⚠️ Yazdığın metin bu üslup örneğiyle aynı ağızdan çıkmış gibi olmalı. Farklı terim kullanma (notta "kuruluş" diyorsa sen de "kuruluş" de), cümle uzunluğunu ve teknik yoğunluğu eşleştir.\n`;
      }

      writerPrompt += `
EKSİK/HATALI BİLGİLER:
${ops.replaceFacts.join('\n')}

GÖREV:
Bu hedef blokta çelişkili veya yanlış bir bilgi var. Bu bloğu DÜZELTEREK baştan yaz. Sadece düzeltilmiş bloğu (markdown) ver. Ekstra bir şey yazma.

🚨 GİZLİLİK KURALI (STEALTH MODE): Eklediğin veya değiştirdiğin metnin başına ASLA "Ayrıca", "Ek olarak", "Bunun yanı sıra", "Belirtmek gerekir ki", "Özetle", "Not:" gibi yapay geçiş kelimeleri KOYMA. Önceki metnin %100 organik bir parçası gibi davran, sonradan yama yapıldığını ASLA belli etme. Üslup, format ve tonlama hedef blokla BİREBİR aynı olmalıdır.

📐 FORMAT SADAKATİ: Hedef blok bir tablo satırıysa yeni içerik de tablo satırı formatında olmalı; hedef blok "💡 Somut Benzetme:" ile başlıyorsa eklenen metin de sadece kavramsal olmalı, KESİNLİKLE sayısal süre/limit/oran içermemeli (sayılar sadece tablo/madde formatındaki bloklara eklenebilir).

SADECE MARKDOWN KODUNU DÖNDÜR. (Başına ve sonuna json vs yazma).`;

      try {
        // BULGU 4: API deneme sayısı 1 -> 3 yükseltildi
        const newModule = await callAI(writerPrompt, 3, "notes_generation");
        const generatedAst: any = remark().parse(newModule.trim());
        const generatedNodes = generatedAst.children || [];

        newChildren.splice(targetId, 1, ...generatedNodes);
        replacementLength = generatedNodes.length;
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

      if (precedingBlockText) {
        writerPrompt += `\nHEDEFTEN HEMEN ÖNCEKİ BLOK (BAĞLAM):\n${precedingBlockText}\n`;
      }
      if (succeedingBlockText) {
        writerPrompt += `\nHEDEFTEN HEMEN SONRA GELEN BLOK (BAĞLAM):\n${succeedingBlockText}\n`;
      }
      if (sourceExcerpt) {
        writerPrompt += `\nKAYNAK METİN (bilginin aslı — burada yazılanlara sadık kal, kendi bilginden uydurma):\n${sourceExcerpt}\n`;
      }
      if (styleSample) {
        writerPrompt += `\nNOTUN ÜSLUP ÖRNEĞİ (bu sesle yaz — cümle uzunluğu, terim tercihi, tonlama):\n${styleSample}\n\n⚠️ Yazdığın metin bu üslup örneğiyle aynı ağızdan çıkmış gibi olmalı. Farklı terim kullanma (notta "kuruluş" diyorsa sen de "kuruluş" de), cümle uzunluğunu ve teknik yoğunluğu eşleştir.\n`;
      }

      writerPrompt += `
EKSİK/HATALI BİLGİLER:
${ops.insertAfterFacts.join('\n')}

GÖREV:
Bu hedef bloğu YENİDEN YAZMA. Sadece bu bilgileri anlatan, bu bloğun altına eklenecek YENİ BİR metin üret. DİKKAT: Hedef blok bir tablo ise yeni bir tablo satırı, bir liste ise yeni bir liste maddesi, bir hikaye/senaryo ise senaryonun devamı niteliğinde, akademik bir metinse akademik bir paragraf üret. Sadece YENİ EKLENECEK markdown metnini ver.

🚨 GİZLİLİK KURALI (STEALTH MODE): Eklediğin veya değiştirdiğin metnin başına ASLA "Ayrıca", "Ek olarak", "Bunun yanı sıra", "Belirtmek gerekir ki", "Özetle", "Not:" gibi yapay geçiş kelimeleri KOYMA. Önceki metnin %100 organik bir parçası gibi davran, sonradan yama yapıldığını ASLA belli etme. Üslup, format ve tonlama hedef blokla BİREBİR aynı olmalıdır.

📐 FORMAT SADAKATİ: Hedef blok bir tablo satırıysa yeni içerik de tablo satırı formatında olmalı; hedef blok "💡 Somut Benzetme:" ile başlıyorsa eklenen metin de sadece kavramsal olmalı, KESİNLİKLE sayısal süre/limit/oran içermemeli (sayılar sadece tablo/madde formatındaki bloklara eklenebilir).

SADECE MARKDOWN KODUNU DÖNDÜR. (Başına ve sonuna json vs yazma).`;

      try {
        // BULGU 4: API deneme sayısı 1 -> 3 yükseltildi
        const newModule = await callAI(writerPrompt, 3, "notes_generation");
        const generatedAst: any = remark().parse(newModule.trim());
        const generatedNodes = generatedAst.children || [];

        const insertPos = targetId + replacementLength;
        newChildren.splice(insertPos, 0, ...generatedNodes);
        console.log(`[PATCH_ENGINE] ✅ [ID:${targetId}] sonrasına enjeksiyon (INSERT_AFTER) başarılı.`);
      } catch (err) {
        console.log(`[PATCH_ENGINE] ❌ [ID:${targetId}] INSERT_AFTER operasyonu başarısız:`, err);
        stillFailedFacts.push(...ops.insertAfterFacts);
      }
    }
  }

  ast.children = newChildren;
  const finalMarkdown = remark().stringify(ast);

  // BULGU 1: Kısmi başarı hesaplama
  const patchedCount = missingFacts.length - stillFailedFacts.length;
  const successRatio = missingFacts.length > 0 ? patchedCount / missingFacts.length : 1;

  return {
    success: stillFailedFacts.length === 0,
    partialSuccess: successRatio >= 0.5,
    successRatio,
    patchedCount,
    newMarkdown: finalMarkdown,
    failedFacts: stillFailedFacts,
  };
}

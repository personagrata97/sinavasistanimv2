"use client"

import React, { useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeRaw from "rehype-raw"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import dynamic from "next/dynamic"

const MermaidDiagram = dynamic(() => import("@/components/MermaidDiagram"), { ssr: false })

const MemoizedMarkdown = React.memo(({ content, wrapTooltip }: { content: string, wrapTooltip: (c: React.ReactNode) => React.ReactNode }) => {
  return (
    <ReactMarkdown 
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, rehypeKatex]}
      components={{
        h1: ({children}) => <h1 className="text-xl font-bold text-sky-300 mt-6 mb-3 border-b border-sky-900/30 pb-2">{wrapTooltip(children)}</h1>,
        h2: ({children}) => <h2 className="text-lg font-bold text-sky-300 mt-5 mb-2 flex items-center gap-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>{wrapTooltip(children)}</h2>,
        h3: ({children}) => <h3 className="text-base font-semibold text-sky-200 mt-4 mb-2 flex items-center gap-1.5"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 text-sky-400 shrink-0"><polyline points="9 18 15 12 9 6" /></svg>{wrapTooltip(children)}</h3>,
        p: ({children}) => <p className="text-slate-300 leading-relaxed mb-3">{wrapTooltip(children)}</p>,
        strong: ({children}) => <strong className="text-amber-300 font-semibold">{wrapTooltip(children)}</strong>,
        em: ({children}) => <em className="text-sky-200 italic">{wrapTooltip(children)}</em>,
        ul: ({children}) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
        ol: ({children}) => <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>,
        li: ({children}) => <li className="text-slate-300">{wrapTooltip(children)}</li>,
        table: ({children}) => <div className="overflow-x-auto my-4"><table className="w-full border-collapse border border-slate-600 rounded-lg text-sm">{children}</table></div>,
        thead: ({children}) => <thead className="bg-slate-700/60">{children}</thead>,
        th: ({children}) => <th className="text-sky-300 font-semibold p-3 text-left border border-slate-600">{wrapTooltip(children)}</th>,
        td: ({children}) => <td className="text-slate-300 p-3 border border-slate-600">{wrapTooltip(children)}</td>,
        code: ({className, children}) => {
          const match = /language-mermaid/.exec(className || '')
          if (match) {
            return <MermaidDiagram chart={String(children).replace(/\\n$/, '')} />
          }
          return <code className="text-emerald-300 bg-slate-800/80 px-1.5 py-0.5 rounded text-xs">{children}</code>
        },
        pre: ({children}) => <>{children}</>,
        blockquote: ({children}) => <blockquote className="border-l-4 border-amber-500/50 pl-4 my-3 italic text-amber-200/80">{wrapTooltip(children)}</blockquote>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}, (prev, next) => prev.content === next.content)

export function PremiumMarkdownRenderer({ 
  content, 
  renderTooltips,
  searchTerm,
  autoScrollKeyword,
  activeMatchIndex = 0,
  onMatchCountChange
}: { 
  content: string, 
  renderTooltips?: (children: React.ReactNode) => React.ReactNode,
  searchTerm?: string,
  autoScrollKeyword?: string,
  activeMatchIndex?: number,
  onMatchCountChange?: (count: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll and highlight logic
  useEffect(() => {
    if (!containerRef.current) return;
    
    // 1. Temizlik (Önceki highlight'ları sil)
    const oldMarks = containerRef.current.querySelectorAll('.search-highlight');
    oldMarks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });

    // 2. Eğer "İlgili Konuya Git" (autoScrollKeyword) çalıştırıldıysa:
    if (autoScrollKeyword && !searchTerm) {
      // Ana metinlere odaklan, blockquote (hikaye/örnek) kısımlarını aramadan dışla
      const elementsList = Array.from(containerRef.current.querySelectorAll('h1, h2, h3, h4, p, li, td, th')) as HTMLElement[];
      let searchScope = elementsList;
      let scopeStartElement: HTMLElement | null = null;
      let bestMatch: HTMLElement | null = null;
      let maxScore = 0;

      // ✨ YENİ: KAPSAM KİLİTLİ HİBRİT ARAMA (SCOPE-LOCKED HYBRID SEARCH) ✨
      // 1. Adım: Yapay zekanın eklediği [KAYNAK BAŞLIĞI: Başlık Adı] etiketini yakala
      const sourceMatch = autoScrollKeyword.match(/\[KAYNAK BAŞLIĞI:\s*(.*?)\]/i);
      if (sourceMatch && sourceMatch[1]) {
         const exactHeadingText = sourceMatch[1].trim().toLowerCase();
         for (let i = 0; i < searchScope.length; i++) {
            const el = searchScope[i];
            if (el.tagName.match(/^H[1-6]$/)) {
               const text = (el.textContent || '').toLowerCase().trim();
               if (text === exactHeadingText || text.includes(exactHeadingText) || exactHeadingText.includes(text)) {
                  scopeStartElement = el;
                  
                  // Kapsamı (Scope) bu başlık ile sonraki aynı veya üst düzey başlık arasına kilitle
                  const currentLevel = parseInt(el.tagName[1]);
                  const newScope: HTMLElement[] = [el]; // Aramaya başlığın kendisini de dahil et
                  
                  for (let j = i + 1; j < searchScope.length; j++) {
                     const nextEl = searchScope[j];
                     if (nextEl.tagName.match(/^H[1-6]$/)) {
                        const nextLevel = parseInt(nextEl.tagName[1]);
                        if (nextLevel <= currentLevel) {
                           break; // Sonraki ana/eşdeğer başlığa geldik, kapsam bitti
                        }
                     }
                     newScope.push(nextEl);
                  }
                  
                  searchScope = newScope; // Arama uzayını daralttık!
                  break; 
               }
            }
         }
      }

      // 2. Adım: Arama kelimelerini hazırla
      const stopWords = ['aşağıdakilerden', 'hangisi', 'yanlıştır', 'doğrudur', 'kaynak', 'metne', 'metin', 'metinde', 'metinden', 'göre', 'hangisidir', 'hangileri', 'ilgili', 'nedir', 'değildir', 'olamaz', 'olabilir', 'hakkında', '[kaynak', 'başlığı:'];
      const keywordTokens = autoScrollKeyword.toLowerCase().replace(/\[kaynak başlığı:.*?\]/g, '').split(/[\s,.'"-]+/).filter(w => w.length >= 3 && !stopWords.includes(w) && w !== 'ile' && w !== 'ise' && w !== 'ama');

      // 3. Adım: Kilitlenmiş Kapsamda (veya tüm dokümanda) Bulanık Arama (Fuzzy Search)
      for (let i = 0; i < searchScope.length; i++) {
        const el = searchScope[i];
        const text = (el.textContent || '').toLowerCase();
        let score = 0;
        const cleanElText = text.trim();
        
        // Tablo ve Başlıklar için tam eşleşme bonusu
        if ((el.tagName === 'TD' || el.tagName === 'TH' || el.tagName.match(/^H[1-6]$/)) && cleanElText.length >= 3) {
            const escapedCleanEl = cleanElText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const exactMatchRegex = new RegExp(`\\b${escapedCleanEl}\\b`, 'i');
            if (exactMatchRegex.test(autoScrollKeyword)) {
                score += 1000 + (cleanElText.length * 10); 
            }
        }
        
        // Kelime kökü bazlı puanlama
        keywordTokens.forEach(token => {
           if (token.length < 3 && !text.includes(token)) return;
           const root = token.length > 5 ? token.substring(0, 5) : token;
           if (text.includes(root)) {
             score += token.length;
             // Tablo hücrelerine ve başlıklara bonus
             if (el.tagName === 'TD' || el.tagName === 'TH' || el.tagName.match(/^H[1-6]$/)) {
               score += token.length * 2; 
             }
             
             // ✨ VURGULU (STRONG/B) KELİME BONUSU ✨
             const strongElements = el.querySelectorAll('strong, b');
             for (let j = 0; j < strongElements.length; j++) {
               if ((strongElements[j].textContent || '').toLowerCase().includes(root)) {
                 score += token.length * 15; // Dev bonus
                 break;
               }
             }
           }
        });
        
        // En yüksek puanı kaydediyoruz (eşleşme için en az 4 puan lazım)
        if (score > maxScore && score >= 4) {
           maxScore = score;
           bestMatch = el;
        }
      }

      // Eğer kapsam kilitlendiği halde (veya genel aramada) yüksek puanlı eşleşme bulunamadıysa, 
      // kapsam başlığını (scopeStartElement) varsayılan olarak kabul et!
      if (!bestMatch && scopeStartElement) {
         bestMatch = scopeStartElement;
      }

      // Eğer hiç eşleşme bulamadıysa, biraz daha toleranslı arayalım (en az 1 kelime kökü)
      if (!bestMatch) {
         for (let i = 0; i < elementsList.length; i++) {
            const el = elementsList[i];
            const text = (el.textContent || '').toLowerCase();
            let score = 0;
            keywordTokens.forEach(token => {
               const root = token.length > 4 ? token.substring(0, 4) : token;
               if (text.includes(root)) score++;
            });
            if (score > maxScore && score >= 1) {
               maxScore = score;
               bestMatch = el;
            }
         }
      }

      // 🚨 KESİN GARANTİ: Eğer hala hiçbir şey bulamadıysa (ki imkansız gibi bir şey), en azından ilk paragrafı seçsin!
      if (!bestMatch && elementsList.length > 0) {
         bestMatch = elementsList[0];
      }

      // Çıkan sonucu tam olarak o satırda göster (üst başlığa gitme)
      if (bestMatch) {
         let scrollTarget = bestMatch as HTMLElement;

         // Framer Motion tam 400ms sürüyor.
         setTimeout(() => {
           const scrollParent = containerRef.current?.closest('.overflow-y-auto') as HTMLElement;
           if (scrollParent) {
              setTimeout(() => {
                 const parentRect = scrollParent.getBoundingClientRect();
                 const elRect = scrollTarget.getBoundingClientRect();
                 const relativeTop = elRect.top - parentRect.top;
                 const targetTop = scrollParent.scrollTop + relativeTop - (parentRect.height / 3); // Ekranda ortalamaya yakın bir yerde tut
                 scrollParent.scrollTo({ top: targetTop, behavior: 'smooth' });
              }, 300);
           } else {
              scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
           }
           
           const elementToHighlight = scrollTarget || bestMatch;
           const originalBg = elementToHighlight.style.backgroundColor;
           const originalTransition = elementToHighlight.style.transition;
           elementToHighlight.style.transition = 'background-color 0.5s ease';
           elementToHighlight.style.backgroundColor = 'rgba(245, 158, 11, 0.4)'; // Biraz daha yumuşak sarı
           elementToHighlight.style.borderRadius = '4px';
           // Fade to a permanent light yellow instead of disappearing completely
           setTimeout(() => {
              elementToHighlight.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'; 
              elementToHighlight.style.borderLeft = '4px solid rgba(245, 158, 11, 0.6)';
              elementToHighlight.style.paddingLeft = '8px';
              // Don't reset transition so it stays highlighted
           }, 3500);
         }, 500);
      }

      if (onMatchCountChange) onMatchCountChange(0);
      return; 
    }

    // 3. Eğer kullanıcı Arama Kutusuna (searchTerm) bir şey yazdıysa:
    if (!searchTerm || searchTerm.length < 2) {
       if (onMatchCountChange) onMatchCountChange(0);
       return;
    }

    const escapedSearch = searchTerm.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
    const regex = new RegExp(`(${escapedSearch})`, 'i');
    
    const nodesToReplace: { node: Node, parent: Node, match: RegExpMatchArray }[] = [];
    
    // Tüm metin nodelarını bul
    const walk = document.createTreeWalker(containerRef.current, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walk.nextNode())) {
      if (node.nodeValue && regex.test(node.nodeValue)) {
        const parent = node.parentNode as HTMLElement;
        if (parent && parent.nodeName !== 'MARK' && parent.nodeName !== 'CODE' && parent.nodeName !== 'PRE') {
           nodesToReplace.push({ node, parent, match: node.nodeValue.match(regex)! });
        }
      }
    }

    let matchCounter = 0;
    let activeElement: HTMLElement | null = null;

    // Metinleri <mark> içine al ve aktif olanı farklı renklendir
    nodesToReplace.forEach(({ node, parent }) => {
      try {
         const parts = node.nodeValue!.split(regex);
         const fragment = document.createDocumentFragment();
         
         parts.forEach((part, i) => {
            if (i % 2 === 1) { 
               // Eşleşen kelime
               const isCurrentActive = matchCounter === activeMatchIndex;
               const mark = document.createElement('mark');
               mark.className = 'search-highlight px-1 rounded transition-colors';
               mark.style.backgroundColor = isCurrentActive ? '#2563eb' : 'rgba(245, 158, 11, 0.3)'; 
               mark.style.color = isCurrentActive ? '#ffffff' : 'inherit';
               mark.style.boxShadow = isCurrentActive ? '0 0 0 2px rgba(37, 99, 235, 0.5)' : 'none';
               
               mark.textContent = part;
               fragment.appendChild(mark);
               
               if (isCurrentActive) activeElement = mark;
               matchCounter++;
            } else if (part) {
               fragment.appendChild(document.createTextNode(part));
            }
         });
         parent.replaceChild(fragment, node);
      } catch (e) {}
    });

    if (onMatchCountChange) onMatchCountChange(matchCounter);

    // Aktif eşleşmeye kaydır
    if (activeElement) {
       setTimeout(() => {
         const scrollParent = containerRef.current?.closest('.overflow-y-auto') as HTMLElement;
         if (scrollParent) {
            const parentRect = scrollParent.getBoundingClientRect();
            const elRect = (activeElement as HTMLElement).getBoundingClientRect();
            const relativeTop = elRect.top - parentRect.top;
            scrollParent.scrollTo({ top: scrollParent.scrollTop + relativeTop - parentRect.height / 2, behavior: 'smooth' });
         } else {
            (activeElement as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
         }
       }, 50);
    }
  }, [content, searchTerm, autoScrollKeyword, activeMatchIndex, onMatchCountChange]);

  const wrapTooltip = (children: React.ReactNode) => {
    return renderTooltips ? renderTooltips(children) : children;
  };

  return (
    <div ref={containerRef} className="text-sm text-slate-300 leading-relaxed markdown-notes">
       <MemoizedMarkdown content={content} wrapTooltip={wrapTooltip} />
    </div>
  )
}

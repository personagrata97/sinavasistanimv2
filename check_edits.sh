#!/bin/bash
echo "EKSİKLERİ BULMA RAPORU" > eksik_rapor.md

check_pattern() {
  local desc="$1"
  local pattern="$2"
  if grep -q "$pattern" src/app/api/courses/process/route.ts; then
    echo "✅ BULUNDU: $desc" >> eksik_rapor.md
  else
    echo "❌ KAYIP: $desc" >> eksik_rapor.md
  fi
}

check_pattern "BestNotes kalkanı (08:57)" "KALKAN DEVREDE"
check_pattern "suspiciousRegex Kaçak Kapı (09:36)" "suspiciousRegex ="
check_pattern "Restore lastVerification (09:50)" "restoredVerification ="
check_pattern "Smart Inject Deneme 1 (09:51)" "if (lastVerification) {"
check_pattern "Preserve attemptHistory (10:09)" "attemptHistory: attemptHistory"
check_pattern "Save attemptHistory when 100 (10:09)" "100 puan alındı ve onaylandı"
check_pattern "isNewBest move (11:54)" "let isNewBest = false;"
check_pattern "Race condition fix (14:27)" "activeProcesses.has(slug)"
check_pattern "Kaçak kapı positive feedback (15:43)" "tamamlanmış|giderilmiş|olumlu|düzeltilmiş"
check_pattern "verifyNotesAgainstSource param (18:09)" "verifyNotesAgainstSource("
check_pattern "pdfPath null check (18:10)" "course.pdfPath"
check_pattern "fullCourseName (18:11)" "SPL Düzey"
check_pattern "bypass bug empty audit (18:26)" "Konu çıkarılamadı"

cat eksik_rapor.md

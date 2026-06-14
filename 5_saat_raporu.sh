#!/bin/bash
echo "# SON 5 SAATTEKİ TÜM TALEPLERİNİZİN LİSTESİ" > rapor_5_saat.md
echo "Aşağıdaki liste, tam olarak son 5 saat içinde (Yerel saatinizle 16:58'den şu ana kadar) bana verdiğiniz tüm yazılı emirlerin saat sırasına göre dökümüdür.\n\n" >> rapor_5_saat.md

jq -r 'select(.type == "USER_INPUT") | "* **Saat " + (.created_at | gsub("Z"; " UTC")) + "** - " + (.content | gsub("\n"; " ") | gsub("<EPHEMERAL_MESSAGE>.*";""))' /Users/selimkaya/.gemini/antigravity-ide/brain/d87558fa-9960-4390-9346-afcd6072496d/.system_generated/logs/transcript.jsonl | grep "2026-06-12T1[3456]:" | tail -n 25 >> rapor_5_saat.md

jq -r 'select(.type == "USER_INPUT") | "* **Saat " + (.created_at | gsub("Z"; " UTC")) + "** - " + (.content | gsub("\n"; " ") | gsub("<EPHEMERAL_MESSAGE>.*";""))' /Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl | head -n 1 >> rapor_5_saat.md

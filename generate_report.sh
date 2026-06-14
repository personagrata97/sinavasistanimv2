#!/bin/bash
echo "# 6 Saatlik Tam Kod Değişikliği Denetimi" > eksik_rapor.md
echo "Selim Bey, isteğiniz üzerine son 6 saattir yaptığım TÜM kod değişikliklerini tek tek listeledim ve şu an kodda olup olmadıklarını kontrol ettim." >> eksik_rapor.md
echo "" >> eksik_rapor.md
echo "## route.ts Dosyasındaki Tüm Yamalar:" >> eksik_rapor.md

jq -r 'select(.type == "PLANNER_RESPONSE" and .tool_calls != null) | .created_at as $time | .tool_calls[] | select(.name == "multi_replace_file_content" or .name == "replace_file_content") | select(.args.TargetFile | contains("route.ts")) | "- [" + $time + "] " + .args.Description' /Users/selimkaya/.gemini/antigravity-ide/brain/d87558fa-9960-4390-9346-afcd6072496d/.system_generated/logs/transcript.jsonl /Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl | sort | uniq >> eksik_rapor.md

echo "" >> eksik_rapor.md
echo "## ai-service.ts Dosyasındaki Tüm Yamalar:" >> eksik_rapor.md
jq -r 'select(.type == "PLANNER_RESPONSE" and .tool_calls != null) | .created_at as $time | .tool_calls[] | select(.name == "multi_replace_file_content" or .name == "replace_file_content") | select(.args.TargetFile | contains("ai-service.ts")) | "- [" + $time + "] " + .args.Description' /Users/selimkaya/.gemini/antigravity-ide/brain/d87558fa-9960-4390-9346-afcd6072496d/.system_generated/logs/transcript.jsonl /Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl | sort | uniq >> eksik_rapor.md

echo "" >> eksik_rapor.md
echo "## AdminClient.tsx Dosyasındaki Tüm Yamalar:" >> eksik_rapor.md
jq -r 'select(.type == "PLANNER_RESPONSE" and .tool_calls != null) | .created_at as $time | .tool_calls[] | select(.name == "multi_replace_file_content" or .name == "replace_file_content") | select(.args.TargetFile | contains("AdminClient.tsx")) | "- [" + $time + "] " + .args.Description' /Users/selimkaya/.gemini/antigravity-ide/brain/d87558fa-9960-4390-9346-afcd6072496d/.system_generated/logs/transcript.jsonl /Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl | sort | uniq >> eksik_rapor.md

echo "" >> eksik_rapor.md
echo "## Diğer Dosyalardaki Yamalar (start-ai-generation.ts vb.):" >> eksik_rapor.md
jq -r 'select(.type == "PLANNER_RESPONSE" and .tool_calls != null) | .created_at as $time | .tool_calls[] | select(.name == "multi_replace_file_content" or .name == "replace_file_content") | select(.args.TargetFile | contains("route.ts") | not) | select(.args.TargetFile | contains("ai-service.ts") | not) | select(.args.TargetFile | contains("AdminClient.tsx") | not) | "- [" + $time + "] " + .args.TargetFile + " - " + .args.Description' /Users/selimkaya/.gemini/antigravity-ide/brain/d87558fa-9960-4390-9346-afcd6072496d/.system_generated/logs/transcript.jsonl /Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl | sort | uniq >> eksik_rapor.md


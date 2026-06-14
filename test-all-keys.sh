#!/bin/bash
keys=$(grep GEMINI_API_KEYS .env | cut -d '=' -f2)
IFS=',' read -r -a key_array <<< "$keys"
total=${#key_array[@]}
echo "Testing $total keys..."
for i in "${!key_array[@]}"; do
  key="${key_array[$i]}"
  echo -n "Key $((i+1)): "
  response=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$key" -H 'Content-Type: application/json' -X POST -d '{ "contents": [{ "parts":[{"text": "Hi"}] }] }')
  
  if echo "$response" | grep -q '"text"'; then
    echo "✅ VALID"
  elif echo "$response" | grep -q 'leaked'; then
    echo "❌ LEAKED (403)"
  elif echo "$response" | grep -q 'quota'; then
    echo "⚠️ QUOTA EXCEEDED (429)"
  elif echo "$response" | grep -q 'API key not valid'; then
    echo "🚫 INVALID KEY (400)"
  else
    error_msg=$(echo "$response" | grep -o '"message": "[^"]*"' | cut -d '"' -f 4)
    echo "❓ ERROR: $error_msg"
  fi
done

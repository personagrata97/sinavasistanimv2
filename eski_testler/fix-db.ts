import { prisma } from './src/lib/prisma'
import * as fs from 'fs'

async function main() {
  const content = fs.readFileSync('kisa.md', 'utf-8');
  const lines = content.split('\n');
  const dict: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^\*\s+\*\*([^:]+):\*\*\s+(.+)$/);
    if (match) {
      const abbr = match[1].trim();
      const meaning = match[2].trim();
      dict[abbr] = meaning;
    }
  }

  await prisma.course.update({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    data: {
      glossary: JSON.stringify(dict)
    }
  })
  console.log("Glossary updated!");
}

main().catch(console.error)

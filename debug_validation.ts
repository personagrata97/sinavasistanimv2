import { prisma } from "./src/lib/prisma"
import { detectSectionsSystematic } from "./src/lib/section-detector"
import { extractAllText } from "./src/lib/pdf-engine"
import fs from "fs"

async function run() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })
  if (!course) return;

  const absolutePdfPath = course.pdfPath;
  const fileContent = fs.readFileSync(absolutePdfPath)
  const pageTexts = await extractAllText(fileContent)
  
  const options = {
    geminiFileUri: course.geminiFileUri,
    geminiKeys: [process.env.GEMINI_API_KEYS?.split(",")[0] || ""],
    logCourseSlug: course.slug
  }
  
  const result = await detectSectionsSystematic(pageTexts, options)
  console.log("Sections:")
  console.log(JSON.stringify(result?.sections, null, 2))
}

run().catch(console.error).finally(() => prisma.$disconnect())

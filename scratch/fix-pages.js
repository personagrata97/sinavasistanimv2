const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const path = require("path");

const dbPath = path.resolve(process.cwd(), "dev.db");
const dbUrl = `file:${dbPath}`;
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const correctRanges = [
  { title: "Bilgi Güvenliği Yönetimi", start: 11, end: 20 },
  { title: "Varlık Yönetimi", start: 21, end: 25 },
  { title: "Fiziksel ve Çevresel Güvenlik", start: 26, end: 35 },
  { title: "Ağ Güvenliği", start: 36, end: 48 },
  { title: "Erişim Güvenliği", start: 49, end: 68 },
  { title: "Veri ve İz Kayıtlarının Güvenliği", start: 69, end: 102 },
  { title: "Üçüncü Taraflarla İletişim Güvenliği", start: 103, end: 118 }
];

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  });

  if (!course) {
    console.error("Course not found!");
    process.exit(1);
  }

  for (const range of correctRanges) {
    await prisma.section.updateMany({
      where: {
        courseId: course.id,
        title: range.title
      },
      data: {
        pageStart: range.start,
        pageEnd: range.end
      }
    });
    console.log(`Updated ${range.title} to pages ${range.start}-${range.end}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

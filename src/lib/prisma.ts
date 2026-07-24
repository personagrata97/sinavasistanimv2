import { PrismaClient } from "@prisma/client"
import path from "path"

// Adaptörü taze bir solukla içeri alıyoruz
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3")

// Veritabanı yolunu mutlak ve kesin olarak tanımlıyoruz
const dbPath = path.resolve(process.cwd(), "dev.db")
const dbUrl = `file:${dbPath}`

const globalForPrisma = globalThis as unknown as {
  prisma_v2: PrismaClient | undefined
}

// Singleton yapısını en yalın haline getiriyoruz
export const prisma =
  globalForPrisma.prisma_v2 ??
  (function() {
    console.log(">>> [STABLE] INITIALIZING PRISMA WITH URL:", dbUrl);
    
    // Adaptörün içindeki 'url.replace' hatasını engellemek için 
    // TAM OLARAK beklediği objeyi veriyoruz.
    const adapter = new PrismaBetterSqlite3({ 
      url: dbUrl 
    });
    
    const client = new PrismaClient({ adapter });

    // ✅ WAL MODU: Yazma sırasında okumaların bloklanmasını önler
    // ✅ BUSY_TIMEOUT: Kilit varsa hemen hata vermek yerine 5 sn bekler
    client.$executeRawUnsafe("PRAGMA journal_mode = WAL;").catch(() => {});
    client.$executeRawUnsafe("PRAGMA busy_timeout = 5000;").catch(() => {});
    client.$executeRawUnsafe("PRAGMA synchronous = NORMAL;").catch(() => {});

    return client;
  })();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma_v2 = prisma

import { prisma } from "./src/lib/prisma"

async function run() {
  const users = await prisma.user.findMany()
  console.log(`=== USERS IN DATABASE (${users.length}) ===`)
  for (const u of users) {
    console.log(`- Name: ${u.name} | Email: ${u.email} | Role: ${u.role}`)
    console.log(`  Password field exists: ${!!u.password}`)
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())

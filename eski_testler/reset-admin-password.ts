import { prisma } from "./src/lib/prisma"
import bcrypt from "bcryptjs"

async function run() {
  const email = "admin@admin.com"
  const newPassword = "123456"
  const hashedPassword = await bcrypt.hash(newPassword, 10)

  const updatedUser = await prisma.user.update({
    where: { email },
    data: { password: hashedPassword }
  })

  console.log(`✅ Password successfully reset for ${email}!`)
  console.log(`New password set to: ${newPassword}`)
}

run().catch(console.error).finally(() => prisma.$disconnect())

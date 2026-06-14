import { initializeCourses } from './src/lib/actions'

async function main() {
  await initializeCourses()
  console.log("Initialization complete.")
}

main().catch(console.error)

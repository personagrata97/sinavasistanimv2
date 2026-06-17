import {
  Shield,
  Scale,
  Brain,
  Award,
  ShieldCheck,
  ClipboardList,
  BookOpen,
  type LucideIcon,
} from "lucide-react"
import type { ProgramIconName } from "./program-catalog"

export const PROGRAM_ICON_MAP: Record<ProgramIconName, LucideIcon> = {
  Shield,
  Scale,
  Brain,
  Award,
  ShieldCheck,
  ClipboardList,
}

export function resolveProgramIcon(name: ProgramIconName | string | undefined): LucideIcon {
  if (name && name in PROGRAM_ICON_MAP) {
    return PROGRAM_ICON_MAP[name as ProgramIconName]
  }
  return BookOpen
}

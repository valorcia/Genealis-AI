import type { LucideIcon } from 'lucide-react'
import {
  Sparkles, Rocket, MessageCircleQuestion, Search, Bot, Archive, Landmark, BookMarked, LayoutDashboard, Pencil, Network, User, MapPin, Files, Image, HeartHandshake, NotebookPen, CircleCheck, Upload, Settings, Workflow, GitFork, Hourglass, GitBranch, ListTree, CircleDot, Split, BarChartHorizontal, BarChart3, GanttChart, Users, UsersRound, Orbit, Shapes, Eye, Box, Globe2, Map as MapIcon, MapPinned, HelpCircle, FileText, FileUser, CalendarDays, ListOrdered, Feather, Layers, Earth, MessageSquareQuote, CalendarCheck, Info, List, Contact, CalendarRange, Cake, Images, CircleDashed, TriangleAlert, Lightbulb, Globe, FileDown, GitBranchPlus, GitBranchMinus, BookOpen, DatabaseBackup, Star,
} from 'lucide-react'

/** Icônes référencées par nom dans sections.ts (liste explicite pour garder un paquet léger). */
export const ICONS: Record<string, LucideIcon> = {
  Sparkles, Rocket, MessageCircleQuestion, Search, Bot, Archive, Landmark, BookMarked, LayoutDashboard, Pencil, Network, User, MapPin, Files, Image, HeartHandshake, NotebookPen, CircleCheck, Upload, Settings, Workflow, GitFork, Hourglass, GitBranch, ListTree, CircleDot, Split, BarChartHorizontal, BarChart3, GanttChart, Users, UsersRound, Orbit, Shapes, Eye, Box, Globe2, Map: MapIcon, MapPinned, HelpCircle, FileText, FileUser, CalendarDays, ListOrdered, Feather, Layers, Earth, MessageSquareQuote, CalendarCheck, Info, List, Contact, CalendarRange, Cake, Images, CircleDashed, TriangleAlert, Lightbulb, Globe, FileDown, GitBranchPlus, GitBranchMinus, BookOpen, DatabaseBackup, Star,
}

export function NamedIcon({ name, size = 22, className, strokeWidth = 1.8 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  const I = ICONS[name] ?? Star
  return <I size={size} className={className} strokeWidth={strokeWidth} />
}

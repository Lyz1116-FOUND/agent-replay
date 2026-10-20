import type { ComponentType, SVGProps } from 'react'
import {
  Bot,
  Box,
  Brain,
  FileText,
  Flag,
  FlaskConical,
  GitCommitHorizontal,
  Globe,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react'
import type { SpanType } from '../schema/trace'

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string }

const SPAN_ICONS: Record<SpanType, ComponentType<IconProps>> = {
  agent: Bot,
  generation: Sparkles,
  reasoning: Brain,
  read: FileText,
  search: Search,
  edit: Pencil,
  shell: Terminal,
  test: FlaskConical,
  browser: Globe,
  tool: Wrench,
  unknown: Box,
  checkpoint: GitCommitHorizontal,
  final: Flag,
}

export function SpanIcon({
  type,
  size = 14,
  ...props
}: { type: SpanType; size?: number } & Omit<IconProps, 'size'>) {
  const Icon = SPAN_ICONS[type]
  return <Icon size={size} strokeWidth={1.75} {...props} />
}

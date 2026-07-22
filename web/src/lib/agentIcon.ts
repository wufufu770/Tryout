// v5:Agent 预设图标库(24 个 lucide 图标 + 配色)
// 图标 key 与 lucide-react 组件名对应,前端通过 key 动态渲染对应组件
import {
  User, Briefcase, Code, Crown, Shield, GraduationCap, Brain, Wrench,
  Cpu, Database, Cloud, Server, LineChart, Compass, Lightbulb, Target,
  Zap, Star, Heart, Smile, Bot, Cat, Bird, Bug,
} from "lucide-react";
import type { ComponentType } from "react";

export interface PresetIcon {
  key: string;
  label: string;
  Component: ComponentType<{ size?: number | string }>;
  color: string;
}

// 24 个预设图标,覆盖职业角色 + 学科 + 形象
export const PRESET_ICONS: PresetIcon[] = [
  { key: "User", label: "通用", Component: User, color: "#607D8B" },
  { key: "Briefcase", label: "职场", Component: Briefcase, color: "#4D6BFE" },
  { key: "Code", label: "程序员", Component: Code, color: "#10A37F" },
  { key: "Crown", label: "高管", Component: Crown, color: "#FF9800" },
  { key: "Shield", label: "安全", Component: Shield, color: "#F44336" },
  { key: "GraduationCap", label: "学术", Component: GraduationCap, color: "#9C27B0" },
  { key: "Brain", label: "思考", Component: Brain, color: "#E91E63" },
  { key: "Wrench", label: "工程", Component: Wrench, color: "#795548" },
  { key: "Cpu", label: "硬件", Component: Cpu, color: "#009688" },
  { key: "Database", label: "数据", Component: Database, color: "#3F51B5" },
  { key: "Cloud", label: "云原生", Component: Cloud, color: "#03A9F4" },
  { key: "Server", label: "运维", Component: Server, color: "#5C6BC0" },
  { key: "LineChart", label: "数据分析师", Component: LineChart, color: "#4CAF50" },
  { key: "Compass", label: "产品", Component: Compass, color: "#8BC34A" },
  { key: "Lightbulb", label: "创意", Component: Lightbulb, color: "#FFC107" },
  { key: "Target", label: "目标导向", Component: Target, color: "#FF5722" },
  { key: "Zap", label: "敏捷", Component: Zap, color: "#FFEB3B" },
  { key: "Star", label: "明星", Component: Star, color: "#FFC107" },
  { key: "Heart", label: "关怀", Component: Heart, color: "#E91E63" },
  { key: "Smile", label: "友善", Component: Smile, color: "#FFB74D" },
  { key: "Bot", label: "AI", Component: Bot, color: "#00BCD4" },
  { key: "Cat", label: "灵活", Component: Cat, color: "#AB47BC" },
  { key: "Bird", label: "自由", Component: Bird, color: "#26A69A" },
  { key: "Bug", label: "测试", Component: Bug, color: "#8D6E63" },
];

// 根据 key 获取图标定义
export function getPresetIcon(key?: string): PresetIcon | undefined {
  if (!key) return undefined;
  return PRESET_ICONS.find((i) => i.key === key);
}

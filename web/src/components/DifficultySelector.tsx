// 难度选择器
// 无圆角分段按钮 + 选中态左色条 + 等宽 + 悬浮显示星级和场景说明
import { useState } from "react";
import { cn, DIFFICULTY_LEVELS } from "@/shared";
import { useI18n } from "@/i18n";
import type { SessionDifficulty } from "@/types/session";
import { Leaf, CircleCheck, Flame, Zap, Skull, Star } from "lucide-react";

const ICON_MAP: Record<string, any> = {
  Leaf,
  CircleCheck,
  Flame,
  Zap,
  Skull,
};

interface DifficultySelectorProps {
  value: SessionDifficulty;
  onChange: (v: SessionDifficulty) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function DifficultySelector({ value, onChange, disabled, size = "md" }: DifficultySelectorProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState<string | null>(null);
  const current = DIFFICULTY_LEVELS.find((d) => d.value === value);
  const showInfo = hovered ? DIFFICULTY_LEVELS.find((d) => d.value === hovered) : current;
  const iconSize = size === "sm" ? 11 : 13;
  const padY = size === "sm" ? "py-0.5" : "py-1";
  // 难度等级 label/scenario/features 走 i18n:t() 在 key 不存在时返回 key 本身,所以用 !== 判断
  const labelOf = (d: { value: string; label: string }) => {
    const k = `difficulty.${d.value}.label`;
    const v = t(k);
    return v === k ? d.label : v;
  };
  const scenarioOf = (d: { value: string; scenario: string }) => {
    const k = `difficulty.${d.value}.scenario`;
    const v = t(k);
    return v === k ? d.scenario : v;
  };
  const featuresOf = (d: { value: string; features: string }) => {
    const k = `difficulty.${d.value}.features`;
    const v = t(k);
    return v === k ? d.features : v;
  };

  return (
    <div>
      <div className="flex border border-ide-border bg-ide-bg-alt">
        {DIFFICULTY_LEVELS.map((d, idx) => {
          const Icon = ICON_MAP[d.icon] || CircleCheck;
          const selected = value === d.value;
          return (
            <button
              key={d.value}
              onClick={() => !disabled && onChange(d.value as SessionDifficulty)}
              onMouseEnter={() => setHovered(d.value)}
              onMouseLeave={() => setHovered(null)}
              disabled={disabled}
              title={`${labelOf(d)} · ${scenarioOf(d)}`}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 px-1 transition-colors outline-none",
                padY,
                idx > 0 && "border-l border-ide-border",
                selected
                  ? "bg-ide-bg-active text-ide-fg"
                  : "text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg",
                disabled && "cursor-not-allowed opacity-60",
              )}
              style={selected ? { borderLeft: `2px solid ${d.color}` } : undefined}
            >
              <Icon size={iconSize} style={{ color: d.color }} />
              <span className="text-[11px]">{labelOf(d)}</span>
            </button>
          );
        })}
      </div>
      {showInfo && (
        <div
          className="mt-1 border-l-2 bg-ide-bg-alt px-2 py-1 text-[10px] text-ide-fg-muted"
          style={{ borderLeftColor: showInfo.color }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-ide-fg">{scenarioOf(showInfo)}</span>
            <span className="flex items-center gap-0.5" style={{ color: showInfo.color }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  size={8}
                  fill={i < showInfo.stars ? "currentColor" : "none"}
                  strokeWidth={1.5}
                />
              ))}
            </span>
          </div>
          <div className="mt-0.5">{featuresOf(showInfo)}</div>
        </div>
      )}
    </div>
  );
}

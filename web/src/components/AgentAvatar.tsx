// v5:统一的 Agent 头像渲染组件(emoji / 预设图标 / 上传图片)
import { useState, useEffect } from "react";
import { getPresetIcon } from "@/lib/agentIcon";
import { api } from "@/api/client";
import type { Agent } from "@/types/agent";

interface AgentAvatarProps {
  agent: Pick<Agent, "id" | "avatar" | "iconType" | "iconValue">;
  size?: number;
  className?: string;
}

export function AgentAvatar({ agent, size = 24, className }: AgentAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const iconType = agent.iconType || "emoji";

  // 上传图片:iconValue 包含时间戳时,用它作为缓存键
  const cacheKey = iconType === "uploaded" && agent.iconValue && agent.iconValue.startsWith("uploaded:")
    ? agent.iconValue
    : iconType === "uploaded" ? agent.id : "";
  const imgSrc = iconType === "uploaded" && !imgError
    ? `${api.agentIconUrl(agent.id)}?t=${cacheKey === agent.id ? "0" : Date.now()}`
    : "";

  // 切换 agent 或图标类型时重置错误状态
  useEffect(() => {
    setImgError(false);
  }, [agent.id, iconType, cacheKey]);

  if (iconType === "uploaded" && imgSrc && !imgError) {
    return (
      <img
        src={imgSrc}
        alt={agent.avatar || "agent"}
        width={size}
        height={size}
        className={className}
        style={{ borderRadius: "50%", objectFit: "cover", width: size, height: size }}
        onError={() => setImgError(true)}
      />
    );
  }

  if (iconType === "preset") {
    const preset = getPresetIcon(agent.iconValue);
    if (preset) {
      return (
        <span
          className={className}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            borderRadius: "50%",
            backgroundColor: preset.color + "22",
            color: preset.color,
          }}
        >
          <preset.Component size={Math.floor(size * 0.65)} />
        </span>
      );
    }
  }

  // 默认 emoji
  return (
    <span className={className} style={{ fontSize: size * 0.7, width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {agent.avatar || "🤖"}
    </span>
  );
}

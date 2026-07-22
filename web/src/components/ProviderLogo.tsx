// ProviderLogo:供应商官方图标组件
// 按扩展名队列依次尝试加载:/logos/{providerId}.svg → .png
// 无 logo 文件时:若 icon 字段有 emoji 则用 emoji 渲染(比字母徽章更直观)
// 最终回退:品牌色 + 首字母徽章。
// 不依赖任何第三方 favicon 代理服务,不请求厂商官网,加载稳定且清晰。
import { useState, useEffect } from "react";

interface ProviderLogoProps {
  name: string;
  providerId?: string; // 供应商 ID,用于匹配 /logos/{providerId}.{svg,png}
  iconColor?: string;
  websiteUrl?: string; // 保留接口兼容,当前不消费
  icon?: string; // emoji 图标(无 logo 文件时优先于字母徽章渲染)
  size?: number; // 像素尺寸,默认 40
  className?: string;
}

// 支持的扩展名队列:优先矢量 svg,其次位图 png(部分官方仅提供位图)
const LOGO_EXTS = ["svg", "png"] as const;

// 构建本地 logo URL 队列:仅当 providerId 合法时返回候选路径列表
function deriveLogoUrls(providerId?: string): string[] {
  // 仅允许 [a-zA-Z0-9_-],防止路径穿越(如 ../api/xxx)
  if (!providerId || !/^[a-zA-Z0-9_-]+$/.test(providerId)) return [];
  return LOGO_EXTS.map((ext) => `/logos/${providerId}.${ext}`);
}

// 从供应商名称提取首字母(支持中英文)
function getInitials(name: string): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (/^[A-Za-z]/.test(trimmed)) {
    const parts = trimmed.split(/[\s-]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }
  return trimmed.slice(0, 2);
}

export function ProviderLogo({
  name,
  providerId,
  iconColor,
  icon,
  size = 40,
  className = "",
}: ProviderLogoProps) {
  const [urls, setUrls] = useState<string[]>(() => deriveLogoUrls(providerId));
  const [idx, setIdx] = useState(0);

  // providerId 变化时重新计算并重置索引
  useEffect(() => {
    setUrls(deriveLogoUrls(providerId));
    setIdx(0);
  }, [providerId]);

  const currentUrl = urls[idx];

  // 仍有候选 URL 可尝试
  if (currentUrl) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: (iconColor || "#666") + "10",
        }}
      >
        <img
          src={currentUrl}
          alt={name}
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          onError={() => setIdx((i) => i + 1)}
          className="object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  // 无 logo 文件:若 icon 字段有 emoji,用 emoji 渲染(带品牌色淡底)
  if (icon && icon.trim()) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: (iconColor || "#666") + "18",
          fontSize: Math.round(size * 0.5),
          lineHeight: 1,
        }}
        role="img"
        aria-label={name}
      >
        <span>{icon.trim()}</span>
      </div>
    );
  }

  // 最终回退:品牌色 + 首字母徽章
  return (
    <div
      className={`flex shrink-0 items-center justify-center font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: iconColor || "#666",
        fontSize: Math.round(size * 0.36),
      }}
    >
      {getInitials(name)}
    </div>
  );
}

import { Info, Heart, Github } from "lucide-react";
import { useI18n } from "@/i18n";

// 核心特性卡:4 个维度(标题/描述走 i18n)
const FEATURES: { titleKey: string; descKey: string; icon: string }[] = [
  { titleKey: "about.feature.scenario.title", descKey: "about.feature.scenario.desc", icon: "🎭" },
  { titleKey: "about.feature.multiAgent.title", descKey: "about.feature.multiAgent.desc", icon: "👥" },
  { titleKey: "about.feature.star.title", descKey: "about.feature.star.desc", icon: "⭐" },
  { titleKey: "about.feature.privacy.title", descKey: "about.feature.privacy.desc", icon: "🔒" },
];

const TECH_STACK = ["React", "TypeScript", "Vite", "Tailwind", "Express", "SQLite"];

export function AboutPage() {
  const { t } = useI18n();

  return (
    <div className="h-full overflow-y-auto bg-ide-bg text-ide-fg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* === 品牌区 === */}
        <section className="border border-ide-border bg-ide-bg-alt p-6">
          {/* 终端样式 Logo */}
          <div className="flex items-center gap-2 font-mono text-2xl font-bold">
            <span className="text-ide-accent">$</span>
            <span className="text-ide-fg">Tryout</span>
            <span className="prompt-cursor inline-block h-5 w-2 bg-ide-accent" aria-hidden />
          </div>
          <p className="mt-3 text-sm text-ide-fg-muted">
            {t("about.brandTagline")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 border border-ide-border px-2 py-0.5 text-ide-fg-muted">
              <Info size={12} className="text-ide-info" />
              <span>{t("about.currentVersion")}</span>
            </span>
            <span className="inline-flex items-center gap-1 border border-ide-border px-2 py-0.5 text-ide-fg-muted">
              <Github size={12} className="text-ide-fg" />
              <span>MIT License</span>
            </span>
            <span className="inline-flex items-center gap-1 border border-ide-border px-2 py-0.5 text-ide-fg-muted">
              <Heart size={12} className="text-ide-danger" />
              <span>{t("about.openSourceDriven")}</span>
            </span>
          </div>
        </section>

        {/* === 核心特性 === */}
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ide-fg-muted">
            <span className="text-ide-accent">#</span> {t("about.coreFeatures")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.titleKey}
                className="group border border-ide-border bg-ide-bg-alt p-4 transition-colors hover:border-ide-border-active"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>
                    {f.icon}
                  </span>
                  <h3 className="text-sm font-semibold text-ide-fg">{t(f.titleKey)}</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ide-fg-muted">{t(f.descKey)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* === 技术栈 === */}
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ide-fg-muted">
            <span className="text-ide-accent">#</span> {t("about.techStack")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {TECH_STACK.map((tech) => (
              <span
                key={tech}
                className="border border-ide-border bg-ide-bg-alt px-2.5 py-1 font-mono text-xs text-ide-fg"
              >
                {tech}
              </span>
            ))}
          </div>
        </section>

        {/* === 开源信息 === */}
        <section className="mt-8 border border-ide-border bg-ide-bg-alt p-4">
          <div className="flex items-start gap-3">
            <Github size={16} className="mt-0.5 shrink-0 text-ide-fg" />
            <div className="text-xs leading-relaxed text-ide-fg-muted">
              <div className="font-semibold text-ide-fg">Tryout · MIT License</div>
              <p className="mt-1">
                {t("about.licenseDesc")}
                <Heart size={11} className="mx-0.5 inline-block text-ide-danger" />。
              </p>
              <p className="mt-2 text-ide-fg-muted">
                © 2026 Tryout Contributors. Built with React · TypeScript · Vite · Tailwind.
              </p>
            </div>
          </div>
        </section>

        {/* 底部留白 */}
        <div className="h-8" />
      </div>
    </div>
  );
}

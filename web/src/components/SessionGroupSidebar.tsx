// v5:会话分组侧边栏
// 树形展示:分组 > 会话;底部为未分组会话
// 支持新建/重命名/删除分组,以及将会话分配到分组
import { useState } from "react";
import { cn, formatTime } from "@/shared";
import type { SessionGroup, SessionInfo } from "@/types/session";
import {
  Plus, Folder, FolderOpen, Trash2, Edit2, ChevronRight, ChevronDown,
  Inbox, Check, X, FolderPlus,
} from "lucide-react";
import { useI18n } from "@/i18n";

interface Props {
  groups: SessionGroup[];
  sessions: SessionInfo[]; // 全部会话(含 groupId 字段)
  selectedSessionId: string;
  selectedGroupId: string | null; // 选中分组时(右栏显示归纳)
  onSelectSession: (id: string) => void;
  onSelectGroup: (groupId: string | null) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onAssignSession: (sessionId: string, groupId: string | null) => Promise<void>;
}

export function SessionGroupSidebar({
  groups, sessions, selectedSessionId, selectedGroupId,
  onSelectSession, onSelectGroup, onCreateGroup, onRenameGroup, onDeleteGroup, onAssignSession,
}: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [assigningSessionId, setAssigningSessionId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<string>("");

  const groupedSessions = (gid: string) => sessions.filter((s) => s.groupId === gid);
  const ungroupedSessions = sessions.filter((s) => !s.groupId);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreateGroup(newName.trim());
    setNewName("");
    setCreating(false);
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }
    await onRenameGroup(id, editName.trim());
    setEditingId(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t("sessionGroup.deleteConfirm", { name }))) return;
    await onDeleteGroup(id);
    if (selectedGroupId === id) onSelectGroup(null);
  };

  const handleAssign = async () => {
    if (!assigningSessionId) return;
    const target = assignTarget === "__ungrouped__" ? null : assignTarget;
    await onAssignSession(assigningSessionId, target);
    setAssigningSessionId(null);
    setAssignTarget("");
  };

  const toggleCollapse = (gid: string) => {
    setCollapsed((p) => ({ ...p, [gid]: !p[gid] }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-ide-border px-3 py-2 text-xs font-semibold uppercase text-ide-fg-muted">
        <span>{t("sessionGroup.title")}</span>
        <button onClick={() => setCreating(true)} title={t("sessionGroup.createTip")}
          className="flex h-5 w-5 items-center justify-center hover:bg-ide-bg-active">
          <FolderPlus size={13} />
        </button>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* 新建分组输入框 */}
        {creating && (
          <div className="mb-2 flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setCreating(false); setNewName(""); }
              }}
              placeholder={t("sessionGroup.namePlaceholder")}
              className="h-6 flex-1 border border-ide-accent bg-ide-bg px-1.5 text-xs text-ide-fg outline-none"
            />
            <button onClick={handleCreate} className="text-ide-success hover:bg-ide-bg-active p-0.5"><Check size={12} /></button>
            <button onClick={() => { setCreating(false); setNewName(""); }} className="text-ide-fg-muted hover:bg-ide-bg-active p-0.5"><X size={12} /></button>
          </div>
        )}

        {/* 分组列表 */}
        <ul className="flex flex-col gap-1">
          {groups.length === 0 && !creating && (
            <li className="px-2 py-3 text-center text-[11px] text-ide-fg-muted">
              {t("sessionGroup.empty")}
            </li>
          )}
          {groups.map((g) => {
            const isCollapsed = collapsed[g.groupId];
            const groupSess = groupedSessions(g.groupId);
            const isSelectedGroup = selectedGroupId === g.groupId;
            const isEditing = editingId === g.groupId;
            return (
              <li key={g.groupId}>
                {/* 分组标题行 */}
                <div
                  className={cn(
                    "group flex items-center gap-1 px-1.5 py-1 text-xs",
                    isSelectedGroup ? "bg-ide-bg-active text-ide-fg" : "hover:bg-ide-bg-active text-ide-fg-muted"
                  )}
                >
                  <button onClick={() => toggleCollapse(g.groupId)} className="shrink-0 hover:text-ide-fg">
                    {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  </button>
                  <button onClick={() => onSelectGroup(isSelectedGroup ? null : g.groupId)} className="flex flex-1 items-center gap-1 text-left">
                    {isCollapsed ? <Folder size={12} /> : <FolderOpen size={12} />}
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(g.groupId);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-5 flex-1 border border-ide-accent bg-ide-bg px-1 text-xs text-ide-fg outline-none"
                      />
                    ) : (
                      <span className="flex-1 truncate text-ide-fg">{g.name}</span>
                    )}
                    <span className="text-[9px] text-ide-fg-muted">{groupSess.length}</span>
                  </button>
                  {!isEditing && (
                    <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
                      <button onClick={() => { setEditingId(g.groupId); setEditName(g.name); }} title={t("sessionGroup.renameTip")}
                        className="p-0.5 text-ide-fg-muted hover:bg-ide-bg hover:text-ide-fg">
                        <Edit2 size={10} />
                      </button>
                      <button onClick={() => handleDelete(g.groupId, g.name)} title={t("sessionGroup.deleteTip")}
                        className="p-0.5 text-ide-fg-muted hover:bg-ide-bg hover:text-ide-danger">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )}
                  {isEditing && (
                    <div className="flex shrink-0 items-center">
                      <button onClick={() => handleRename(g.groupId)} className="p-0.5 text-ide-success hover:bg-ide-bg"><Check size={11} /></button>
                      <button onClick={() => setEditingId(null)} className="p-0.5 text-ide-fg-muted hover:bg-ide-bg"><X size={11} /></button>
                    </div>
                  )}
                </div>

                {/* 分组内会话 */}
                {!isCollapsed && (
                  <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-ide-border pl-2">
                    {groupSess.length === 0 && (
                      <li className="px-1 py-1 text-[10px] text-ide-fg-muted">{t("sessionGroup.emptyGroup")}</li>
                    )}
                    {groupSess.map((s) => (
                      <SessionRow
                        key={s.sessionId}
                        session={s}
                        selected={s.sessionId === selectedSessionId}
                        groups={groups}
                        isAssigning={assigningSessionId === s.sessionId}
                        assignTarget={assignTarget}
                        onSelect={() => { onSelectSession(s.sessionId); onSelectGroup(null); }}
                        onStartAssign={() => { setAssigningSessionId(s.sessionId); setAssignTarget(s.groupId || "__ungrouped__"); }}
                        onCancelAssign={() => { setAssigningSessionId(null); setAssignTarget(""); }}
                        onChangeAssignTarget={setAssignTarget}
                        onConfirmAssign={handleAssign}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        {/* 未分组会话 */}
        {ungroupedSessions.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-center gap-1 px-1.5 text-[10px] font-semibold uppercase text-ide-fg-muted">
              <Inbox size={11} /> {t("sessionGroup.ungroupedCount", { n: ungroupedSessions.length })}
            </div>
            <ul className="flex flex-col gap-0.5">
              {ungroupedSessions.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  selected={s.sessionId === selectedSessionId}
                  groups={groups}
                  isAssigning={assigningSessionId === s.sessionId}
                  assignTarget={assignTarget}
                  onSelect={() => { onSelectSession(s.sessionId); onSelectGroup(null); }}
                  onStartAssign={() => { setAssigningSessionId(s.sessionId); setAssignTarget("__ungrouped__"); }}
                  onCancelAssign={() => { setAssigningSessionId(null); setAssignTarget(""); }}
                  onChangeAssignTarget={setAssignTarget}
                  onConfirmAssign={handleAssign}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// 会话行
function SessionRow({
  session, selected, groups, isAssigning, assignTarget,
  onSelect, onStartAssign, onCancelAssign, onChangeAssignTarget, onConfirmAssign,
}: {
  session: SessionInfo;
  selected: boolean;
  groups: SessionGroup[];
  isAssigning: boolean;
  assignTarget: string;
  onSelect: () => void;
  onStartAssign: () => void;
  onCancelAssign: () => void;
  onChangeAssignTarget: (v: string) => void;
  onConfirmAssign: () => void;
}) {
  const { t } = useI18n();
  if (isAssigning) {
    return (
      <li className="flex items-center gap-1 bg-ide-bg-active px-1.5 py-1">
        <select
          value={assignTarget}
          onChange={(e) => onChangeAssignTarget(e.target.value)}
          className="h-5 flex-1 border border-ide-accent bg-ide-bg px-1 text-[10px] text-ide-fg outline-none"
        >
          <option value="__ungrouped__">{t("sessionGroup.ungrouped")}</option>
          {groups.map((g) => (
            <option key={g.groupId} value={g.groupId}>{g.name}</option>
          ))}
        </select>
        <button onClick={onConfirmAssign} className="p-0.5 text-ide-success hover:bg-ide-bg"><Check size={11} /></button>
        <button onClick={onCancelAssign} className="p-0.5 text-ide-fg-muted hover:bg-ide-bg"><X size={11} /></button>
      </li>
    );
  }
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={cn(
        "group flex cursor-pointer items-center gap-1 px-1.5 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ide-accent",
        selected ? "bg-ide-bg-active text-ide-fg" : "hover:bg-ide-bg-active text-ide-fg-muted"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("truncate", selected ? "text-ide-fg" : "text-ide-fg-muted")}>
          {session.title || t("sessionGroup.unnamed")}
        </div>
        {session.createdAt && (
          <div className="text-[9px] text-ide-fg-muted">{formatTime(session.createdAt)}</div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onStartAssign(); }}
        title={t("sessionGroup.moveTo")}
        className="shrink-0 p-0.5 text-ide-fg-muted opacity-0 hover:bg-ide-bg hover:text-ide-fg group-hover:opacity-100"
      >
        <Plus size={11} />
      </button>
    </li>
  );
}

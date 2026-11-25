import React, { useEffect, useRef, useState } from "react";
import { BatchModalKind } from "../types/music";
import {
  IconChevronDown,
  IconEditRule,
  IconFolderTree,
  IconGlobe,
  IconLanguages,
  IconLayers,
  IconShieldCheck,
  IconTools,
} from "./Icons";

interface BatchToolsMenuProps {
  onOpenModal: (kind: BatchModalKind) => void;
}

const TOOL_ITEMS: Array<{
  kind: BatchModalKind;
  icon: React.FC<{ size?: number }>;
  label: string;
  desc: string;
}> = [
  {
    kind: "filename",
    icon: IconEditRule,
    label: "Finder 批量规则",
    desc: "查找替换 / 序列化 / 文件名⇄标签互转",
  },
  {
    kind: "reorganize",
    icon: IconFolderTree,
    label: "目录重整",
    desc: "按模板物理迁移归档音频与伴随文件",
  },
  {
    kind: "unify",
    icon: IconLayers,
    label: "专辑归并",
    desc: "归一散碎专辑与 Feat. 歌手、碟号",
  },
  {
    kind: "cjk",
    icon: IconLanguages,
    label: "CJK 清洗",
    desc: "修复乱码、繁简转换、生成拼音排序",
  },
  {
    kind: "scraper",
    icon: IconGlobe,
    label: "在线刮削",
    desc: "多源匹配标签与高清封面",
  },
  {
    kind: "md5_audit",
    icon: IconShieldCheck,
    label: "MD5 巡检",
    desc: "FLAC 音频流完整性批量校验",
  },
];

export const BatchToolsMenu: React.FC<BatchToolsMenuProps> = ({
  onOpenModal,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Menu is position:fixed to escape the subbar's horizontal scroll clip —
    // anchor it to the trigger button's viewport rect.
    const btn = wrapRef.current?.querySelector("button");
    if (btn) {
      const r = btn.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="tools-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`chip-btn ${open ? "active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconTools size={12} />
        <span>批量工具</span>
        <IconChevronDown size={11} />
      </button>

      {open && (
        <div
          className="tools-menu"
          role="menu"
          aria-label="批量处理工具"
          style={menuPos ? { top: menuPos.top, right: menuPos.right } : undefined}
        >
          {TOOL_ITEMS.map((item) => (
            <button
              key={item.kind}
              type="button"
              role="menuitem"
              className="tools-menu-item"
              onClick={() => {
                setOpen(false);
                if (item.kind) onOpenModal(item.kind);
              }}
            >
              <span className="tools-menu-icon" aria-hidden="true">
                <item.icon size={14} />
              </span>
              <span className="tools-menu-text">
                <span className="tools-menu-label">{item.label}</span>
                <span className="tools-menu-desc">{item.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

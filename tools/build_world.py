#!/usr/bin/env python3
"""
🏰 World Builder — 遊戲化知識庫世界建構器
===========================================

掃描多個來源資料夾，自動生成遊戲世界 JSON 資料。

使用方式:
    python build_world.py                           # 使用預設 sources.json
    python build_world.py --config my_sources.json  # 指定設定檔
    python build_world.py --rebuild                 # 完全重建
    python build_world.py --incremental             # 增量更新
    python build_world.py --stats                   # 只顯示統計
"""

import json
import hashlib
import argparse
import re
import sys
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from typing import Optional

# ──────────────────────────────────────────────
# 設定
# ──────────────────────────────────────────────

SUPPORTED_EXTENSIONS = {".md", ".txt", ".text", ".markdown", ".rst"}
DEFAULT_CONFIG = "sources.json"
DEFAULT_OUTPUT = "data"

# 知識節點的稀有度判定（依內容長度）
RARITY_THRESHOLDS = {
    "legendary": 3000,  # 字元數
    "rare": 1500,
    "uncommon": 500,
    "common": 0,
}

# 依檔案類型判定節點類型
NODE_TYPE_MAP = {
    ".md": "scroll",
    ".txt": "note",
    ".text": "note",
    ".markdown": "scroll",
    ".rst": "blueprint",
}

# 地圖上的預設位置（最多 20 個區域的佈局）
MAP_POSITIONS = [
    {"x": 50, "y": 15},  # 上方中央
    {"x": 20, "y": 30},  # 左上
    {"x": 80, "y": 30},  # 右上
    {"x": 35, "y": 45},  # 中左
    {"x": 65, "y": 45},  # 中右
    {"x": 10, "y": 55},  # 左中
    {"x": 90, "y": 55},  # 右中
    {"x": 50, "y": 60},  # 正中
    {"x": 25, "y": 70},  # 左下
    {"x": 75, "y": 70},  # 右下
    {"x": 50, "y": 80},  # 下方中央
    {"x": 15, "y": 85},  # 左底
    {"x": 85, "y": 85},  # 右底
    {"x": 40, "y": 25},  # 補位
    {"x": 60, "y": 25},
    {"x": 30, "y": 55},
    {"x": 70, "y": 55},
    {"x": 45, "y": 75},
    {"x": 55, "y": 75},
    {"x": 50, "y": 50},
]

# NPC 角色模板
NPC_TEMPLATES = {
    "cyberpunk-tech": {
        "name": "Cipher",
        "role": "Artificer",
        "greeting": "歡迎來到機械區，這裡是技術與自動化的核心地帶。",
    },
    "creative-dream": {
        "name": "Prism",
        "role": "Dreamweaver",
        "greeting": "色彩與形狀在這裡交織，歡迎來到創意的殿堂。",
    },
    "mystical-nature": {
        "name": "Verdant",
        "role": "Keeper of Seeds",
        "greeting": "每一個靈感都是一顆種子，在這片花園中靜待發芽。",
    },
    "corporate-order": {
        "name": "Director",
        "role": "Strategist",
        "greeting": "秩序帶來效率，歡迎來到指揮中心。",
    },
    "classical-magic": {
        "name": "Archon",
        "role": "Lorekeeper",
        "greeting": "古老的智慧在這裡等待著被發現。",
    },
    "ancient-knowledge": {
        "name": "Chronos",
        "role": "Historian",
        "greeting": "時間是最好的老師，歷史中藏著無數寶藏。",
    },
    "social-hub": {
        "name": "Herald",
        "role": "Diplomat",
        "greeting": "消息在這裡匯聚，人脈在這裡交織。",
    },
}


# ──────────────────────────────────────────────
# 工具函式
# ──────────────────────────────────────────────


def file_hash(filepath: Path) -> str:
    """計算檔案的 MD5 hash，用於增量更新判斷"""
    content = filepath.read_bytes()
    return hashlib.md5(content).hexdigest()


def determine_rarity(content: str) -> str:
    """根據內容長度判斷稀有度"""
    length = len(content)
    for rarity, threshold in RARITY_THRESHOLDS.items():
        if length >= threshold:
            return rarity
    return "common"


def extract_title(content: str, filename: str) -> str:
    """從 Markdown 內容中提取標題，或使用檔名"""
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    # fallback: 用檔名（去掉副檔名）
    return Path(filename).stem


def extract_tags(content: str) -> list:
    """從內容中提取可能的標籤（基於標題和關鍵詞）"""
    tags = set()
    for line in content.split("\n"):
        line = line.strip()
        # 提取 ## 標題作為標籤
        if line.startswith("## "):
            tag = line[3:].strip()
            if len(tag) <= 20:
                tags.add(tag)
        # 提取 #hashtag 格式的標籤
        hashtags = re.findall(r"#(\w+)", line)
        for ht in hashtags:
            if len(ht) <= 20 and not ht.startswith("#"):
                tags.add(ht)
    return list(tags)[:10]  # 最多 10 個標籤


def extract_summary(content: str, max_length: int = 200) -> str:
    """提取內容摘要（去掉標題後的前 N 個字）"""
    lines = content.split("\n")
    text_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith("```"):
            # 去掉 markdown 符號
            cleaned = re.sub(r"[*_`\[\]\(\)]", "", stripped)
            cleaned = re.sub(r"^[-\d.]+\s*", "", cleaned)
            if cleaned:
                text_lines.append(cleaned)
    summary = " ".join(text_lines)
    if len(summary) > max_length:
        summary = summary[:max_length] + "..."
    return summary


def count_headings(content: str) -> int:
    """計算標題數量"""
    return len([l for l in content.split("\n") if l.strip().startswith("#")])


def count_code_blocks(content: str) -> int:
    """計算程式碼區塊數量"""
    return content.count("```") // 2


def load_manifest(output_dir: Path) -> dict:
    """載入上次建構的清單檔，用於增量更新"""
    manifest_path = output_dir / "manifest.json"
    if manifest_path.exists():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    return {"files": {}, "buildTime": None}


def save_manifest(output_dir: Path, manifest: dict):
    """儲存建構清單"""
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ──────────────────────────────────────────────
# 核心引擎
# ──────────────────────────────────────────────


class WorldBuilder:
    def __init__(self, config_path: str, output_dir: str, incremental: bool = False):
        self.config_path = Path(config_path)
        self.output_dir = Path(output_dir)
        self.incremental = incremental

        # 解析設定檔中的相對路徑時，以設定檔所在目錄為基準
        self.base_dir = self.config_path.parent

        self.config = self._load_config()
        self.regions = []
        self.knowledge_nodes = []
        self.stats = defaultdict(int)
        self.manifest = load_manifest(self.output_dir) if incremental else {"files": {}, "buildTime": None}

    def _load_config(self) -> dict:
        """載入 sources.json"""
        if not self.config_path.exists():
            print(f"❌ 找不到設定檔: {self.config_path}")
            print("請先建立 sources.json，或使用 --config 指定路徑")
            sys.exit(1)

        config = json.loads(self.config_path.read_text(encoding="utf-8"))
        print(f"✅ 載入設定檔: {self.config_path}")
        print(f"   世界名稱: {config.get('worldName', '未命名')}")
        print(f"   來源數量: {len(config.get('sources', []))}")
        return config

    def _resolve_path(self, path_str: str) -> Path:
        """解析路徑（支援相對路徑和絕對路徑）"""
        p = Path(path_str)
        if p.is_absolute():
            return p
        return (self.base_dir / p).resolve()

    def scan_all_sources(self):
        """掃描所有來源資料夾"""
        sources = self.config.get("sources", [])
        themes = self.config.get("regionThemes", {})

        print(f"\n{'='*60}")
        print(f"🔍 開始掃描 {len(sources)} 個來源...")
        print(f"{'='*60}")

        for idx, source in enumerate(sources):
            source_path = self._resolve_path(source["path"])
            region_id = source["region"]
            label = source["label"]
            icon = source.get("icon", "📁")
            theme = source.get("theme", "classical-magic")
            description = source.get("description", "")

            print(f"\n{icon} [{idx+1}/{len(sources)}] {label}")
            print(f"   路徑: {source_path}")

            if not source_path.exists():
                print(f"   ⚠️  路徑不存在，跳過")
                self.stats["skipped_sources"] += 1
                continue

            if not source_path.is_dir():
                print(f"   ⚠️  不是資料夾，跳過")
                self.stats["skipped_sources"] += 1
                continue

            # 處理 mappings（子資料夾映射）
            mappings = source.get("mappings")
            if mappings:
                for mapping in mappings:
                    sub_path = source_path / mapping["subfolder"]
                    sub_region_id = mapping["region"]
                    sub_label = mapping.get("label", mapping["subfolder"])
                    sub_theme = mapping.get("theme", theme)
                    if sub_path.exists():
                        self._scan_single_source(
                            sub_path, sub_region_id, sub_label,
                            icon, sub_theme, description, idx
                        )
            else:
                self._scan_single_source(
                    source_path, region_id, label,
                    icon, theme, description, idx
                )

        self.stats["total_regions"] = len(self.regions)
        self.stats["total_nodes"] = len(self.knowledge_nodes)

    def _scan_single_source(
        self, source_path: Path, region_id: str, label: str,
        icon: str, theme: str, description: str, position_idx: int
    ):
        """掃描單一來源資料夾"""
        themes = self.config.get("regionThemes", {})
        color_scheme = themes.get(theme, themes.get("classical-magic", {
            "primary": "#8B6914", "accent": "#FFD700", "bg": "#1a1a2e"
        }))

        # 取得地圖位置
        pos = MAP_POSITIONS[position_idx % len(MAP_POSITIONS)]

        # 取得 NPC
        npc = NPC_TEMPLATES.get(theme, NPC_TEMPLATES.get("classical-magic"))

        # 掃描檔案
        files = []
        for ext in SUPPORTED_EXTENSIONS:
            files.extend(source_path.rglob(f"*{ext}"))
        files.sort(key=lambda f: f.name)

        nodes_in_region = []
        for fpath in files:
            node = self._process_file(fpath, region_id, source_path)
            if node:
                nodes_in_region.append(node)
                self.knowledge_nodes.append(node)

        # 計算進度（有多少已 discovered）
        total = len(nodes_in_region)
        progress = 100 if total > 0 else 0  # 初始建構時設為 100%

        # 建立區域資料
        region = {
            "id": region_id,
            "name": label,
            "subtitle": description,
            "icon": icon,
            "theme": theme,
            "colorScheme": {
                "primary": color_scheme.get("primary", "#8B6914"),
                "accent": color_scheme.get("accent", "#FFD700"),
                "background": color_scheme.get("bg", "#1a1a2e"),
            },
            "position": pos,
            "progress": progress,
            "phase": f"Phase {len(self.regions) + 1}",
            "totalNodes": total,
            "npcs": [npc] if npc else [],
            "knowledgeNodeIds": [n["id"] for n in nodes_in_region],
            "subfolders": self._get_subfolders(source_path),
        }

        self.regions.append(region)
        print(f"   ✅ 找到 {total} 個知識節點")
        self.stats["scanned_sources"] += 1

    def _process_file(self, filepath: Path, region_id: str, source_root: Path) -> Optional[dict]:
        """處理單一檔案，產生知識節點"""
        try:
            content = filepath.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            try:
                content = filepath.read_text(encoding="big5")
            except Exception:
                print(f"      ⚠️  無法讀取: {filepath.name}")
                self.stats["failed_files"] += 1
                return None
        except Exception as e:
            print(f"      ⚠️  讀取錯誤 {filepath.name}: {e}")
            self.stats["failed_files"] += 1
            return None

        # 增量更新：檢查是否已處理過且未修改
        fpath_str = str(filepath)
        current_hash = file_hash(filepath)

        if self.incremental:
            old_hash = self.manifest.get("files", {}).get(fpath_str)
            if old_hash == current_hash:
                self.stats["unchanged_files"] += 1
                return None  # 跳過未修改的檔案

        # 更新 manifest
        self.manifest["files"][fpath_str] = current_hash

        # 計算節點 ID
        relative = filepath.relative_to(source_root)
        node_id = f"{region_id}--{str(relative).replace(chr(92), '--').replace('/', '--').replace('.', '-')}"

        # 計算子分類（來自子資料夾）
        subcategory = ""
        if relative.parent != Path("."):
            subcategory = str(relative.parent)

        title = extract_title(content, filepath.name)
        node_type = NODE_TYPE_MAP.get(filepath.suffix, "note")
        rarity = determine_rarity(content)
        tags = extract_tags(content)
        summary = extract_summary(content)

        node = {
            "id": node_id,
            "title": title,
            "regionId": region_id,
            "type": node_type,
            "rarity": rarity,
            "summary": summary,
            "content": content,
            "sourceFile": str(filepath),
            "relativePath": str(relative),
            "subcategory": subcategory,
            "tags": tags,
            "connections": [],  # 後續由 _build_connections 填入
            "discovered": True,
            "dateAdded": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "stats": {
                "characters": len(content),
                "lines": content.count("\n") + 1,
                "headings": count_headings(content),
                "codeBlocks": count_code_blocks(content),
            },
        }

        self.stats["processed_files"] += 1
        return node

    def _get_subfolders(self, path: Path) -> list:
        """取得子資料夾列表"""
        folders = []
        try:
            for item in sorted(path.iterdir()):
                if item.is_dir() and not item.name.startswith("."):
                    count = sum(1 for f in item.rglob("*") if f.is_file() and f.suffix in SUPPORTED_EXTENSIONS)
                    folders.append({
                        "name": item.name,
                        "fileCount": count,
                    })
        except PermissionError:
            pass
        return folders

    def build_connections(self):
        """根據標籤建立知識節點之間的連結"""
        print(f"\n🔗 建立知識連結...")

        # 建立標籤到節點的索引
        tag_index = defaultdict(list)
        for node in self.knowledge_nodes:
            for tag in node.get("tags", []):
                tag_index[tag.lower()].append(node["id"])

        # 為每個節點找到相關的其他節點
        connection_count = 0
        for node in self.knowledge_nodes:
            related = set()
            for tag in node.get("tags", []):
                for related_id in tag_index.get(tag.lower(), []):
                    if related_id != node["id"]:
                        related.add(related_id)
            node["connections"] = list(related)[:5]  # 最多 5 個連結
            connection_count += len(node["connections"])

        print(f"   ✅ 建立了 {connection_count} 個連結")

    def calculate_player_stats(self) -> dict:
        """根據知識庫內容計算角色初始屬性"""
        defaults = self.config.get("playerDefaults", {})
        total_nodes = len(self.knowledge_nodes)
        total_chars = sum(n["stats"]["characters"] for n in self.knowledge_nodes)
        total_code = sum(n["stats"]["codeBlocks"] for n in self.knowledge_nodes)

        # 屬性根據知識量調整
        base_wisdom = defaults.get("stats", {}).get("wisdom", 10)
        base_creativity = defaults.get("stats", {}).get("creativity", 10)

        return {
            "name": defaults.get("name", "旅行者"),
            "title": self._calculate_title(total_nodes),
            "level": max(1, total_nodes // 5 + 1),
            "experience": total_nodes * 100,
            "experienceToNext": (max(1, total_nodes // 5 + 1) + 1) * 500,
            "stats": {
                "wisdom": base_wisdom + total_nodes * 2,
                "creativity": base_creativity + len(self.regions) * 5,
                "charisma": defaults.get("stats", {}).get("charisma", 10),
                "endurance": defaults.get("stats", {}).get("endurance", 10) + total_chars // 5000,
            },
            "skills": total_nodes,
            "sessions": 1,
        }

    def _calculate_title(self, node_count: int) -> str:
        """根據知識點數量給予稱號"""
        titles = [
            (0, "初心者"),
            (5, "見習旅者"),
            (15, "知識探索者"),
            (30, "學問追求者"),
            (50, "智慧收集家"),
            (100, "知識守護者"),
            (200, "博學大師"),
            (500, "傳說賢者"),
        ]
        title = "初心者"
        for threshold, t in titles:
            if node_count >= threshold:
                title = t
        return title

    def generate_output(self):
        """產出所有 JSON 檔案"""
        print(f"\n{'='*60}")
        print(f"📦 生成世界資料...")
        print(f"{'='*60}")

        # 確保輸出目錄存在
        (self.output_dir / "regions").mkdir(parents=True, exist_ok=True)
        (self.output_dir / "knowledge").mkdir(parents=True, exist_ok=True)

        # 1. 生成 world.json
        world = {
            "worldName": self.config.get("worldName", "未命名世界"),
            "theme": self.config.get("theme", "fantasy-cyberpunk"),
            "author": self.config.get("author", "旅行者"),
            "buildTime": datetime.now(timezone.utc).isoformat(),
            "player": self.calculate_player_stats(),
            "regionIds": [r["id"] for r in self.regions],
            "totalRegions": len(self.regions),
            "totalKnowledgeNodes": len(self.knowledge_nodes),
            "stats": dict(self.stats),
        }
        world_path = self.output_dir / "world.json"
        world_path.write_text(
            json.dumps(world, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"   ✅ world.json")

        # 2. 生成各區域 JSON
        for region in self.regions:
            region_path = self.output_dir / "regions" / f"{region['id']}.json"
            region_path.write_text(
                json.dumps(region, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        print(f"   ✅ {len(self.regions)} 個區域檔案")

        # 3. 生成知識節點 JSON（按區域分組）
        nodes_by_region = defaultdict(list)
        for node in self.knowledge_nodes:
            nodes_by_region[node["regionId"]].append(node)

        for region_id, nodes in nodes_by_region.items():
            # 知識節點存成一個區域一個檔案（包含所有節點）
            nodes_path = self.output_dir / "knowledge" / f"{region_id}.json"

            # 生成一份不含完整 content 的索引（給地圖用）
            nodes_index = []
            for node in nodes:
                index_entry = {k: v for k, v in node.items() if k != "content"}
                nodes_index.append(index_entry)

            # 完整內容放在另一份
            nodes_full = self.output_dir / "knowledge" / f"{region_id}_full.json"
            nodes_full.write_text(
                json.dumps(nodes, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            nodes_path.write_text(
                json.dumps(nodes_index, ensure_ascii=False, indent=2), encoding="utf-8"
            )

        print(f"   ✅ {len(self.knowledge_nodes)} 個知識節點")

        # 4. 儲存 manifest
        self.manifest["buildTime"] = datetime.now(timezone.utc).isoformat()
        save_manifest(self.output_dir, self.manifest)
        print(f"   ✅ manifest.json (用於增量更新)")

    def print_report(self):
        """列印建構報告"""
        print(f"\n{'='*60}")
        print(f"📊 建構報告")
        print(f"{'='*60}")
        print(f"   🌍 世界名稱:   {self.config.get('worldName', '未命名')}")
        print(f"   🗺️  區域數量:   {self.stats['total_regions']}")
        print(f"   📜 知識節點:   {self.stats['total_nodes']}")
        print(f"   ✅ 已處理檔案: {self.stats['processed_files']}")
        if self.stats["unchanged_files"]:
            print(f"   ⏭️  未變更跳過: {self.stats['unchanged_files']}")
        if self.stats["failed_files"]:
            print(f"   ❌ 讀取失敗:   {self.stats['failed_files']}")
        if self.stats["skipped_sources"]:
            print(f"   ⚠️  跳過來源:   {self.stats['skipped_sources']}")
        print()

        # 列印各區域摘要
        if self.regions:
            print("   各區域概況:")
            print(f"   {'─'*50}")
            for r in self.regions:
                print(f"   {r['icon']} {r['name']}  —  {r['totalNodes']} 個知識節點")
                for sf in r.get("subfolders", []):
                    print(f"      └─ 📂 {sf['name']} ({sf['fileCount']} 個檔案)")
            print()

        # 角色資訊
        player = self.calculate_player_stats()
        print(f"   🎮 角色狀態:")
        print(f"   {'─'*50}")
        print(f"   名稱: {player['name']}  |  稱號: {player['title']}  |  Lv.{player['level']}")
        print(f"   WIS: {player['stats']['wisdom']}  CRA: {player['stats']['creativity']}  "
              f"CHA: {player['stats']['charisma']}  END: {player['stats']['endurance']}")
        print(f"   技能: {player['skills']}  |  EXP: {player['experience']}/{player['experienceToNext']}")
        print()

        print(f"   📁 輸出目錄: {self.output_dir.resolve()}")
        print(f"{'='*60}")
        print(f"   🎉 世界建構完成！可以開始冒險了！")
        print(f"{'='*60}\n")

    def build(self):
        """執行完整建構流程"""
        print()
        print("🏰 ═══════════════════════════════════════")
        print("   World Builder — 遊戲化知識庫世界建構器")
        print("═══════════════════════════════════════════")

        self.scan_all_sources()
        self.build_connections()
        self.generate_output()
        self.print_report()


# ──────────────────────────────────────────────
# CLI 入口
# ──────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="🏰 World Builder — 遊戲化知識庫世界建構器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例:
  python build_world.py                           # 基本建構
  python build_world.py --config my_config.json   # 指定設定檔
  python build_world.py --incremental             # 增量更新
  python build_world.py --rebuild                 # 完全重建
  python build_world.py --output ./my_data        # 指定輸出目錄
  python build_world.py --stats                   # 只顯示統計
        """,
    )
    parser.add_argument(
        "--config", "-c",
        default=DEFAULT_CONFIG,
        help=f"設定檔路徑 (預設: {DEFAULT_CONFIG})",
    )
    parser.add_argument(
        "--output", "-o",
        default=DEFAULT_OUTPUT,
        help=f"輸出目錄 (預設: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--incremental", "-i",
        action="store_true",
        help="增量模式：只處理新增或修改的檔案",
    )
    parser.add_argument(
        "--rebuild", "-r",
        action="store_true",
        help="重建模式：忽略快取，完全重新建構",
    )
    parser.add_argument(
        "--stats", "-s",
        action="store_true",
        help="只掃描並顯示統計，不生成檔案",
    )

    args = parser.parse_args()

    # --rebuild 和 --incremental 互斥
    if args.rebuild and args.incremental:
        print("❌ --rebuild 和 --incremental 不能同時使用")
        sys.exit(1)

    incremental = args.incremental and not args.rebuild

    builder = WorldBuilder(
        config_path=args.config,
        output_dir=args.output,
        incremental=incremental,
    )

    if args.stats:
        builder.scan_all_sources()
        builder.print_report()
    else:
        builder.build()


if __name__ == "__main__":
    main()

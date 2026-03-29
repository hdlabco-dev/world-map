# 🏰 遊戲化知識庫 — World Builder

將你的知識資料夾轉化為奇幻 RPG 世界。

## 快速開始

### 1. 設定來源路徑

編輯 `sources.json`，加入你的知識資料夾路徑：

```json
{
  "sources": [
    {
      "path": "D:/你的資料夾/設計",
      "region": "design-canyon",
      "label": "設計峽谷",
      "icon": "🎨",
      "theme": "creative-dream",
      "description": "設計相關知識"
    },
    {
      "path": "E:/另一顆硬碟/技術文件",
      "region": "mechanical-zone",
      "label": "機械區",
      "icon": "⚙️",
      "theme": "cyberpunk-tech",
      "description": "技術文件與教學"
    }
  ]
}
```

> 💡 路徑可以分散在不同硬碟/資料夾，腳本會去各處收集！

### 2. 執行世界建構

```bash
# 基本建構
py tools/build_world.py

# 指定設定檔和輸出路徑
py tools/build_world.py --config sources.json --output data

# 增量更新（只處理新增/修改的檔案）
py tools/build_world.py --incremental

# 完全重建
py tools/build_world.py --rebuild

# 只看統計，不生成檔案
py tools/build_world.py --stats
```

### 3. 輸出結構

```
data/
├── world.json                ← 世界總覽（角色、區域列表）
├── manifest.json             ← 建構紀錄（用於增量更新）
├── regions/
│   ├── design-canyon.json    ← 區域設定
│   └── mechanical-zone.json
└── knowledge/
    ├── design-canyon.json      ← 知識索引（不含內容）
    ├── design-canyon_full.json ← 完整知識（含內容）
    └── ...
```

## 可用的地點風格 (theme)

| Theme | 風格 | 適合 |
|-------|------|------|
| `classical-magic` | 古典魔法 | 基礎理論 |
| `cyberpunk-tech` | 賽博龐克 | 技術/工具 |
| `creative-dream` | 夢幻創意 | 設計/藝術 |
| `mystical-nature` | 神秘自然 | 靈感/隨想 |
| `corporate-order` | 企業秩序 | 專案管理 |
| `ancient-knowledge` | 遠古知識 | 歷史/記錄 |
| `social-hub` | 社交中心 | 人脈/溝通 |

## 支援的檔案格式

`.md` `.txt` `.text` `.markdown` `.rst`

## 需求

- Python 3.8+
- 無需額外安裝套件（純標準庫）

Last updated: 2026-03-29

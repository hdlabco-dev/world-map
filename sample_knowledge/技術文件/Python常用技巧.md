# Python 常用技巧

## 列表推導式
```python
squares = [x**2 for x in range(10)]
```

## 字典合併 (3.9+)
```python
merged = dict1 | dict2
```

## 路徑處理
```python
from pathlib import Path
p = Path("folder") / "subfolder" / "file.txt"
```

## 檔案讀取
```python
content = Path("file.md").read_text(encoding="utf-8")
```

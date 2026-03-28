# Git 工作流程

## 基本流程
1. `git pull` 取得最新
2. `git checkout -b feature/xxx` 建立分支
3. 開發 + commit
4. `git push origin feature/xxx`
5. 建立 Pull Request
6. Code Review → Merge

## 常用指令
- `git stash` — 暫存修改
- `git log --oneline -10` — 查看最近紀錄
- `git diff --staged` — 查看暫存區差異
- `git rebase -i HEAD~3` — 互動式重整

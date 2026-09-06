# AI帮助器 - 账号管理后台

静态网站部署于 GitHub Pages，用于管理 AI帮助器 的用户账号。

## 功能
- 添加/删除账号
- 封禁/解封账号
- 设置账号头像
- 密码 SHA-256 加密存储
- 实时与 GitHub 仓库同步

## 账号数据结构
```
server/
  username/
    password.hash   # SHA-256 哈希
    status          # enabled / banned
    avatar.b64      # base64 头像(可选)
```

## 安全提示
config.js 中的 GITHUB_TOKEN 暴露在前端，建议使用仅授权本仓库 Contents 读写的 fine-grained token。
默认管理员密码: AIHelper@2026

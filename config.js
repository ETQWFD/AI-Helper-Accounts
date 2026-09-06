// AI帮助器 账号管理后台 - 配置文件
const CONFIG = {
    GITHUB_OWNER: "ETQWFD",
    GITHUB_REPO: "AI-Helper-Accounts",
    GITHUB_BRANCH: "main",
    ADMIN_PASSWORD_HASH: "897ddb6921e81f557d40a7240fc6d869405b25cd8c6100c38c516185128b7c76",
    SERVER_PATH: "server",
    // 代理列表（按顺序尝试，直连优先）
    PROXIES: [
        "",  // 直连
        "https://gh.api.99988866.xyz/",
        "https://ghproxy.net/",
        "https://mirror.ghproxy.com/"
    ],
    RAW_PROXIES: [
        "",
        "https://raw.gitmirror.com/",
        "https://ghproxy.com/",
        "https://gh.api.99988866.xyz/"
    ]
};

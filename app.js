// AI帮助器 账号管理后台 - 核心逻辑
const API_BASE = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/${CONFIG.GITHUB_BRANCH}`;

let isLoggedIn = false;
let accounts = [];

// ========== 代理设置 ==========
function useProxy() {
    return localStorage.getItem('aihelper_use_proxy') === '1';
}
function setProxy(enabled) {
    localStorage.setItem('aihelper_use_proxy', enabled ? '1' : '0');
}
function apiUrl(path) {
    const direct = `${API_BASE}/contents/${path}?ref=${CONFIG.GITHUB_BRANCH}`;
    return useProxy() ? CONFIG.PROXY_URL + direct : direct;
}
function rawUrl(path) {
    const direct = `${RAW_BASE}/${path}`;
    return useProxy() ? CONFIG.PROXY_URL + direct : direct;
}

// ========== Token 管理 ==========
function getToken() {
    return localStorage.getItem('aihelper_github_token') || '';
}
function setToken(t) {
    localStorage.setItem('aihelper_github_token', t);
}
function clearToken() {
    localStorage.removeItem('aihelper_github_token');
}

// ========== 工具函数 ==========
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function b64decode(str) {
    return decodeURIComponent(escape(atob(str)));
}

function showToast(msg) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function setSyncStatus(text) {
    document.getElementById('syncStatus').textContent = '同步状态: ' + text;
}

// ========== GitHub API ==========
async function githubApi(method, path, body) {
    const url = apiUrl(path);
    const opts = {
        method: method,
        headers: {
            'Authorization': `token ${getToken()}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);

    // 重试最多3次
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await fetch(url, opts);
            const text = await resp.text();
            let data = {};
            try { data = JSON.parse(text); } catch { data = { message: text.substring(0, 200) }; }
            if (resp.ok) return { ok: true, data };
            if (resp.status === 401) {
                throw new Error('Bad credentials - Token无效或已过期，请重新输入');
            }
            if (resp.status === 403) {
                throw new Error('权限不足 - Token需要repo权限，或API调用超限');
            }
            lastError = data.message || `HTTP ${resp.status}: ${text.substring(0,150)}`;
            if (resp.status < 500) break; // 4xx不重试
        } catch (e) {
            lastError = e.message;
            if (e.message.includes('Bad credentials') || e.message.includes('权限不足')) break;
        }
        await new Promise(r => setTimeout(r, 800));
    }
    throw new Error(lastError || '网络请求失败，请检查网络或开启代理');
}

async function getFileSha(path) {
    try {
        const { data } = await githubApi('GET', path);
        return data.sha;
    } catch { return null; }
}

async function createFile(path, content, message) {
    const body = {
        message: message || `Update ${path}`,
        content: b64encode(content),
        branch: CONFIG.GITHUB_BRANCH
    };
    const sha = await getFileSha(path);
    if (sha) body.sha = sha;
    await githubApi('PUT', path, body);
}

async function deleteFile(path) {
    const sha = await getFileSha(path);
    if (!sha) return;
    await githubApi('DELETE', path, {
        message: `Delete ${path}`,
        sha: sha,
        branch: CONFIG.GITHUB_BRANCH
    });
}

async function readRawFile(path) {
    try {
        const resp = await fetch(rawUrl(path));
        if (!resp.ok) return null;
        return await resp.text();
    } catch { return null; }
}

// ========== 登录 ==========
async function testToken() {
    const tokenInput = document.getElementById('githubToken').value.trim();
    const resultEl = document.getElementById('tokenTestResult');
    if (!tokenInput) {
        resultEl.style.color = '#e74c3c';
        resultEl.textContent = '请先输入 Token';
        return;
    }
    resultEl.style.color = '#888';
    resultEl.textContent = '测试中...';
    try {
        const testUrl = useProxy() ? CONFIG.PROXY_URL + 'https://api.github.com/user' : 'https://api.github.com/user';
        const resp = await fetch(testUrl, {
            headers: { 'Authorization': `token ${tokenInput}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (resp.ok) {
            const data = await resp.json();
            setToken(tokenInput);
            resultEl.style.color = '#27ae60';
            resultEl.textContent = `✓ Token有效 (用户: ${data.login})`;
        } else {
            resultEl.style.color = '#e74c3c';
            resultEl.textContent = `✗ Token无效 (${resp.status})`;
        }
    } catch (e) {
        resultEl.style.color = '#e74c3c';
        resultEl.textContent = '✗ 网络错误: ' + e.message;
    }
}

async function doLogin() {
    const pwd = document.getElementById('adminPassword').value;
    const tokenInput = document.getElementById('githubToken').value.trim();
    if (tokenInput) setToken(tokenInput);
    if (!getToken()) {
        showToast('请先填写 GitHub Token');
        return;
    }
    if (!pwd) { showToast('请输入密码'); return; }
    const hash = await sha256(pwd);
    if (hash === CONFIG.ADMIN_PASSWORD_HASH) {
        isLoggedIn = true;
        sessionStorage.setItem('aihelper_admin', '1');
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
        setSyncStatus('已连接');
        loadAccounts();
    } else {
        showToast('密码错误');
    }
}

function doLogout() {
    isLoggedIn = false;
    sessionStorage.removeItem('aihelper_admin');
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('adminPassword').value = '';
    document.getElementById('githubToken').value = getToken();
}

function promptToken() {
    const current = getToken();
    const t = prompt('输入 GitHub Token (需有 repo 权限):', current ? current.substring(0,10) + '...' : '');
    if (t && !t.includes('...')) {
        setToken(t);
        showToast('Token 已更新');
        loadAccounts();
    }
}

// ========== 账号管理 ==========
async function loadAccounts() {
    const body = document.getElementById('accountListBody');
    body.innerHTML = '<div class="loading"><div class="spinner"></div><p style="margin-top:12px;">加载账号列表...</p></div>';

    try {
        const { ok, data } = await githubApi('GET', CONFIG.SERVER_PATH);
        if (!ok || !Array.isArray(data)) {
            body.innerHTML = '<div class="empty-state">暂无账号</div>';
            updateStats([]);
            return;
        }

        accounts = [];
        for (const item of data) {
            if (item.type === 'dir') {
                const username = item.name;
                const status = await readRawFile(`${CONFIG.SERVER_PATH}/${username}/status`);
                const hash = await readRawFile(`${CONFIG.SERVER_PATH}/${username}/password.hash`);
                const avatar = await readRawFile(`${CONFIG.SERVER_PATH}/${username}/avatar.b64`);
                accounts.push({
                    username,
                    status: (status || 'enabled').trim(),
                    passwordHash: (hash || '').trim(),
                    avatar: (avatar || '').trim()
                });
            }
        }
        renderAccounts();
        updateStats(accounts);
        setSyncStatus('已同步 ' + new Date().toLocaleTimeString());
    } catch (e) {
        body.innerHTML = `<div class="empty-state">加载失败: ${e.message}<br>请检查 config.js 中的 Token 是否有效</div>`;
        setSyncStatus('连接失败');
    }
}

function renderAccounts() {
    const body = document.getElementById('accountListBody');
    if (accounts.length === 0) {
        body.innerHTML = '<div class="empty-state">暂无账号，点击上方添加</div>';
        return;
    }
    body.innerHTML = accounts.map(acc => `
        <div class="account-item">
            <div class="account-avatar">
                ${acc.avatar ? `<img src="data:image/png;base64,${acc.avatar.startsWith('data:') ? acc.avatar.split(',')[1] : acc.avatar}" alt="">` : '👤'}
            </div>
            <div class="account-info">
                <div class="account-name">${escapeHtml(acc.username)}</div>
                <div class="account-status ${acc.status === 'banned' ? 'status-banned' : 'status-enabled'}">
                    ${acc.status === 'banned' ? '已封禁' : '正常启用'}
                    <span style="color:#555;margin-left:8px;font-size:11px;">哈希: ${acc.passwordHash.substring(0,16)}...</span>
                </div>
            </div>
            <div class="account-actions">
                <button class="btn btn-sm ${acc.status === 'banned' ? 'btn-success' : 'btn-warning'}"
                    onclick="toggleBan('${escapeHtml(acc.username)}')">
                    ${acc.status === 'banned' ? '解封' : '封禁'}
                </button>
                <button class="btn btn-sm btn-primary" style="background:#3498db;"
                    onclick="changeAvatar('${escapeHtml(acc.username)}')">
                    头像
                </button>
                <button class="btn btn-sm btn-danger"
                    onclick="deleteAccount('${escapeHtml(acc.username)}')">
                    删除
                </button>
            </div>
        </div>
    `).join('');
}

function updateStats(list) {
    document.getElementById('totalCount').textContent = list.length;
    document.getElementById('enabledCount').textContent = list.filter(a => a.status !== 'banned').length;
    document.getElementById('bannedCount').textContent = list.filter(a => a.status === 'banned').length;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ========== 添加账号 ==========
async function addAccount() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const avatarFile = document.getElementById('newAvatar').files[0];

    if (!username || !password) { showToast('请填写用户名和密码'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) { showToast('用户名只能包含字母数字下划线'); return; }

    const hash = await sha256(password);
    const path = `${CONFIG.SERVER_PATH}/${username}`;

    try {
        showToast('正在创建账号...');
        // Create password hash
        await createFile(`${path}/password.hash`, hash, `Add account: ${username}`);
        // Create status
        await createFile(`${path}/status`, 'enabled', `Set status for ${username}`);
        // Create avatar if provided
        if (avatarFile) {
            const b64 = await fileToBase64(avatarFile);
            await createFile(`${path}/avatar.b64`, b64, `Set avatar for ${username}`);
        }
        showToast(`账号 ${username} 创建成功！`);
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newAvatar').value = '';
        loadAccounts();
    } catch (e) {
        let hint = '';
        if (e.message.includes('Bad credentials') || e.message.includes('Token')) {
            hint = '。请点右上角Token按钮重新输入，确保勾选了repo权限';
        } else if (e.message.includes('网络') || e.message.includes('Failed')) {
            hint = '。请检查网络，或在登录页勾选"启用国内代理"';
        }
        showToast('创建失败: ' + e.message + hint);
    }
}

// ========== 删除账号 ==========
async function deleteAccount(username) {
    if (!confirm(`确定删除账号 ${username}？此操作不可恢复。`)) return;
    try {
        showToast('正在删除...');
        const path = `${CONFIG.SERVER_PATH}/${username}`;
        // Delete all files in the directory
        const files = ['password.hash', 'status', 'avatar.b64'];
        for (const f of files) {
            try { await deleteFile(`${path}/${f}`); } catch {}
        }
        showToast(`账号 ${username} 已删除`);
        loadAccounts();
    } catch (e) {
        showToast('删除失败: ' + e.message);
    }
}

// ========== 封禁/解封 ==========
async function toggleBan(username) {
    const acc = accounts.find(a => a.username === username);
    if (!acc) return;
    const newStatus = acc.status === 'banned' ? 'enabled' : 'banned';
    try {
        await createFile(`${CONFIG.SERVER_PATH}/${username}/status`, newStatus,
            `${newStatus === 'banned' ? 'Ban' : 'Unban'} ${username}`);
        showToast(`账号 ${username} 已${newStatus === 'banned' ? '封禁' : '解封'}`);
        loadAccounts();
    } catch (e) {
        showToast('操作失败: ' + e.message);
    }
}

// ========== 修改头像 ==========
async function changeAvatar(username) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
            const b64 = await fileToBase64(file);
            await createFile(`${CONFIG.SERVER_PATH}/${username}/avatar.b64`, b64,
                `Update avatar for ${username}`);
            showToast('头像更新成功');
            loadAccounts();
        } catch (e) {
            showToast('头像更新失败: ' + e.message);
        }
    };
    input.click();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            let result = reader.result;
            // Remove data URI prefix, keep only base64
            if (result.includes(',')) result = result.split(',')[1];
            resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ========== 初始化 ==========
window.onload = function() {
    // 初始化代理复选框
    const proxyCb = document.getElementById('useProxy');
    if (proxyCb) proxyCb.checked = useProxy();
    if (sessionStorage.getItem('aihelper_admin') === '1') {
        isLoggedIn = true;
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
        setSyncStatus('已连接');
        loadAccounts();
    }
};

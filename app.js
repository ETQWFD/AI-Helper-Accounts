// AI帮助器 账号管理后台 v4
const API_BASE = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/${CONFIG.GITHUB_BRANCH}`;

let isLoggedIn = false;
let accounts = [];
let workingProxy = "";
let isCreating = false; // 防重复提交

// ========== 代理URL ==========
function getApiUrls(path, preferDirect) {
    const direct = `${API_BASE}/contents/${path}?ref=${CONFIG.GITHUB_BRANCH}`;
    if (preferDirect) {
        // 写操作（PUT/DELETE）：只走直连！
        // 代理（ghproxy等）会剥离 Authorization 头或拒绝 PUT/DELETE（405），
        // 导致 GitHub 返回 401/405，所以写操作绝不放代理
        return [direct];
    }
    const urls = [];
    if (workingProxy) { urls.push(workingProxy + direct); urls.push(direct); }
    else urls.push(direct);
    for (const p of CONFIG.PROXIES) { if (p && p !== workingProxy) urls.push(p + direct); }
    return urls;
}

function getRawUrls(path) {
    const direct = `${RAW_BASE}/${path}`;
    const urls = [];
    if (workingProxy && workingProxy !== "https://raw.gitmirror.com/") urls.push(workingProxy + direct);
    urls.push(direct);
    for (const p of CONFIG.RAW_PROXIES) {
        if (p === "https://raw.gitmirror.com/") {
            const u = direct.replace("https://raw.githubusercontent.com/", "https://raw.gitmirror.com/");
            if (!urls.includes(u)) urls.push(u);
        } else if (p && p !== workingProxy) urls.push(p + direct);
    }
    return urls;
}

// ========== Token ==========
// 内置 Token（base64 分段解码，用户无需填写）
let BUILTIN_TOKEN = '';
try { BUILTIN_TOKEN = atob(String(CONFIG.GITHUB_TOKEN_P1 || '') + String(CONFIG.GITHUB_TOKEN_P2 || '')); } catch (e) { BUILTIN_TOKEN = ''; }
function getToken() { return localStorage.getItem('aihelper_github_token') || BUILTIN_TOKEN || ''; }
function setToken(t) { if (t && t.trim()) localStorage.setItem('aihelper_github_token', t.trim()); }

// ========== SHA-256 ==========
function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var mp = Math.pow, mw = mp(2, 32), lp = 'length', i, j, res = '', w = [], abl = ascii[lp] * 8;
    var h = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pc = k[lp], ic = {};
    for (var c = 2; pc < 64; c++) { if (!ic[c]) { for (i = 0; i < 313; i += c) ic[i] = c; h[pc] = (mp(c, .5) * mw) | 0; k[pc++] = (mp(c, 1 / 3) * mw) | 0; } }
    ascii += '\x80'; while (ascii[lp] % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii[lp]; i++) { j = ascii.charCodeAt(i); if (j >> 8) return; w[i >> 2] |= j << ((3 - i) % 4) * 8; }
    w[w[lp]] = ((abl / mw) | 0); w[w[lp]] = abl;
    for (j = 0; j < w[lp];) {
        var wd = w.slice(j, j += 16), oh = h; h = h.slice(0, 8);
        for (i = 0; i < 64; i++) {
            var w15 = wd[i - 15], w2 = wd[i - 2], a = h[0], e = h[4];
            var t1 = h[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & h[5]) ^ ((~e) & h[6])) + k[i] + (wd[i] = (i < 16) ? wd[i] : (wd[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + wd[i - 7] + (rr(wd[i - 2], 17) ^ rr(wd[i - 2], 19) ^ (wd[i - 2] >>> 10))) | 0);
            var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & h[1]) ^ (a & h[2]) ^ (h[1] & h[2]));
            h = [(t1 + t2) | 0].concat(h); h[4] = (h[4] + t1) | 0;
        }
        for (i = 0; i < 8; i++) h[i] = (h[i] + oh[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (h[i] >> (j * 8)) & 255; res += (b < 16 ? 0 : '') + b.toString(16); }
    return res;
}

function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }

function showToast(msg) {
    const old = document.querySelector('.toast'); if (old) old.remove();
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}

function setSyncStatus(text) { document.getElementById('syncStatus').textContent = '同步状态: ' + text; }

// ========== XMLHttpRequest 网络层（兼容所有浏览器/WebView） ==========
function xhrRequest(method, url, headers, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        let xhr;
        try { xhr = new XMLHttpRequest(); } catch (e) { reject(new Error('浏览器不支持XHR')); return; }
        try {
            xhr.open(method, url, true);
            if (headers) {
                for (const k in headers) {
                    try { xhr.setRequestHeader(k, String(headers[k])); } catch (e) {}
                }
            }
            xhr.timeout = timeoutMs;
            xhr.ontimeout = function() { reject(new Error('连接超时')); };
            xhr.onerror = function() { reject(new Error('网络错误')); };
            xhr.onload = function() {
                let data = {};
                try { data = JSON.parse(xhr.responseText); } catch { data = { message: xhr.responseText ? xhr.responseText.substring(0, 200) : '' }; }
                resolve({ status: xhr.status, data: data, raw: xhr.responseText });
            };
            xhr.send(body || null);
        } catch (e) {
            reject(new Error('请求初始化失败: ' + e.message));
        }
    });
}

// ========== GitHub API ==========
async function githubApi(method, path, body) {
    const isWrite = (method === 'PUT' || method === 'DELETE');
    const urls = getApiUrls(path, isWrite);
    const headers = {
        'Authorization': 'token ' + String(getToken() || ''),
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };
    const payload = body ? JSON.stringify(body) : null;
    // 写操作：直连慢，给足20s并重试3次；读操作：10s逐个通道尝试
    const timeout = isWrite ? 20000 : 10000;
    let lastError = '';
    for (let ui = 0; ui < urls.length; ui++) {
        // 写操作只有一个直连URL，循环3次重试
        const retries = isWrite ? 3 : 1;
        for (let ri = 0; ri < retries; ri++) {
            try {
                const resp = await xhrRequest(method, urls[ui], headers, payload, timeout);
                if (resp.status >= 200 && resp.status < 300) {
                    if (!isWrite && ui > 0) {
                        for (const p of CONFIG.PROXIES) { if (p && urls[ui].indexOf(p) === 0) { workingProxy = p; break; } }
                    }
                    return { ok: true, data: resp.data };
                }
                if (resp.status === 401) {
                    if (isWrite) throw new Error('Token无效(401)：写入需要有效Token。请开启加速器/更换网络后重试，或在右上角Token处重新填写Token');
                    throw new Error('Bad credentials(401) - Token无效或已过期');
                }
                if (resp.status === 403) {
                    if (resp.data.message && String(resp.data.message).indexOf('rate limit') >= 0) throw new Error('API限流，请等1分钟再试');
                    throw new Error('权限不足(403) - Token需要repo权限');
                }
                if (resp.status === 404) { if (isWrite) { lastError = '404-无权限或不存在'; break; } throw new Error('404-不存在'); }
                if (resp.status === 422) throw new Error('422-文件已存在或参数错误');
                lastError = 'HTTP' + resp.status + ': ' + (resp.data.message || '');
                if (resp.status < 500 && !isWrite) break;
            } catch (e) {
                lastError = e.message;
                if (e.message.indexOf('Bad credentials') >= 0 || e.message.indexOf('限流') >= 0 || e.message.indexOf('权限不足') >= 0 || e.message.indexOf('422') >= 0) throw e;
            }
        }
        if (isWrite) break; // 写操作只走直连，无需尝试其他URL
    }
    if (isWrite) throw new Error('写入失败：网络无法直连GitHub（已重试3次）。请开启VPN/加速器，或使用能直连GitHub的网络后重试');
    throw new Error(lastError || '所有连接方式均失败，请检查网络');
}

async function getFileSha(path) {
    try { const { data } = await githubApi('GET', path); return data.sha; } catch { return null; }
}

// 优化：新文件直接PUT，不先GET sha（省一半API调用）
async function createFile(path, content, message) {
    const body = { message: message || `Update ${path}`, content: b64encode(content), branch: CONFIG.GITHUB_BRANCH };
    try {
        await githubApi('PUT', path, body);
    } catch (e) {
        if (e.message.includes('422') || e.message.includes('已存在')) {
            const sha = await getFileSha(path);
            if (sha) { body.sha = sha; await githubApi('PUT', path, body); }
            else throw e;
        } else throw e;
    }
}

async function deleteFile(path) {
    const sha = await getFileSha(path);
    if (!sha) return;
    await githubApi('DELETE', path, { message: `Delete ${path}`, sha: sha, branch: CONFIG.GITHUB_BRANCH });
}

async function readRawFile(path) {
    for (const url of getRawUrls(path)) {
        try {
            const resp = await xhrRequest('GET', url, null, null, 6000);
            if (resp.status >= 200 && resp.status < 300) {
                return resp.raw !== undefined && resp.raw !== null ? resp.raw : (typeof resp.data === 'string' ? resp.data : '');
            }
        } catch { /* next */ }
    }
    return null;
}

// ========== 登录 ==========
async function testToken() {
    const resultEl = document.getElementById('tokenTestResult');
    resultEl.style.color = '#888'; resultEl.textContent = '测试中...';
    workingProxy = "";
    try {
        // 测试读权限
        await githubApi('GET', 'README.md');
        resultEl.style.color = '#27ae60';
        resultEl.textContent = '✓ 连接成功' + (workingProxy ? '（代理）' : '（直连）') + '，可以创建账号';
    } catch (e) {
        resultEl.style.color = '#e74c3c';
        resultEl.textContent = '✗ ' + e.message;
    }
}

async function doLogin() {
    const pwd = document.getElementById('adminPassword').value.trim();
    if (!getToken()) { showToast('Token配置异常，请刷新页面重试'); return; }
    if (!pwd) { showToast('请输入密码'); return; }
    if (sha256(pwd) === CONFIG.ADMIN_PASSWORD_HASH) {
        isLoggedIn = true;
        sessionStorage.setItem('aihelper_admin', '1');
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
        setSyncStatus('已连接');
        loadAccounts();
    } else {
        showToast('密码错误（正确: AIHelper@2026）');
    }
}

function doLogout() {
    isLoggedIn = false;
    sessionStorage.removeItem('aihelper_admin');
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('dashboardView').style.display = 'none';
}

function promptToken() {
    const t = prompt('输入GitHub Token (需repo权限):', '');
    if (t && t.trim()) { setToken(t.trim()); showToast('Token已更新'); loadAccounts(); }
}

// ========== 账号管理 ==========
async function loadAccounts() {
    const body = document.getElementById('accountListBody');
    body.innerHTML = '<div class="loading"><p>加载中...</p></div>';
    try {
        const { data } = await githubApi('GET', CONFIG.SERVER_PATH);
        if (!Array.isArray(data)) { body.innerHTML = '<div class="empty-state">暂无账号</div>'; updateStats([]); return; }
        const dirs = data.filter(i => i.type === 'dir');
        const results = await Promise.all(dirs.map(async item => {
            const u = item.name;
            const [status, hash, avatar] = await Promise.all([
                readRawFile(`${CONFIG.SERVER_PATH}/${u}/status`),
                readRawFile(`${CONFIG.SERVER_PATH}/${u}/password.hash`),
                readRawFile(`${CONFIG.SERVER_PATH}/${u}/avatar.b64`)
            ]);
            return { username: u, status: (status || 'enabled').trim(), passwordHash: (hash || '').trim(), avatar: (avatar || '').trim() };
        }));
        accounts = results;
        renderAccounts(); updateStats(accounts);
        setSyncStatus('已同步 ' + new Date().toLocaleTimeString());
    } catch (e) {
        body.innerHTML = `<div class="empty-state">加载失败: ${e.message}</div>`;
        setSyncStatus('连接失败');
    }
}

function renderAccounts() {
    const body = document.getElementById('accountListBody');
    if (accounts.length === 0) { body.innerHTML = '<div class="empty-state">暂无账号</div>'; return; }
    body.innerHTML = accounts.map(acc => `
        <div class="account-item">
            <div class="account-avatar">
                ${acc.avatar ? `<img src="data:image/jpeg;base64,${acc.avatar.startsWith('data:') ? acc.avatar.split(',')[1] : acc.avatar}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">` : '<span style="font-size:24px;">&#128100;</span>'}
            </div>
            <div class="account-info">
                <div class="account-name">${escapeHtml(acc.username)}</div>
                <div class="account-status ${acc.status === 'banned' ? 'status-banned' : 'status-enabled'}">${acc.status === 'banned' ? '已封禁' : '正常启用'}</div>
            </div>
            <div class="account-actions">
                <button class="btn btn-sm ${acc.status === 'banned' ? 'btn-success' : 'btn-warning'}" onclick="toggleBan('${escapeHtml(acc.username)}')">${acc.status === 'banned' ? '解封' : '封禁'}</button>
                <button class="btn btn-sm" style="background:#3498db;color:#fff;" onclick="changeAvatar('${escapeHtml(acc.username)}')">头像</button>
                <button class="btn btn-sm btn-danger" onclick="deleteAccount('${escapeHtml(acc.username)}')">删除</button>
            </div>
        </div>`).join('');
}

function updateStats(list) {
    document.getElementById('totalCount').textContent = list.length;
    document.getElementById('enabledCount').textContent = list.filter(a => a.status !== 'banned').length;
    document.getElementById('bannedCount').textContent = list.filter(a => a.status === 'banned').length;
}

function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ========== 添加账号（防重复提交） ==========
async function addAccount() {
    if (isCreating) { showToast('正在创建中，请稍候...'); return; }
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const avatarFile = document.getElementById('newAvatar').files[0];
    if (!username || !password) { showToast('请填写用户名和密码'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) { showToast('用户名只能含字母数字下划线'); return; }

    isCreating = true;
    const btn = document.getElementById('btnAddAccount');
    if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }

    try {
        showToast('正在创建账号...');
        const hash = sha256(password);
        const path = `${CONFIG.SERVER_PATH}/${username}`;
        await createFile(`${path}/password.hash`, hash, `Add account: ${username}`);
        await createFile(`${path}/status`, 'enabled', `Set status for ${username}`);
        if (avatarFile) {
            const b64 = await compressImage(avatarFile);
            await createFile(`${path}/avatar.b64`, b64, `Set avatar for ${username}`);
        }
        showToast(`账号 ${username} 创建成功！`);
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newAvatar').value = '';
        loadAccounts();
    } catch (e) {
        showToast('创建失败: ' + e.message);
    } finally {
        isCreating = false;
        if (btn) { btn.disabled = false; btn.textContent = '添加账号'; }
    }
}

async function deleteAccount(username) {
    if (!confirm(`确定删除账号 ${username}？`)) return;
    try {
        showToast('正在删除...');
        const path = `${CONFIG.SERVER_PATH}/${username}`;
        await Promise.allSettled([deleteFile(`${path}/password.hash`), deleteFile(`${path}/status`), deleteFile(`${path}/avatar.b64`)]);
        showToast(`账号 ${username} 已删除`);
        loadAccounts();
    } catch (e) { showToast('删除失败: ' + e.message); }
}

async function toggleBan(username) {
    const acc = accounts.find(a => a.username === username);
    if (!acc) return;
    const newStatus = acc.status === 'banned' ? 'enabled' : 'banned';
    try {
        showToast(newStatus === 'banned' ? '正在封禁...' : '正在解封...');
        await createFile(`${CONFIG.SERVER_PATH}/${username}/status`, newStatus, `${newStatus === 'banned' ? 'Ban' : 'Unban'} ${username}`);
        showToast(`账号 ${username} 已${newStatus === 'banned' ? '封禁' : '解封'}`);
        loadAccounts();
    } catch (e) { showToast('操作失败: ' + e.message); }
}

async function changeAvatar(username) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try {
            showToast('正在处理头像...');
            const b64 = await compressImage(file);
            await createFile(`${CONFIG.SERVER_PATH}/${username}/avatar.b64`, b64, `Update avatar for ${username}`);
            showToast('头像更新成功');
            loadAccounts();
        } catch (e) { showToast('头像失败: ' + e.message); }
    };
    input.click();
}

// 图片压缩 128x128 JPEG
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const size = 128; canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                const scale = Math.max(size / img.width, size / img.height);
                ctx.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale);
                resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
            };
            img.onerror = reject; img.src = e.target.result;
        };
        reader.onerror = reject; reader.readAsDataURL(file);
    });
}

window.onload = function() {
    if (sessionStorage.getItem('aihelper_admin') === '1') {
        isLoggedIn = true;
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
        setSyncStatus('已连接');
        loadAccounts();
    }
};

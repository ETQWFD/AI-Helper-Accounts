// AI帮助器 账号管理后台 - 核心逻辑 v3
const API_BASE = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/${CONFIG.GITHUB_BRANCH}`;

let isLoggedIn = false;
let accounts = [];
let workingProxy = ""; // 缓存可用代理

// ========== 代理URL生成 ==========
function getApiUrls(path, preferDirect) {
    const direct = `${API_BASE}/contents/${path}?ref=${CONFIG.GITHUB_BRANCH}`;
    const urls = [];
    if (preferDirect) {
        // 写操作优先直连（代理可能不支持PUT/DELETE或剥离认证头）
        urls.push(direct);
        for (const p of CONFIG.PROXIES) {
            if (p) urls.push(p + direct);
        }
    } else {
        // 读操作优先用已验证的代理
        if (workingProxy) {
            urls.push(workingProxy + direct);
            urls.push(direct);
        } else {
            urls.push(direct);
        }
        for (const p of CONFIG.PROXIES) {
            if (p && p !== workingProxy) urls.push(p + direct);
        }
    }
    return urls;
}

function getRawUrls(path) {
    const direct = `${RAW_BASE}/${path}`;
    const urls = [];
    if (workingProxy && workingProxy !== "https://raw.gitmirror.com/") {
        urls.push(workingProxy + direct);
    }
    urls.push(direct);
    for (const p of CONFIG.RAW_PROXIES) {
        if (p === "https://raw.gitmirror.com/") {
            const u = direct.replace("https://raw.githubusercontent.com/", "https://raw.gitmirror.com/");
            if (!urls.includes(u)) urls.push(u);
        } else if (p && p !== workingProxy) {
            urls.push(p + direct);
        }
    }
    return urls;
}

// ========== Token ==========
function getToken() { return localStorage.getItem('aihelper_github_token') || ''; }
function setToken(t) { localStorage.setItem('aihelper_github_token', t); }
function clearToken() { localStorage.removeItem('aihelper_github_token'); }

// ========== 纯JS SHA-256 ==========
function sha256(ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow, maxWord = mathPow(2, 32), lengthProperty = 'length', i, j;
    var result = '', words = [], asciiBitLength = ascii[lengthProperty] * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [];
    var primeCounter = k[lengthProperty], isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
            hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
            k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
    }
    ascii += '\x80';
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return;
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
    words[words[lengthProperty]] = (asciiBitLength);
    for (j = 0; j < words[lengthProperty];) {
        var w = words.slice(j, j += 16), oldHash = hash;
        hash = hash.slice(0, 8);
        for (i = 0; i < 64; i++) {
            var w15 = w[i - 15], w2 = w[i - 2];
            var a = hash[0], e = hash[4];
            var temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10))) | 0);
            var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
            hash = [(temp1 + temp2) | 0].concat(hash);
            hash[4] = (hash[4] + temp1) | 0;
        }
        for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
        for (j = 3; j + 1; j--) {
            var b = (hash[i] >> (j * 8)) & 255;
            result += (b < 16 ? 0 : '') + b.toString(16);
        }
    }
    return result;
}

function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(str) { return decodeURIComponent(escape(atob(str))); }

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

// ========== GitHub API（智能代理） ==========
async function githubApi(method, path, body) {
    const isWrite = (method === 'PUT' || method === 'DELETE');
    const urls = getApiUrls(path, isWrite);
    const opts = {
        method: method,
        headers: {
            'Authorization': `token ${getToken()}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);

    const timeout = isWrite ? 8000 : 10000;
    let lastError = '';

    for (let ui = 0; ui < urls.length; ui++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            opts.signal = controller.signal;
            const resp = await fetch(urls[ui], opts);
            clearTimeout(timeoutId);
            const text = await resp.text();
            let data = {};
            try { data = JSON.parse(text); } catch { data = { message: text.substring(0, 200) }; }

            if (resp.ok) {
                // 缓存可用代理（读操作）
                if (!isWrite && ui > 0) {
                    for (const p of CONFIG.PROXIES) {
                        if (p && urls[ui].startsWith(p)) { workingProxy = p; break; }
                    }
                }
                return { ok: true, data };
            }
            if (resp.status === 401) throw new Error('Bad credentials - Token无效');
            if (resp.status === 403) {
                if (data.message && data.message.includes('rate limit')) {
                    throw new Error('GitHub API限流，请等几分钟再试（或换Token）');
                }
                throw new Error('权限不足 - Token需要repo权限');
            }
            if (resp.status === 404) {
                if (isWrite) { lastError = '文件不存在(404)'; continue; }
                throw new Error('文件不存在(404)');
            }
            lastError = data.message || `HTTP ${resp.status}`;
            if (resp.status < 500 && !isWrite) break;
        } catch (e) {
            lastError = e.message.includes('Abort') ? '连接超时' : e.message;
            if (e.message.includes('Bad credentials') || e.message.includes('限流') || e.message.includes('权限不足')) throw e;
        }
    }
    throw new Error(lastError || '所有连接方式均失败');
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
    const urls = getRawUrls(path);
    for (const url of urls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (resp.ok) return await resp.text();
        } catch { /* next */ }
    }
    return null;
}

// ========== 登录 ==========
async function testToken() {
    const tokenInput = document.getElementById('githubToken').value.trim();
    const resultEl = document.getElementById('tokenTestResult');
    if (!tokenInput) { resultEl.style.color = '#e74c3c'; resultEl.textContent = '请先输入 Token'; return; }
    resultEl.style.color = '#888';
    resultEl.textContent = '测试中...';
    setToken(tokenInput);
    workingProxy = ""; // 重置代理缓存
    try {
        await githubApi('GET', 'README.md');
        resultEl.style.color = '#27ae60';
        resultEl.textContent = '✓ Token有效，连接成功' + (workingProxy ? '（代理）' : '（直连）');
    } catch (e) {
        resultEl.style.color = '#e74c3c';
        resultEl.textContent = '✗ ' + e.message;
    }
}

async function doLogin() {
    const pwd = document.getElementById('adminPassword').value.trim();
    const tokenInput = document.getElementById('githubToken').value.trim();
    if (tokenInput) setToken(tokenInput);
    if (!getToken()) { showToast('请先填写 GitHub Token'); return; }
    if (!pwd) { showToast('请输入密码'); return; }
    const hash = sha256(pwd);
    if (hash === CONFIG.ADMIN_PASSWORD_HASH) {
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
    const t = prompt('输入 GitHub Token (需 repo 权限):', '');
    if (t && t.trim()) { setToken(t.trim()); showToast('Token已更新'); loadAccounts(); }
}

// ========== 账号管理 ==========
async function loadAccounts() {
    const body = document.getElementById('accountListBody');
    body.innerHTML = '<div class="loading"><p>加载账号列表...</p></div>';
    try {
        const { data } = await githubApi('GET', CONFIG.SERVER_PATH);
        if (!Array.isArray(data)) {
            body.innerHTML = '<div class="empty-state">暂无账号</div>';
            updateStats([]);
            return;
        }
        // 并行拉取所有账号信息
        const dirs = data.filter(item => item.type === 'dir');
        const results = await Promise.all(dirs.map(async item => {
            const username = item.name;
            const [status, hash, avatar] = await Promise.all([
                readRawFile(`${CONFIG.SERVER_PATH}/${username}/status`),
                readRawFile(`${CONFIG.SERVER_PATH}/${username}/password.hash`),
                readRawFile(`${CONFIG.SERVER_PATH}/${username}/avatar.b64`)
            ]);
            return {
                username,
                status: (status || 'enabled').trim(),
                passwordHash: (hash || '').trim(),
                avatar: (avatar || '').trim()
            };
        }));
        accounts = results;
        renderAccounts();
        updateStats(accounts);
        setSyncStatus('已同步 ' + new Date().toLocaleTimeString());
    } catch (e) {
        body.innerHTML = `<div class="empty-state">加载失败: ${e.message}</div>`;
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
                ${acc.avatar ? `<img src="data:image/jpeg;base64,${acc.avatar.startsWith('data:') ? acc.avatar.split(',')[1] : acc.avatar}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">` : '<span style="font-size:24px;">&#128100;</span>'}
            </div>
            <div class="account-info">
                <div class="account-name">${escapeHtml(acc.username)}</div>
                <div class="account-status ${acc.status === 'banned' ? 'status-banned' : 'status-enabled'}">
                    ${acc.status === 'banned' ? '已封禁' : '正常启用'}
                </div>
            </div>
            <div class="account-actions">
                <button class="btn btn-sm ${acc.status === 'banned' ? 'btn-success' : 'btn-warning'}" onclick="toggleBan('${escapeHtml(acc.username)}')">
                    ${acc.status === 'banned' ? '解封' : '封禁'}
                </button>
                <button class="btn btn-sm" style="background:#3498db;color:#fff;" onclick="changeAvatar('${escapeHtml(acc.username)}')">头像</button>
                <button class="btn btn-sm btn-danger" onclick="deleteAccount('${escapeHtml(acc.username)}')">删除</button>
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
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) { showToast('用户名只能含字母数字下划线'); return; }

    const hash = sha256(password);
    const path = `${CONFIG.SERVER_PATH}/${username}`;
    const btn = document.getElementById('btnAddAccount');
    btn.disabled = true;
    btn.textContent = '创建中...';

    try {
        showToast('正在创建...');
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
        btn.disabled = false;
        btn.textContent = '添加账号';
    }
}

// ========== 删除账号 ==========
async function deleteAccount(username) {
    if (!confirm(`确定删除账号 ${username}？`)) return;
    try {
        showToast('正在删除...');
        const path = `${CONFIG.SERVER_PATH}/${username}`;
        // 并行删除所有文件
        await Promise.allSettled([
            deleteFile(`${path}/password.hash`),
            deleteFile(`${path}/status`),
            deleteFile(`${path}/avatar.b64`)
        ]);
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
        showToast(newStatus === 'banned' ? '正在封禁...' : '正在解封...');
        await createFile(`${CONFIG.SERVER_PATH}/${username}/status`, newStatus,
            `${newStatus === 'banned' ? 'Ban' : 'Unban'} ${username}`);
        showToast(`账号 ${username} 已${newStatus === 'banned' ? '封禁' : '解封'}`);
        loadAccounts();
    } catch (e) {
        showToast('操作失败: ' + e.message);
    }
}

// ========== 修改头像（带压缩） ==========
async function changeAvatar(username) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
            showToast('正在处理头像...');
            const b64 = await compressImage(file);
            await createFile(`${CONFIG.SERVER_PATH}/${username}/avatar.b64`, b64, `Update avatar for ${username}`);
            showToast('头像更新成功');
            loadAccounts();
        } catch (e) {
            showToast('头像更新失败: ' + e.message);
        }
    };
    input.click();
}

// 图片压缩：缩放至128x128，JPEG质量0.8，输出纯base64
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const size = 128;
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                // 居中裁剪
                const scale = Math.max(size / img.width, size / img.height);
                const w = img.width * scale, h = img.height * scale;
                ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                resolve(dataUrl.split(',')[1]); // 只返回base64部分
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ========== 初始化 ==========
window.onload = function() {
    if (sessionStorage.getItem('aihelper_admin') === '1') {
        isLoggedIn = true;
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
        setSyncStatus('已连接');
        loadAccounts();
    }
};

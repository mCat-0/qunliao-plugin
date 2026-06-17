import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function findYunzaiRoot (from) {
  let cur = path.resolve(from)
  for (let i = 0; i < 15; i++) {
    const pluginsDir = path.join(cur, 'plugins')
    try {
      if (fs.existsSync(pluginsDir) && fs.statSync(pluginsDir).isDirectory()) {
        return cur
      }
    } catch (_) { /* ignore */ }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return process.cwd()
}

const yunzaiRoot = findYunzaiRoot(__dirname).replace(/\\/g, '/')

function libUrl (rel) {
  const parts = rel.split('/').filter(Boolean)
  const abs = path.join(yunzaiRoot, 'lib', ...parts)
  return pathToFileURL(abs).href
}

const plugin = (await import(libUrl('plugins/plugin.js'))).default

const {
  isModuleEnabled,
  getString,
  getStringList
} = await import('../components/ModuleHelper.js')

const { pluginRoot, pluginConfigDir } = await import('../model/path.js')

const _MODULE_KEY = 'update'
let isUpdating = false

// ===== 配置读取 =====
function getUpdateConfig() {
  const cfg = {
    branch: 'main',
    sshKeyPath: '',
    remoteName: 'origin',
    extraAdminQQ: [],
    enabled: true
  }
  try {
    const v = getString(_MODULE_KEY, 'branch', '')
    if (v) cfg.branch = v.trim()
  } catch (_) { }
  try {
    const v = getString(_MODULE_KEY, 'sshKeyPath', '')
    if (v) cfg.sshKeyPath = v.trim()
  } catch (_) { }
  try {
    const v = getString(_MODULE_KEY, 'remoteName', '')
    if (v) cfg.remoteName = v.trim()
  } catch (_) { }
  try {
    const list = getStringList(_MODULE_KEY, 'extraAdminQQ', [])
    if (Array.isArray(list) && list.length > 0) {
      cfg.extraAdminQQ = list.map((x) => String(x).trim()).filter(Boolean)
    }
  } catch (_) { }
  return cfg
}

// ===== Git 命令执行（异步，非阻塞事件循环） =====
//
// 关键：之前使用 execSync 会阻塞 Node.js 事件循环，在 git pull / git fetch 等待网络期间，
// 整个 Yunzai 无法处理任何指令。改用 spawn + 异步等待，命令执行期间 Node.js 仍能响应其它消息。
//
// 同时注意：
//   - stdout/stderr 必须持续读取，否则子进程缓冲区填满后会永久挂起
//   - 给每个 git 子进程设置上限 120 秒，防止网络问题拖死插件
//   - 禁用交互提示（GIT_TERMINAL_PROMPT=0 / GCM_INTERACTIVE=Never / ssh BatchMode=yes）
function buildGitEnv () {
  const cfg = getUpdateConfig()
  const env = Object.assign({}, process.env, {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_SSH_VARIANT: 'ssh'
  })

  let sshCmd = 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o BatchMode=yes'
  if (cfg.sshKeyPath) {
    let keyPath = String(cfg.sshKeyPath).trim()
    const home = process.env.USERPROFILE || process.env.HOME || ''
    if (keyPath.startsWith('~/') || keyPath.startsWith('~\\')) keyPath = home + keyPath.slice(1)
    if (keyPath.startsWith('$HOME/') || keyPath.startsWith('$HOME\\')) keyPath = home + keyPath.slice(5)
    keyPath = keyPath.replace(/\\/g, '/')
    sshCmd = sshCmd + ' -o "IdentityFile=' + keyPath + '"'
  }
  env.GIT_SSH_COMMAND = sshCmd
  return env
}

function runGitAsync (cmd, timeoutMs) {
  return new Promise((resolve) => {
    try {
      // 拆分：git fetch origin main → ['fetch', 'origin', 'main']
      const parts = String(cmd || '').trim().split(/\s+/).filter(Boolean)
      if (parts.length < 2 || parts[0] !== 'git') {
        resolve({ ok: false, error: '无效的 git 命令: ' + cmd })
        return
      }
      const args = parts.slice(1)

      const child = spawn('git', args, {
        cwd: pluginRoot,
        env: buildGitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      })

      let stdout = ''
      let stderr = ''
      let done = false
      const safeTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 120000

      const timer = setTimeout(() => {
        if (done) return
        done = true
        try {
          child.kill('SIGTERM')
          setTimeout(() => { try { child.kill('SIGKILL') } catch (_) { } }, 2000)
        } catch (_) { /* ignore */ }
        resolve({ ok: false, error: '执行超时 (' + Math.round(safeTimeout / 1000) + 's)，请检查网络或稍后再试' })
      }, safeTimeout)

      child.stdout.on('data', (chunk) => {
        try { stdout += chunk.toString('utf-8') } catch (_) { }
      })
      child.stderr.on('data', (chunk) => {
        try { stderr += chunk.toString('utf-8') } catch (_) { }
      })

      let pending = 2
      const tryFinish = () => {
        if (pending > 0) return
        clearTimeout(timer)
        if (done) return
        done = true
        resolve({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() })
      }
      child.stdout.on('end', () => { pending--; tryFinish() })
      child.stderr.on('end', () => { pending--; tryFinish() })

      child.on('error', (err) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ ok: false, error: (err && err.message) ? err.message : String(err) })
      })

      child.on('exit', (code) => {
        // 等 stdout/stderr 的 end 事件触发后再汇总
        // 若 1.5 秒内仍未 end，强制结算（某些异常情况下可能出现）
        setTimeout(() => {
          if (done) return
          done = true
          clearTimeout(timer)
          if (code === 0) {
            resolve({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() })
          } else {
            const combined = (stderr.trim() || stdout.trim() || 'git 退出码 ' + code)
            resolve({ ok: false, error: combined })
          }
        }, 1500)
      })
    } catch (err) {
      resolve({ ok: false, error: (err && err.message) ? err.message : String(err) })
    }
  })
}

async function runGit (cmd) {
  const r = await runGitAsync(cmd, 120000)
  return { ok: r.ok, stdout: r.ok ? (r.stdout || '') : '', error: !r.ok ? (r.error || '') : '' }
}

function isGitRepo() {
  try { return fs.existsSync(path.join(pluginRoot, '.git')) } catch (_) { return false }
}

async function getCommitId() {
  const r = await runGit('git rev-parse --short HEAD')
  return r.ok ? r.stdout : ''
}

async function getCommitTime() {
  const r = await runGit('git log -1 --oneline --pretty=format:"%cd" --date=format:"%Y-%m-%d %H:%M"')
  return r.ok ? r.stdout.replace(/"/g, '') : ''
}

async function getRemoteUrl() {
  const r = await runGit('git remote get-url origin')
  return r.ok ? r.stdout : ''
}

// ===== 管理员校验 =====
function isAdmin(e) {
  const uid = String(e?.user_id || e?.sender?.user_id || '')
  if (!uid) return false
  if (e?.isMaster === true || e?.is_master === true) return true

  const cfg = getUpdateConfig()
  if (cfg.extraAdminQQ && Array.isArray(cfg.extraAdminQQ)) {
    if (cfg.extraAdminQQ.some((q) => String(q).trim() === uid)) {
      logger.mark(`[update] 用户 ${uid} 通过 extraAdminQQ 校验`)
      return true
    }
  }

  const masterQQs = []
  for (const field of ['Bot?.config?.master', 'Bot?.master', 'Bot?.config?.other?.masterQQ', 'Bot?.config?.other?.master']) {
    try {
      const val = eval(field)
      if (Array.isArray(val)) masterQQs.push(...val)
      else if (typeof val === 'string' || typeof val === 'number') masterQQs.push(val)
    } catch (_) { }
  }
  const normalized = masterQQs.map((x) => String(x).trim()).filter(Boolean)
  if (normalized.length > 0 && normalized.includes(uid)) return true
  return false
}

// ===== 获取最近 commit 日志 =====
async function getRecentLog(oldId) {
  const r = await runGit('git log -20 --oneline --pretty=format:"%h||[%cd] %s" --date=format:"%m-%d %H:%M"')
  if (!r.ok) return []
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const result = []
  for (const line of lines) {
    const parts = line.split('||')
    if (parts.length < 2) continue
    if (parts[0] === oldId) break
    if (parts[1].includes('Merge branch')) continue
    result.push(parts[1])
  }
  return result
}

// ===== 错误信息友好化 =====
function friendlyGitError(errStr) {
  const e = String(errStr || '')
  if (e.includes('Timed out') || e.includes('timeout') || e.includes('超时')) return '连接超时，请检查网络'
  if (e.includes('Failed to connect') || e.includes('unable to access')) return '无法连接远程仓库，请检查网络或仓库地址'
  if (e.includes('Permission denied') || e.includes('Permission denied (publickey)')) return 'SSH 权限被拒绝：请确认 ' + path.basename(pluginRoot) + ' 目录下配置了正确的 SSH key（在锅巴面板的 update.sshKeyPath 中可指定私钥路径）'
  if (e.includes('HTTP Basic: Access denied') || e.includes('Authentication failed')) return '需要认证：请用 SSH 方式 clone 仓库，或配置凭据后重试'
  if (e.includes('not a git repository')) return '本地目录不是 git 仓库，请用 git clone 方式安装插件'
  if (e.includes('Already up to date') || e.includes('已经是最新的')) return '已经是最新版本'
  return e
}

// ===== 主入口 =====
export class UpdatePlugin extends plugin {
  constructor() {
    super({
      name: 'qunliao-UpdatePlugin',
      dsc: '群聊插件：插件更新（管理员专用）',
      event: 'message',
      priority: 10,
      rule: [
        { reg: '^#更新群聊插件$', permission: 'master', fnc: 'update' },
        { reg: '^#修复群聊插件$', permission: 'master', fnc: 'repair' },
        { reg: '^#群聊插件版本$', permission: 'master', fnc: 'version' }
      ]
    })
  }

  async update(e) { return this.runUpdate(e, 'update') }
  async repair(e) { return this.runUpdate(e, 'repair') }

  async version(e) {
    if (!isAdmin(e)) return this.reply('仅管理员可查看版本信息')
    const id = (await getCommitId()) || '未知'
    const t = (await getCommitTime()) || '未知'
    const url = (await getRemoteUrl()) || '未知'
    return this.reply('群聊插件版本信息\ncommit: ' + id + '\n最后更新: ' + t + '\n远程仓库: ' + url)
  }

  async runUpdate(e, mode) {
    if (!isModuleEnabled(_MODULE_KEY)) return this.reply('插件更新失败：更新功能已被禁用')
    if (!isAdmin(e)) return this.reply('插件更新失败：仅管理员可使用该指令')

    if (isUpdating) {
      await this.reply('已有更新正在执行中，请稍候...')
      return
    }

    if (!isGitRepo()) {
      return this.reply('插件目录非 git clone 方式安装，无法自动更新。请先删除旧插件，再用 git clone https://gitee.com/mcat0/qunliao-plugin.git 重新安装')
    }

    await this.reply('正在执行群聊插件' + (mode === 'repair' ? '强制修复' : '更新') + '，请稍等...')

    isUpdating = true
    const cfg = getUpdateConfig()
    const oldId = await getCommitId()
    let updateSucceeded = false
    let lastMsg = ''

    try {
      // 先确保在目标分支上
      const checkBranch = await runGit('git symbolic-ref --short HEAD')
      const curBranch = checkBranch.ok ? checkBranch.stdout : '未知'
      if (curBranch !== cfg.branch) {
        await runGit('git checkout ' + cfg.branch)
      }

      let result
      if (mode === 'repair') {
        // 强制修复：重置 + 拉取
        await runGit('git reset --hard HEAD')
        await runGit('git clean -fd')
        result = await runGit('git fetch ' + cfg.remoteName + ' ' + cfg.branch)
        if (result.ok) result = await runGit('git reset --hard ' + cfg.remoteName + '/' + cfg.branch)
      } else {
        // 普通更新
        result = await runGit('git pull ' + cfg.remoteName + ' ' + cfg.branch)
      }

      if (!result.ok) {
        lastMsg = friendlyGitError(result.error)
        return this.reply('插件更新失败：' + lastMsg)
      }

      const out = result.stdout
      const isAlreadyUp = /Already up[ -]to[ -]date|已经是最新的/.test(out)
      const newId = await getCommitId()
      const newTime = await getCommitTime()

      if (isAlreadyUp && oldId === newId) {
        return this.reply('群聊插件已经是最新版本\ncommit: ' + newId + '\n时间: ' + newTime)
      }

      updateSucceeded = true
      await this.reply('群聊插件更新成功！\n新 commit: ' + newId + '\n最后更新: ' + newTime + '\n请重启 Yunzai-Bot 使更改生效')

      if (oldId !== newId) {
        const log = await getRecentLog(oldId)
        if (log.length > 0) {
          const lines = log.slice(0, 10).map((l, i) => (i + 1) + '. ' + l)
          await this.reply('本次更新内容:\n' + lines.join('\n'))
        }
      }
    } catch (err) {
      lastMsg = String(err.message || err)
      return this.reply('插件更新失败：' + lastMsg)
    } finally {
      isUpdating = false
    }
  }
}

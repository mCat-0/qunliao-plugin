import plugin from '../../../lib/plugins/plugin.js'
import fs from 'node:fs'
import path from 'node:path'
import {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  getStringList,
  httpFetch
} from '../components/ModuleHelper.js'
import { pluginRoot, pluginConfigDir } from '../model/path.js'

const _MODULE_KEY = 'update'

const platforms = {
  github: {
    name: 'GitHub',
    build: (cfg) => {
      const owner = 'mCat-0'
      const repo = 'qunliao-plugin'
      const branch = cfg.githubBranch
      const proxy = (cfg.githubProxy || '').trim()
      const base = 'https://api.github.com/repos/' + owner + '/' + repo + '/git/trees/' + branch + '?recursive=1'
      const rawBase = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/'
      const build = (proxy && proxy.startsWith('http'))
        ? (p) => proxy.replace(/\/$/, '') + '/' + rawBase + p
        : (p) => rawBase + p
      return { treeUrl: base, rawUrlBuilder: build, extraFetchOpts: {} }
    }
  },
  gitee: {
    name: 'Gitee',
    build: (cfg) => {
      const owner = 'mcat0'
      const repo = 'qunliao-plugin'
      const branch = cfg.giteeBranch
      const base = 'https://gitee.com/api/v5/repos/' + owner + '/' + repo + '/git/trees/' + branch + '?recursive=1'
      const rawBase = 'https://gitee.com/' + owner + '/' + repo + '/raw/' + branch + '/'
      const extraFetchOpts = {}
      const user = (cfg.giteeUsername || '').trim()
      const pass = (cfg.giteePassword || '').trim()
      if (user && pass) {
        try {
          const basic = Buffer.from(user + ':' + pass).toString('base64')
          extraFetchOpts.headers = { 'Authorization': 'Basic ' + basic }
        } catch (_) { }
      }
      return {
        treeUrl: base,
        rawUrlBuilder: (p) => rawBase + p,
        extraFetchOpts: extraFetchOpts
      }
    }
  },
  gitlab: {
    name: 'GitLab',
    build: (cfg) => {
      const full = 'mCat0/qunliao-plugin'
      const branch = cfg.gitlabBranch
      const encoded = encodeURIComponent(full)
      const token = (cfg.gitlabAccessToken || '').trim()
      const base = 'https://gitlab.com/api/v4/projects/' + encoded + '/repository/tree?recursive=true&per_page=100&ref=' + branch
      const rawApiBase = 'https://gitlab.com/api/v4/projects/' + encoded + '/repository/files/'
      const extraFetchOpts = {}
      if (token) {
        extraFetchOpts.headers = { 'PRIVATE-TOKEN': token }
      }
      return {
        treeUrl: base,
        rawUrlBuilder: (p) => rawApiBase + encodeURIComponent(p) + '/raw?ref=' + branch,
        extraFetchOpts: extraFetchOpts
      }
    }
  }
}

function isUserConfigPath(relPath) {
  if (!relPath) return false
  const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  return (
    p === 'config.yaml' ||
    p === 'config/config.yaml' ||
    p === 'config.yml' ||
    p === 'config/config.yml' ||
    (p.startsWith('config/') && (p.endsWith('.yaml') || p.endsWith('.yml')))
  )
}

function extractFiles(treeData) {
  let items
  if (Array.isArray(treeData)) {
    items = treeData
  } else if (treeData && Array.isArray(treeData.tree)) {
    items = treeData.tree
  } else {
    return []
  }
  return items
    .filter((it) => it && (it.type === 'blob' || it.type === 'file'))
    .map((it) => String(it.path || it.name || ''))
    .filter(Boolean)
}

async function fetchFileRaw(rawUrl, filePath, extraOpts) {
  const lower = String(filePath || '').toLowerCase()
  const isText = lower.endsWith('.js') || lower.endsWith('.json') ||
    lower.endsWith('.md') || lower.endsWith('.yaml') || lower.endsWith('.yml') ||
    lower.endsWith('.css') || lower.endsWith('.html') || lower.endsWith('.htm') ||
    lower.endsWith('.txt')
  let opts = null
  if (extraOpts && typeof extraOpts === 'object') {
    if (extraOpts.headers) {
      opts = { headers: Object.assign({}, extraOpts.headers) }
    }
  }
  const res = opts ? await httpFetch(rawUrl, opts) : await httpFetch(rawUrl)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  if (isText) {
    return { isText: true, text: await res.text() }
  }
  return { isText: false, buffer: await res.arrayBuffer() }
}

function getUpdateConfig() {
  const cfg = {
    defaultPlatform: 'gitlab',
    githubBranch: 'main',
    githubProxy: '',
    giteeBranch: 'main',
    giteeUsername: '',
    giteePassword: '',
    gitlabBranch: 'main',
    gitlabAccessToken: '',
    extraAdminQQ: [],
    enabled: true
  }
  try {
    const raw = getString(_MODULE_KEY, 'defaultPlatform', '')
    if (raw) cfg.defaultPlatform = raw
  } catch (_) { }
  const keys = [
    'githubBranch', 'githubProxy',
    'giteeBranch', 'giteeUsername', 'giteePassword',
    'gitlabBranch', 'gitlabAccessToken'
  ]
  for (const k of keys) {
    try {
      const v = getString(_MODULE_KEY, k, '')
      if (v) cfg[k] = v
    } catch (_) { }
  }
  try {
    const list = getStringList(_MODULE_KEY, 'extraAdminQQ', [])
    if (Array.isArray(list) && list.length > 0) {
      cfg.extraAdminQQ = list.map((x) => String(x).trim()).filter(Boolean)
    }
  } catch (_) { }
  return cfg
}

function isAdmin(e) {
  const uid = String(e?.user_id || e?.sender?.user_id || '')
  if (!uid) return false

  if (e?.isMaster === true || e?.is_master === true) {
    logger.mark(`[update] 用户 ${uid} 通过 e.isMaster 校验`)
    return true
  }

  const cfg = getUpdateConfig()
  if (cfg.extraAdminQQ && Array.isArray(cfg.extraAdminQQ)) {
    if (cfg.extraAdminQQ.some((q) => String(q).trim() === uid)) {
      logger.mark(`[update] 用户 ${uid} 通过 extraAdminQQ 校验`)
      return true
    }
  }

  const masterQQs = []
  try {
    const c1 = Bot?.config?.master
    if (Array.isArray(c1)) masterQQs.push(...c1)
    else if (typeof c1 === 'string' || typeof c1 === 'number') masterQQs.push(c1)
  } catch (_) { }
  try {
    const c2 = Bot?.master
    if (Array.isArray(c2)) masterQQs.push(...c2)
    else if (typeof c2 === 'string' || typeof c2 === 'number') masterQQs.push(c2)
  } catch (_) { }
  try {
    const c3 = Bot?.config?.other?.masterQQ
    if (Array.isArray(c3)) masterQQs.push(...c3)
    else if (typeof c3 === 'string' || typeof c3 === 'number') masterQQs.push(c3)
  } catch (_) { }
  try {
    const c4 = Bot?.config?.other?.master
    if (Array.isArray(c4)) masterQQs.push(...c4)
    else if (typeof c4 === 'string' || typeof c4 === 'number') masterQQs.push(c4)
  } catch (_) { }

  const normalized = masterQQs.map((x) => String(x).trim()).filter(Boolean)
  if (normalized.length > 0) {
    if (normalized.includes(uid)) {
      logger.mark(`[update] 用户 ${uid} 通过 Bot 主人列表校验 (${normalized.join(',')})`)
      return true
    }
  }

  logger.warn(`[update] 用户 ${uid} 非管理员 (Bot主人列表: ${normalized.length > 0 ? normalized.join(',') : '空'})`)
  return false
}

function buildTryOrder(cfg) {
  const order = []
  const platformKeys = ['github', 'gitee', 'gitlab']
  const first = platformKeys.includes(cfg.defaultPlatform) ? cfg.defaultPlatform : 'gitlab'
  order.push(first)
  for (const k of platformKeys) if (!order.includes(k)) order.push(k)
  return order
}

async function tryPlatform(platformKey, cfg, mode) {
  const platform = platforms[platformKey]
  const { treeUrl, rawUrlBuilder, extraFetchOpts } = platform.build(cfg)

  const treeResp = extraFetchOpts && extraFetchOpts.headers
    ? await httpFetch(treeUrl, { headers: Object.assign({}, extraFetchOpts.headers) })
    : await httpFetch(treeUrl)
  if (!treeResp.ok) {
    let hint = ''
    if (platformKey === 'gitlab' && treeResp.status === 404) {
      const hasToken = extraFetchOpts && extraFetchOpts.headers && extraFetchOpts.headers['PRIVATE-TOKEN']
      hint = hasToken
        ? '（仓库路径可能有误，或 Access Token 无 read_repository 权限）'
        : '（GitLab 仓库为私有，请在锅巴面板的 update.gitlabAccessToken 填入 Personal Access Token；留空匿名访问无法读取私有仓库）'
    } else if (platformKey === 'gitee' && treeResp.status === 404) {
      hint = '（Gitee 仓库为私有或需要登录，请在锅巴面板配置 update.giteeUsername / update.giteePassword）'
    }
    throw new Error('获取文件树失败: HTTP ' + treeResp.status + hint)
  }
  let treeData
  try { treeData = await treeResp.json() } catch (e) { throw new Error('解析文件树 JSON 失败') }
  const files = extractFiles(treeData)
  if (!files.length) throw new Error('未找到文件')

  const shouldSkip = (p) => {
    if (mode === 'update' && isUserConfigPath(p)) return true
    return false
  }

  const report = { downloaded: 0, skipped: 0, errors: [] }
  for (const relPath of files) {
    if (!relPath) continue
    if (relPath.endsWith('/')) continue
    if (relPath.startsWith('.git/') || relPath === '.git') continue
    if (shouldSkip(relPath)) {
      report.skipped++
      continue
    }
    try {
      const rawUrl = rawUrlBuilder(relPath)
      const content = await fetchFileRaw(rawUrl, relPath, extraFetchOpts)
      const absPath = path.join(pluginRoot, relPath)
      const dir = path.dirname(absPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      if (content.isText) {
        fs.writeFileSync(absPath, content.text, 'utf-8')
      } else {
        fs.writeFileSync(absPath, Buffer.from(content.buffer))
      }
      report.downloaded++
    } catch (err) {
      report.errors.push(relPath + ': ' + (err.message || err))
    }
  }

  if (report.errors.length > 0 && report.downloaded === 0) {
    throw new Error('所有文件均拉取失败: ' + report.errors.slice(0, 3).join('; '))
  }
  return report
}

function clearUserConfig() {
  try {
    const entries = fs.readdirSync(pluginConfigDir)
    let removed = 0
    for (const name of entries) {
      if (name.endsWith('.yaml') || name.endsWith('.yml')) {
        if (name.includes('_default')) continue
        const abs = path.join(pluginConfigDir, name)
        try {
          fs.rmSync(abs, { force: true })
          removed++
        } catch (_) { }
      }
    }
    return removed
  } catch (e) {
    return 0
  }
}

const log = (msg) => {
  try { logger.mark(msg) } catch (_) { console.log(msg) }
}
const logWarn = (msg) => {
  try { logger.warn(msg) } catch (_) { console.warn(msg) }
}

export class UpdatePlugin extends plugin {
  constructor() {
    super({
      name: 'UpdatePlugin',
      dsc: '群聊插件：插件更新（管理员专用）',
      event: 'message',
      priority: 10,
      rule: [
        { reg: '^#更新群聊插件$', permission: 'master', fnc: 'update' },
        { reg: '^#修复群聊插件$', permission: 'master', fnc: 'repair' }
      ]
    })
  }

  async update(e) { return this.runUpdate(e, 'update') }
  async repair(e) { return this.runUpdate(e, 'repair') }

  async runUpdate(e, mode) {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('插件更新失败：「在线更新」功能已被禁用')
    }
    if (!isGroupAllowed(e, _MODULE_KEY)) {
      return this.reply('插件更新失败：当前群不在白名单内')
    }
    if (!isAdmin(e)) {
      return this.reply('插件更新失败：仅管理员可使用该指令')
    }

    this.reply('正在尝试执行更新插件，请稍等...').catch(() => {})

    const cfg = getUpdateConfig()
    const modeText = mode === 'repair' ? '修复（覆盖所有文件并清除用户配置）' : '更新（保留用户配置）'
    log('[update] ' + modeText + ' 开始，默认平台=' + cfg.defaultPlatform)

    const order = buildTryOrder(cfg)
    let lastErr = null
    for (const key of order) {
      try {
        log('[update] 尝试平台 ' + platforms[key].name)
        const report = await tryPlatform(key, cfg, mode)
        log('[update] ' + platforms[key].name + ' 成功：下载 ' + report.downloaded + '，跳过 ' + report.skipped + ' 条')
        if (mode === 'repair') {
          const removed = clearUserConfig()
          log('[update] 已清除 ' + removed + ' 个用户配置文件')
        }
        return this.reply('群聊插件更新成功，请重启Yunzai-Bot')
      } catch (err) {
        lastErr = err
        logWarn('[update] ' + platforms[key].name + ' 失败: ' + (err.message || err))
      }
    }
    return this.reply('插件更新失败：' + (lastErr?.message || lastErr))
  }
}

import Config from './Config.js'

/**
 * 获取插件全局配置
 * @returns {Object} 当前 qunliao-plugin 配置对象
 */
export function getGlobalConfig () {
  return Config.getConfig('config') || {}
}

/**
 * 获取指定模块的配置
 * @param {string} moduleKey - 模块名，对应 YAML 中的节（如 'dailyNews'、'goodNight'）
 * @returns {Object} 该模块的配置对象（保证不为 undefined）
 */
export function getModuleConfig (moduleKey) {
  const cfg = getGlobalConfig()
  return cfg[moduleKey] || {}
}

/**
 * 检查模块是否启用
 * @param {string} moduleKey - 模块名
 * @returns {boolean} true=启用，false=禁用
 */
export function isModuleEnabled (moduleKey) {
  const m = getModuleConfig(moduleKey)
  // 缺省视为启用（保留向后兼容）
  return m.enabled !== false
}

/**
 * 解析白名单群列表（支持 string[] / number[] / 混合数组）
 * 规则：
 *   - 模块的 onlyGroupID 有值 → 使用模块的
 *   - 模块的 onlyGroupID 为空 → 使用全局 onlyGroupID
 *   - 两者都为空 → 视为所有群都允许（返回 null，由调用方判断）
 * @param {string} moduleKey - 模块名
 * @returns {string[]|null} 允许的群号数组；null 表示不限制
 */
export function getOnlyGroupIDs (moduleKey) {
  const m = getModuleConfig(moduleKey)
  let ids = null
  if (Array.isArray(m.onlyGroupID) && m.onlyGroupID.length > 0) {
    ids = m.onlyGroupID
  } else {
    const g = getGlobalConfig()
    if (Array.isArray(g.onlyGroupID) && g.onlyGroupID.length > 0) {
      ids = g.onlyGroupID
    }
  }
  if (!ids) return null
  return ids.map((id) => String(id).trim()).filter(Boolean)
}

/**
 * 校验当前消息事件是否被白名单允许
 * @param {object} e - Yunzai 消息事件对象
 * @param {string} moduleKey - 模块名
 * @returns {boolean} true=允许处理；false=该群不在白名单内
 */
export function isGroupAllowed (e, moduleKey) {
  const allowed = getOnlyGroupIDs(moduleKey)
  if (!allowed) return true // 未配置白名单 → 所有群允许
  const gid = e?.group_id || e?.group?.group_id || e?.group?.gid ||
    (typeof e?.getGroupId === 'function' ? e.getGroupId() : null)
  if (!gid) return true // 私聊等无 group_id 的场景默认允许
  const gidStr = String(gid)
  // 8888 是锅巴/本插件约定的"私聊"标识
  if (allowed.includes('8888') && !e?.group_id) return true
  return allowed.includes(gidStr)
}

/**
 * 获取请求超时时间（毫秒）
 * @returns {number}
 */
export function getRequestTimeout () {
  const cfg = getGlobalConfig()
  const t = Number(cfg.requestTimeoutMs)
  return isFinite(t) && t > 0 ? t : 15000
}

/**
 * 获取 User-Agent
 * @returns {string}
 */
export function getUserAgent () {
  const cfg = getGlobalConfig()
  return cfg.userAgent || 'YunzaiBot/3.0 qunliao-plugin/1.0'
}

/**
 * 统一的 fetch 包装（注入超时 & User-Agent）
 * 优先使用 Node 原生 fetch（Node 18+ 内置），不可用时回退到 node-fetch
 * @param {string} url
 * @param {object} [opts] - 额外 fetch 选项
 * @returns {Promise<Response>}
 */
export async function httpFetch (url, opts) {
  const timeout = getRequestTimeout()
  const headers = Object.assign({}, opts && opts.headers, { 'User-Agent': getUserAgent() })
  const merged = Object.assign({}, opts, { headers })

  // Node 18+ 有全局 fetch 可用——优先使用，避免 node-fetch 依赖缺失
  if (typeof globalThis.fetch === 'function' && typeof AbortController === 'function') {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    merged.signal = ctrl.signal
    try {
      const res = await globalThis.fetch(url, merged)
      clearTimeout(timer)
      return res
    } catch (err) {
      clearTimeout(timer)
      throw err
    }
  }

  // 回退到 node-fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  merged.signal = ctrl.signal
  try {
    const fetch = (await import('node-fetch')).default
    const res = await fetch(url, merged)
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/**
 * 取模块配置中的字符串数组（如关键词），容错处理
 * @param {string} moduleKey
 * @param {string} fieldKey
 * @param {string[]} fallback
 * @returns {string[]}
 */
export function getStringList (moduleKey, fieldKey, fallback) {
  const m = getModuleConfig(moduleKey)
  const v = m[fieldKey]
  if (Array.isArray(v) && v.length > 0) return v.map(String)
  if (typeof v === 'string' && v.trim()) return v.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  return Array.isArray(fallback) ? fallback : []
}

/**
 * 取模块配置中的字符串，返回 trim 后的值；若无效则用 fallback
 * @param {string} moduleKey
 * @param {string} fieldKey
 * @param {string} [fallback]
 * @returns {string}
 */
export function getString (moduleKey, fieldKey, fallback) {
  const m = getModuleConfig(moduleKey)
  const v = m[fieldKey]
  if (typeof v === 'string' && v.trim()) return v.trim()
  return fallback || ''
}

/**
 * 取模块配置中的数字
 * @param {string} moduleKey
 * @param {string} fieldKey
 * @param {number} fallback
 * @returns {number}
 */
export function getNumber (moduleKey, fieldKey, fallback) {
  const m = getModuleConfig(moduleKey)
  const v = Number(m[fieldKey])
  return isFinite(v) ? v : Number(fallback)
}

/**
 * 取模块配置中的布尔值
 * @param {string} moduleKey
 * @param {string} fieldKey
 * @param {boolean} [fallback=true]
 * @returns {boolean}
 */
export function getBoolean (moduleKey, fieldKey, fallback) {
  const m = getModuleConfig(moduleKey)
  const v = m[fieldKey]
  if (v === true || v === false) return v
  if (typeof v === 'string') {
    if (/^(true|yes|on|1)$/i.test(v)) return true
    if (/^(false|no|off|0)$/i.test(v)) return false
  }
  return fallback !== undefined ? !!fallback : true
}

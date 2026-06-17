import YAML from 'yaml'
import fs from 'node:fs'
import path from 'node:path'
import { pluginConfigDir } from '../model/path.js'

/**
 * 安全的 logger 访问：优先使用 Yunzai 全局 logger，不可用时 fallback 到 console
 */
const logger = (() => {
  const g = globalThis
  const raw = g.logger || g.log || null
  if (raw && typeof raw === 'object') {
    return {
      warn: raw.warn ? raw.warn.bind(raw) : console.warn.bind(console),
      mark: raw.mark ? raw.mark.bind(raw) : console.log.bind(console),
      error: raw.error ? raw.error.bind(raw) : console.error.bind(console),
      debug: raw.debug ? raw.debug.bind(raw) : console.log.bind(console),
      info: raw.info ? raw.info.bind(raw) : console.log.bind(console)
    }
  }
  return {
    warn: console.warn.bind(console),
    mark: console.log.bind(console),
    error: console.error.bind(console),
    debug: console.log.bind(console),
    info: console.log.bind(console)
  }
})()

class Config {
  constructor() {
    this.configCache = {}
    this.initConfig()
    this.setupWatchers()
  }

  defPath(name) {
    return path.join(pluginConfigDir, `${name}_default.yaml`)
  }

  cfgPath(name) {
    return path.join(pluginConfigDir, `${name}.yaml`)
  }

  initConfig() {
    try {
      const def = this.defPath('config')
      const cur = this.cfgPath('config')

      if (!fs.existsSync(pluginConfigDir)) {
        fs.mkdirSync(pluginConfigDir, { recursive: true })
      }
      if (fs.existsSync(def) && !fs.existsSync(cur)) {
        fs.copyFileSync(def, cur)
        logger.mark('[qunliao-plugin] 已从默认配置生成 config.yaml')
      }
    } catch (err) {
      logger.warn(`[qunliao-plugin] 初始化配置目录失败：${err?.message || err}`)
    }
  }

  getConfig(configName = 'config') {
    if (this.configCache[configName]) {
      return this.deepClone(this.configCache[configName])
    }

    let cfg = null

    // 1) 读取用户配置
    try {
      const p = this.cfgPath(configName)
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8')
        cfg = YAML.parse(raw) || {}
      }
    } catch (err) {
      logger.warn(`[qunliao-plugin] 读取 ${configName}.yaml 失败：${err?.message || err}`)
    }

    // 2) 用户配置不存在或为空时，回落到默认配置
    if (!cfg || Object.keys(cfg).length === 0) {
      try {
        const p = this.defPath(configName)
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf-8')
          cfg = YAML.parse(raw) || {}
        }
      } catch (err) {
        logger.warn(`[qunliao-plugin] 读取默认配置失败：${err?.message || err}`)
      }
    }

    // 3) 与默认配置合并（补齐缺失字段，确保结构完整）
    try {
      const def = this.getDefConfig(configName)
      if (def && Object.keys(def).length > 0) {
        cfg = this.mergeDefault(cfg || {}, def)
      }
    } catch (_) { /* 合并失败则直接用 cfg */ }

    cfg = cfg || {}
    this.configCache[configName] = cfg
    return this.deepClone(cfg)
  }

  getDefConfig(configName = 'config') {
    try {
      const p = this.defPath(configName)
      if (!fs.existsSync(p)) return null
      const raw = fs.readFileSync(p, 'utf-8')
      return YAML.parse(raw) || {}
    } catch (err) {
      logger.warn(`[qunliao-plugin] 读取默认配置失败：${err?.message || err}`)
      return null
    }
  }

  setConfig(data, configName = 'config') {
    try {
      const p = this.cfgPath(configName)
      const dir = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      const toSave = this.deepClone(data)
      fs.writeFileSync(p, YAML.stringify(toSave))

      this.configCache[configName] = toSave
      logger.mark(`[qunliao-plugin] 配置 ${configName}.yaml 已保存`)
      return true
    } catch (err) {
      logger.error(`[qunliao-plugin] 写入配置失败：${err?.message || err}`)
      return false
    }
  }

  setupWatchers() {
    try {
      if (!fs.existsSync(pluginConfigDir)) return

      const files = fs.readdirSync(pluginConfigDir).filter(f => f.endsWith('.yaml'))

      files.forEach(file => {
        const name = file.replace(/\.yaml$/, '').replace(/_default$/, '')
        const fullPath = path.join(pluginConfigDir, file)

        try {
          fs.watch(fullPath, () => {
            delete this.configCache[name]
            delete this.configCache['config']
            logger.debug(`[qunliao-plugin] 配置变化，缓存已清除`)
          })
        } catch (_) { /* ignore */ }
      })
    } catch (err) {
      logger.debug(`[qunliao-plugin] 设置监听失败：${err?.message || err}`)
    }
  }

  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(item => this.deepClone(item))
    const out = {}
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        out[k] = this.deepClone(obj[k])
      }
    }
    return out
  }

  mergeDefault(user, def) {
    if (!user || typeof user !== 'object') user = {}
    if (!def || typeof def !== 'object') return user
    const out = this.deepClone(user)
    for (const k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue
      if (!(k in out) || out[k] === undefined || out[k] === null) {
        out[k] = this.deepClone(def[k])
      } else if (typeof def[k] === 'object' && typeof out[k] === 'object' && !Array.isArray(def[k]) && !Array.isArray(out[k])) {
        out[k] = this.mergeDefault(out[k], def[k])
      }
    }
    return out
  }
}

export default new Config()

import plugin from '../../../lib/plugins/plugin.js'
import {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  httpFetch
} from '../components/ModuleHelper.js'

const _MODULE_KEY = 'dujitang'

export class DuJiTang extends plugin {
  constructor () {
    super({
      name: '毒鸡汤',
      dsc: '来一碗毒鸡汤',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#毒鸡汤$|^毒鸡汤$', fnc: 'getDJT' },
        { reg: '来碗鸡汤', fnc: 'getDJT' }
      ]
    })
  }

  async getDJT () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('「毒鸡汤」功能已在配置中禁用')
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      return this.reply('当前群未在白名单内，无法使用毒鸡汤')
    }
    const apiList = (() => {
      const configured = getString(_MODULE_KEY, 'apiUrl', '')
      const secondary = getString(_MODULE_KEY, 'apiUrl2', '')
      // 内置兜底 API 池（始终可用，即使配置 API 出错）
      const builtIn = [
        'https://api.suyanw.cn/api/djt.php',
        'https://api.suyanw.cn/api/djt2.php',
        'https://v2.xxapi.cn/api/dujitang'
      ]
      // 用户配置优先，内置兜底在后；去重避免重复请求
      const list = []
      if (configured) list.push(configured)
      if (secondary) list.push(secondary)
      for (const url of builtIn) {
        if (!list.includes(url)) list.push(url)
      }
      return list
    })()

    // 日志：输出当前使用的 API 列表，便于排查
    if (typeof logger !== 'undefined' && logger.mark) {
      logger.mark(`[dujitang] API 列表: ${apiList.join(', ')}`)
    } else {
      console.log('[dujitang] API 列表:', apiList.join(', '))
    }

    const shuffled = [...apiList].sort(() => Math.random() - 0.5)
    const log = (msg) => {
      if (typeof logger !== 'undefined' && logger.mark) logger.mark(msg)
      else console.log(msg)
    }
    const logWarn = (msg) => {
      if (typeof logger !== 'undefined' && logger.warn) logger.warn(msg)
      else console.warn(msg)
    }

    for (const url of shuffled) {
      try {
        log(`[dujitang] 尝试请求: ${url}`)
        const resp = await httpFetch(url)
        if (!resp.ok) {
          logWarn(`[dujitang] HTTP ${resp.status} -> ${url}`)
          continue
        }
        // 先读文本，再尝试 JSON 解析（兼容纯文本 & JSON 两种返回格式）
        const rawText = await resp.text()
        let content = (rawText || '').trim()
        if (!content) {
          logWarn(`[dujitang] 响应为空: ${url}`)
          continue
        }
        try {
          const json = JSON.parse(content)
          if (json && typeof json === 'object') {
            // JSON API：检查 code 状态 + 只取 data 字段（msg 可能是错误提示）
            if (json.code !== undefined && json.code !== 200) {
              logWarn(`[dujitang] API 返回错误状态: code=${json.code}, msg=${json.msg || '(none)'}`)
              continue
            }
            content = json.data ? String(json.data).trim() : ''
            if (!content) {
              logWarn(`[dujitang] JSON data 字段为空: ${url}`)
              continue
            }
          }
        } catch (e) {
          // 不是 JSON，直接用原始文本 —— 记录一下以便确认解析路径
          log(`[dujitang] 按纯文本处理 (${Math.min(content.length, 80)} 字符): ${url}`)
        }
        if (content) {
          log(`[dujitang] 成功获取文案: "${content.substring(0, 40)}${content.length > 40 ? '...' : ''}"`)
          return this.reply(content)
        }
      } catch (err) {
        logWarn(`[dujitang] ${url} 请求失败: ${err.message || err}`)
      }
    }
    logWarn('[dujitang] 所有 API 均失败，返回兜底文案')
    return this.reply('毒鸡汤喝完了，下次再来吧')
  }
}

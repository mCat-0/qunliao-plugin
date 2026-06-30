import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  isGroupAllowed,
  getString,
  httpFetch
} = await import('../components/ModuleHelper.js')

const { getMemberName, getSenderName } = await import('../components/GroupMember.js')

const _MODULE_KEY = 'marriageCertificate'

function detectAtQQ (e) {
  if (!e) return null
  const arrFields = ['at', 'ats', 'atList', 'at_list']
  for (const field of arrFields) {
    const arr = e[field]
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0]
      if (first) {
        if (typeof first === 'object' && first !== null) {
          const qq = first.qq || first.id || first.user_id || first.userId
          if (qq) return String(qq)
        } else if (typeof first === 'string' || typeof first === 'number') {
          return String(first)
        }
      }
    }
  }
  const singleFields = ['at_user', 'atUser', 'at_qq', 'atQq']
  for (const field of singleFields) {
    const v = e[field]
    if (v) return String(v)
  }
  if (Array.isArray(e.message)) {
    for (const seg of e.message) {
      if (!seg) continue
      const type = String(seg.type || seg.msg_type || '').toLowerCase()
      if (type === 'at' || type === 'mention') {
        const data = seg.data || seg
        const qq = data.qq || data.id || data.user_id || data.userId || data.uid || data.qqu
        if (qq) return String(qq)
      }
    }
  }
  const msg = (e?.msg || e?.raw_message || '').toString()
  const cqMatch = msg.match(/\[CQ:at[^]]*qq=(\d+)/i)
  if (cqMatch && cqMatch[1]) return cqMatch[1]
  const xmlMatch = msg.match(/<at[^>]*?\s(?:qq|id)=["']?(\d+)/i)
  if (xmlMatch && xmlMatch[1]) return xmlMatch[1]
  return null
}

function extractTextPartner (msg) {
  const clean = msg
    .replace(/\[CQ:[^\]]*\]/gi, '')
    .replace(/<at[^>]*>/gi, '')
    .replace(/@[^\s@,，。！!？?\[\]|]+/g, '')
    .trim()
  const m1 = clean.match(/^我(要)?(和|跟)([\u4e00-\u9fa5A-Za-z0-9_\- ]{1,20}?)(结婚了|结婚|去结婚|结婚啦)/)
  if (m1 && m1[3]) {
    const name = m1[3].trim()
    if (name && name !== '你结婚') return name
  }
  const m2 = clean.match(/(我和|我跟|我要和|我要跟)([^结婚，,。！!？?@\s]{1,20})(结婚)/)
  if (m2 && m2[2]) {
    const name = m2[2].trim()
    if (name) return name
  }
  return null
}

async function extractPartnerName (e) {
  const msg = (e?.msg || e?.raw_message || e?.message || '').toString()
  const atQQ = detectAtQQ(e)

  if (atQQ) {
    try {
      const name = await getMemberName(e, atQQ)
      if (name && name !== atQQ) {
        return { source: 'at', name, qq: atQQ }
      }
    } catch (_) {}
    const textName = extractTextPartner(msg)
    if (textName) {
      return { source: 'text', name: textName, qq: atQQ }
    }
    return { source: 'at', name: atQQ, qq: atQQ }
  }

  const textName = extractTextPartner(msg)
  if (textName) {
    return { source: 'text', name: textName, qq: null }
  }
  return { source: 'none', name: null, qq: null }
}

function buildApiUrl (n1, n2, baseUrl) {
  const base = baseUrl || 'https://www.hhlqilongzhu.cn/api/tu_jiehunzheng.php'
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}n1=${encodeURIComponent(n1)}&n2=${encodeURIComponent(n2)}`
}

export class MarriageCertificate extends plugin {
  constructor () {
    super({
      name: '结婚证',
      dsc: '生成结婚证图片',
      event: 'message',
      priority: 50,
      rule: [
        { reg: /^我(要)?(和|跟)[\s\S]{0,40}?(结婚了|结婚|结婚啦|去结婚)/, fnc: 'handleMarriage' }
      ]
    })
  }

  async handleMarriage () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('「结婚证」功能已在配置中禁用')
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      return this.reply('当前群未在白名单内，无法使用结婚证')
    }

    const senderName = getSenderName(this.e)
    const partner = await extractPartnerName(this.e)

    if (!partner.name) {
      return this.reply('没能识别出结婚对象，请使用：「我和张三结婚了」或「我要和@李四结婚」')
    }

    try {
      const apiBase = getString(
        _MODULE_KEY,
        'apiUrl',
        'https://www.hhlqilongzhu.cn/api/tu_jiehunzheng.php'
      )
      const imageUrl = buildApiUrl(senderName, partner.name, apiBase)

      const resp = await httpFetch(imageUrl)
      if (!resp || !resp.ok) {
        return this.reply(`接口请求失败：HTTP ${resp ? resp.status : '无响应'}`)
      }

      const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || ''
      if (!/image|octet-stream/i.test(ct)) {
        return this.reply('接口返回异常，未能获取图片')
      }

      return this.reply(segment.image(imageUrl))
    } catch (err) {
      logger.error(`[${_MODULE_KEY}] request error: ${err?.message || err}`)
      return this.reply(`生成结婚证失败：${err?.message || err}`)
    }
  }
}

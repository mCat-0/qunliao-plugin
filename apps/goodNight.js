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
  getNumber,
  getBoolean,
  getStringList,
  httpFetch
} = await import('../components/ModuleHelper.js')

const _MODULE_KEY = 'goodNight'
const DEFAULT_GOOD_NIGHT_KW = [
  '睡觉了', '我要睡了', '晚安', '我要休息了',
  'good night', 'goodnight', 'gn', '晚安喵'
]
const DEFAULT_GOOD_MORNING_KW = [
  '早安', '早上好', '起床', '睡醒了', '早',
  'good morning', 'morning', '早喵', '早呀', '早~', '早上好呀'
]

const PROCESSED_MSG_IDS = new Set()
const MAX_CACHED_IDS = 200

function markAndCheckProcessed (e) {
  const mid = e.message_id || e.msg_id ||
    (e.user_id && e.time ? `${e.user_id}_${e.time}` : null)
  if (!mid) return false
  if (PROCESSED_MSG_IDS.has(mid)) return true
  PROCESSED_MSG_IDS.add(mid)
  if (PROCESSED_MSG_IDS.size > MAX_CACHED_IDS) {
    const arr = Array.from(PROCESSED_MSG_IDS)
    for (let i = 0; i < arr.length - MAX_CACHED_IDS; i++) {
      PROCESSED_MSG_IDS.delete(arr[i])
    }
  }
  return false
}

function containsAny (text, words) {
  if (!text) return false
  const low = text.toLowerCase()
  return words.some((w) => {
    if (!w) return false
    return low.includes(w.toLowerCase())
  })
}

function isMeaningfulText (v) {
  if (!v || typeof v !== 'string') return false
  const trimmed = v.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  if (['success', 'ok', 'true', 'false', 'null', 'error', 'fail'].includes(lower)) return false
  return /[\u4e00-\u9fa5]/.test(trimmed) || trimmed.length >= 8
}

function extractGreeting (payload, depth) {
  depth = depth || 0
  if (depth > 4) return null
  if (!payload) return null
  if (typeof payload === 'string') return isMeaningfulText(payload) ? payload.trim() : null
  if (typeof payload !== 'object') return null
  const contentFields = ['content', 'content_text', 'contentMsg', 'text', 'message', 'greeting', 'reply', 'answer', 'msg']
  for (const f of contentFields) {
    if (isMeaningfulText(payload[f])) return payload[f].trim()
  }
  const containerKeys = ['data', 'result', 'payload', 'body']
  for (const k of containerKeys) {
    if (payload[k] && typeof payload[k] === 'object') {
      const inner = extractGreeting(payload[k], depth + 1)
      if (inner) return inner
    }
  }
  const values = Object.values(payload)
  for (const v of values) {
    if (isMeaningfulText(v)) return v.trim()
  }
  for (const v of values) {
    if (v && typeof v === 'object') {
      const inner = extractGreeting(v, depth + 1)
      if (inner) return inner
    }
  }
  return null
}

async function fetchGreeting (url, fallback) {
  try {
    logger.mark(`[goodNight] calling: ${url}`)
    const res = await httpFetch(url)
    if (!res || !res.ok) {
      logger.warn(`[goodNight] API HTTP error: ${res?.status || 'unknown'}`)
      return fallback
    }

    // --- 检测是否 JSON ---
    let isJson = false
    try {
      // 方式1: Headers 类的 get 方法
      if (res.headers && typeof res.headers.get === 'function') {
        const ct = res.headers.get('content-type') || ''
        isJson = ct.includes('application/json') || ct.includes('/json')
      }
      // 方式2: 直接访问 content-type 属性
      if (!isJson && res.headers) {
        const ct = res.headers['content-type'] || res.headers['Content-Type'] || ''
        isJson = String(ct).includes('json')
      }
    } catch (e) { /* ignore */ }

    let text = null
    if (isJson) {
      const json = await res.json()
      logger.mark(`[goodNight] API response type: JSON, raw keys: ${Object.keys(json || {}).join(', ')}`)
      text = extractGreeting(json)
    } else {
      // 不是明显的 JSON？先读文本，再尝试用 JSON 解析（有些 API 返回 JSON 但 content-type 是 text/plain）
      const raw = await res.text()
      logger.mark(`[goodNight] API response type: text, preview: ${String(raw || '').slice(0, 120)}`)
      // 尝试把文本当 JSON 解析
      let json = null
      const trimmed = (raw || '').trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { json = JSON.parse(trimmed) } catch (_) { json = null }
      }
      if (json) {
        text = extractGreeting(json)
      } else {
        text = isMeaningfulText(raw) ? raw.trim() : null
      }
    }

    if (text) {
      logger.mark(`[goodNight] extracted text: ${text.slice(0, 80)}`)
    } else {
      logger.warn(`[goodNight] failed to extract text, using fallback: ${fallback}`)
    }
    return text || fallback
  } catch (err) {
    logger.warn(`[goodNight] API request failed: ${url} - ${err?.message || err}`)
    return fallback
  }
}

async function sendReply (e, text) {
  if (!text) return
  const message = String(text)

  // 方式1: e.reply (最常见)
  try {
    if (e && typeof e.reply === 'function') {
      const r = await e.reply(message)
      logger.mark(`[goodNight] sent via e.reply`)
      return r
    }
  } catch (err1) {
    logger.warn(`[goodNight] e.reply failed: ${err1?.message}`)
  }

  // 方式2: e.bot.sendGroupMsg
  try {
    if (e?.bot && typeof e.bot.sendGroupMsg === 'function') {
      const gid = e.group_id || e.group?.group_id || e.group?.gid
      if (gid) {
        const r = await e.bot.sendGroupMsg(gid, message)
        logger.mark(`[goodNight] sent via e.bot.sendGroupMsg`)
        return r
      }
    }
  } catch (err2) {
    logger.warn(`[goodNight] e.bot.sendGroupMsg failed: ${err2?.message}`)
  }

  // 方式3: 全局 Bot.sendGroupMsg
  try {
    const _Bot = typeof Bot !== 'undefined' ? Bot : null
    if (_Bot && typeof _Bot.sendGroupMsg === 'function') {
      const gid = e?.group_id || e?.group?.group_id || e?.group?.gid
      if (gid) {
        const r = await _Bot.sendGroupMsg(gid, message)
        logger.mark(`[goodNight] sent via Bot.sendGroupMsg`)
        return r
      }
    }
  } catch (err3) {
    logger.warn(`[goodNight] Bot.sendGroupMsg failed: ${err3?.message}`)
  }

  // 方式4: Bot.pickGroup(gid).sendMsg
  try {
    const _Bot = typeof Bot !== 'undefined' ? Bot : null
    if (_Bot && typeof _Bot.pickGroup === 'function') {
      const gid = e?.group_id || e?.group?.group_id || e?.group?.gid
      if (gid) {
        const group = await _Bot.pickGroup(gid)
        if (group && typeof group.sendMsg === 'function') {
          const r = await group.sendMsg(message)
          logger.mark(`[goodNight] sent via Bot.pickGroup.sendMsg`)
          return r
        }
      }
    }
  } catch (err4) {
    logger.warn(`[goodNight] Bot.pickGroup.sendMsg failed: ${err4?.message}`)
  }

  logger.error(`[goodNight] all reply methods failed`)
}

function getUserId (e) {
  return e.user_id || e.sender?.user_id ||
    (typeof e.getUserId === 'function' ? e.getUserId() : null)
}

function getGroupId (e) {
  return e.group_id || e.group?.group_id || e.group?.gid ||
    (typeof e.getGroupId === 'function' ? e.getGroupId() : null)
}

async function muteUser (e, userId, groupId, seconds) {
  try {
    const safeSeconds = Math.max(60, Math.min(Number(seconds) || 28800, 2592000))
    if (e.group && typeof e.group.muteMember === 'function') {
      await e.group.muteMember(userId, safeSeconds)
    } else if (e.bot && typeof e.bot.muteMember === 'function') {
      await e.bot.muteMember(groupId, userId, safeSeconds)
    } else if (e.bot && e.bot.Api && typeof e.bot.Api.sendGroupBan === 'function') {
      await e.bot.Api.sendGroupBan(groupId, userId, safeSeconds)
    } else if (typeof Bot !== 'undefined' && Bot.pickGroup) {
      const group = Bot.pickGroup(groupId)
      if (group && typeof group.muteMember === 'function') {
        await group.muteMember(userId, safeSeconds)
      }
    } else {
      logger.warn('[goodNight] mute not supported in current environment')
    }
  } catch (err) {
    logger.warn('[goodNight] mute failed (bot may lack admin permission):', err?.message)
  }
}

export class GoodNight extends plugin {
  constructor () {
    super({
      name: '早晚安',
      dsc: '识别晚安/早安关键词并回复，晚安可对用户禁言',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '.+', fnc: 'onMessage', log: false }
      ]
    })
  }

  async onMessage (e) {
    if (!isModuleEnabled(_MODULE_KEY)) return false
    if (!isGroupAllowed(e, _MODULE_KEY)) return false

    let text = (e.msg || e.raw_message || e.message || '').trim()

    // 从图片消息中抽取 summary（表情包自带的文字标签）
    // 例如：[CQ:image,summary=&#91;早&#93;,file=...gif,...]
    //       [CQ:image,summary=早上好呀,file=...]
    // 把它拼进 text，以便下方的关键词/单字检测都能命中
    const imageSummaries = []
    try {
      const raw = e.raw_message || ''
      const re = /summary=([^,\]]*)/gi
      let m
      while ((m = re.exec(raw)) !== null) {
        try {
          // &#91; -> [  &#93; -> ]，做一次简单的 HTML 实体解码
          const dec = decodeURIComponent(
            (m[1] || '')
              .replace(/&#(\d+);/g, (_, $1) => String.fromCharCode(Number($1)))
          )
          if (dec) imageSummaries.push(dec)
        } catch (_) {
          if (m[1]) imageSummaries.push(m[1])
        }
      }
      // 也从 e.message 对象里抓 summary（部分适配器的图片元素结构）
      const msgArr = Array.isArray(e.message) ? e.message : []
      for (const seg of msgArr) {
        if (seg && (seg.type === 'image' || seg.type === 'face')) {
          const s = (seg.data && seg.data.summary) || seg.summary
          if (s) imageSummaries.push(s)
        }
      }
    } catch (_) { /* ignore */ }

    if (imageSummaries.length) {
      // 把表情包文字拼进来，避免影响原有"仅包含关键词"的判断
      text = (text + '\n' + imageSummaries.join('\n')).trim()
    }

    if (!text) return false

    const senderId = getUserId(e)
    const selfId = e.self_id
    const botUin = typeof Bot !== 'undefined' ? Bot.uin : null
    const postType = e.post_type
    if (postType === 'message_sent' ||
      (selfId && senderId && String(selfId) === String(senderId)) ||
      (botUin && senderId && String(botUin) === String(senderId))) {
      return false
    }

    if (markAndCheckProcessed(e)) return false

    const goodNightKeywords = getStringList(
      _MODULE_KEY, 'goodNightKeywords', DEFAULT_GOOD_NIGHT_KW
    )
    const goodMorningKeywords = getStringList(
      _MODULE_KEY, 'goodMorningKeywords', DEFAULT_GOOD_MORNING_KW
    )

    // 晚安：只要文本中包含「晚安」即触发，不做分隔符判断
    // 早 / 早安：前后需为分隔符才触发，避免「早餐 / 早已 / 早晚」等正常词误触发
    // 分隔符号 = 中英文标点、括号、波浪线、斜杠、空格、空串边界等
    const SEP = '\\s\\u00a0\\u3000!！?？。.,，、；;:/\\\\、·\\-—_=+|@#$%^&*(){}<>\\[\\]\'"`（）【】《》「」『』~'
    const ZAO_RE = new RegExp('(^|[' + SEP + '])早([' + SEP + ']|$)')

    if (ZAO_RE.test(text)) {
      await this.handleGoodMorning(e)
      return true
    }

    if (containsAny(text, goodNightKeywords)) {
      await this.handleGoodNight(e)
      return true
    }
    if (containsAny(text, goodMorningKeywords)) {
      await this.handleGoodMorning(e)
      return true
    }
    return false
  }

  async handleGoodNight (e) {
    const apiUrl = getString(
      _MODULE_KEY, 'goodNightAPI', 'https://api.ruseo.cn/api/wanan'
    )
    let replyText = await fetchGreeting(apiUrl, '晚安！')
    if (!replyText.includes('晚安')) replyText = replyText + '\n晚安！'
    logger.mark(`[goodNight] reply: ${replyText.slice(0, 80)}`)
    await sendReply(e, replyText)

    const muteEnabled = getBoolean(_MODULE_KEY, 'muteEnabled', true)
    if (!muteEnabled) return
    const userId = getUserId(e)
    const groupId = getGroupId(e)
    if (groupId && userId) {
      const seconds = getNumber(_MODULE_KEY, 'muteSeconds', 28800)
      await muteUser(e, userId, groupId, seconds)
      logger.mark(`[goodNight] user ${userId} muted for ${seconds}s in group ${groupId}`)
    }
  }

  async handleGoodMorning (e) {
    const apiUrl = getString(
      _MODULE_KEY, 'goodMorningAPI', 'https://api.ruseo.cn/api/zaoan'
    )
    let replyText = await fetchGreeting(apiUrl, '早安！')
    if (!replyText.includes('早安') && !replyText.includes('早上好')) {
      replyText = replyText + '\n' + (Math.random() > 0.5 ? '早安！' : '早上好！')
    }
    logger.mark(`[goodNight] reply: ${replyText.slice(0, 80)}`)
    await sendReply(e, replyText)
  }
}

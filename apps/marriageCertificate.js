import plugin from '../../../lib/plugins/plugin.js'
import {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  httpFetch
} from '../components/ModuleHelper.js'

const _MODULE_KEY = 'marriageCertificate'

/**
 * 安全获取日志函数（兼容不同环境）
 */
function _log (level, ...args) {
  try {
    const g = globalThis
    const logger = g.logger || g.log || g.console
    if (logger && typeof logger[level] === 'function') {
      logger[level](`[${_MODULE_KEY}]`, ...args)
    }
  } catch (_) { /* noop */ }
}

/**
 * 从消息事件中获取发送者的显示名
 * 优先使用群名片（card），其次是昵称（nickname），最后回落到 QQ 号
 */
function getSenderName (e) {
  const sender = e?.sender || {}
  if (sender.card && String(sender.card).trim()) return String(sender.card).trim()
  if (sender.card_name && String(sender.card_name).trim()) return String(sender.card_name).trim()
  if (sender.nickname && String(sender.nickname).trim()) return String(sender.nickname).trim()
  if (sender.nick && String(sender.nick).trim()) return String(sender.nick).trim()
  if (sender.name && String(sender.name).trim()) return String(sender.name).trim()
  if (sender.user_id) return String(sender.user_id)
  if (e?.user_id) return String(e.user_id)
  return '未知'
}

/**
 * 根据 QQ 号在群内查询群名片
 * 兼容 Yunzai/TRSS/Miao/Karin 等多种框架
 *
 * 查询策略（按优先级）：
 *   1) e.group.pickMember/getMember/getMemberInfo — TRSS 标准
 *   2) e.group.members Map / 对象 — 群成员缓存
 *   3) Bot.getGroupMemberInfo(gid, qq) / Bot.pickGroup(gid).pickMember(qq) — 全局 Bot
 *   4) e.bot.getGroupMemberInfo(gid, qq) — 消息级 bot
 *   5) e.message / e.at 对象数组中自带 name 字段 — 框架内联信息
 */
async function getGroupNameByQQ (e, qq) {
  if (!qq) return null
  const qqStr = String(qq)
  const gid = e?.group_id || e?.group_id || e?.gid
    || (e?.group && (e.group.group_id || e.group.gid || e.group.id || e.group.groupid))
    || null

  // 提取群名 —— 后面所有解析都要排除这个值，防止把"群名"当成成员群名片
  const groupName = (function () {
    const candidates = [e?.group, e]
    const nameFields = ['name', 'group_name', 'groupName', 'groupname', 'title', 'group_title']
    for (const cand of candidates) {
      if (!cand) continue
      for (const f of nameFields) {
        const v = cand[f]
        if (v && typeof v !== 'function' && String(v).trim()) return String(v).trim()
      }
    }
    return null
  })()

  _log('debug', `查群名片 qq=${qqStr} gid=${gid} e.group=${!!e?.group} groupName=${groupName || '(未知)'}`)

  // ============================================================
  // 方法 1: 通过 e.group 直接查询
  // ============================================================
  try {
    const group = e?.group
    if (group) {
      // 1a) 常见方法名调用（同步 + async 都支持，因为 await 对非 Promise 值也有效）
      const memberFns = [
        'pickMember', 'getMember', 'getMemberInfo',
        'get_member_info', 'fetchMember', 'getGroupMemberInfo',
        'get_member', 'getMemberList', 'get_member_list',
        'getMemberInfoByUin', 'getGroupMemberByUin'
      ]
      let member = null
      for (const fn of memberFns) {
        if (typeof group[fn] !== 'function') continue
        try {
          member = await group[fn](qqStr)
          if (member) { _log('debug', `e.group.${fn}() 成功`); break }
        } catch (err) { _log('debug', `e.group.${fn}() err=${err?.message || err}`) }
      }

      // 1b) members Map / 普通对象
      if (!member && group.members) {
        try {
          if (typeof group.members.get === 'function') {
            member = await group.members.get(qqStr)
          } else if (typeof group.members === 'object' && group.members[qqStr]) {
            member = group.members[qqStr]
          }
        } catch (err) { _log('debug', `e.group.members err=${err?.message || err}`) }
      }

      // 1c) 有些版本用 e.group.memberList / e.group.member_info 等字段
      if (!member) {
        const lists = ['memberList', 'member_list', 'member_list', 'members_list', 'memberInfoList', 'memberInfos']
        for (const listField of lists) {
          const list = group[listField]
          if (Array.isArray(list)) {
            const found = list.find(m => String(m.qq || m.user_id || m.userId || m.uin) === qqStr)
            if (found) { member = found; _log('debug', `e.group.${listField} 找到成员`); break }
          }
        }
      }

      // 1d) 探索式兜底：遍历 e.group 所有字段，找任何看起来像"成员集合"的东西
      //     用 e.sender 的字段结构做模板 —— 既然 e.sender 能拿到，说明同版本也能用
      if (!member) {
        const senderFields = Object.keys(e?.sender || {})
        // 先识别 e.sender 用哪个字段存 qq
        const senderQqField = senderFields.find(f =>
          ['user_id', 'userId', 'qq', 'uin', 'id'].includes(f) && e.sender[f]
        ) || null
        // 再识别 e.sender 用哪些字段存姓名/名片
        const senderNameFields = senderFields.filter(f =>
          ['card', 'card_name', 'nickname', 'nick', 'name'].includes(f) && e.sender[f]
        )

        for (const gkey of Object.keys(group)) {
          const gval = group[gkey]
          if (gval == null) continue
          if (typeof gval === 'function') continue   // 跳过方法（1a 已查）
          if (typeof gval !== 'object') continue

          // 1d-1) 对象是 Map：按 qq 查
          if (typeof gval.get === 'function') {
            try {
              const found = await gval.get(qqStr)
              if (found && typeof found === 'object') {
                member = found
                _log('debug', `1d 探索: e.group.${gkey} Map 找到 qq=${qqStr}`)
                break
              }
            } catch (_) {}
          }

          // 1d-2) 对象是数组：遍历找 qq 匹配项
          if (Array.isArray(gval) && gval.length > 0) {
            const found = gval.find(m => {
              if (!m || typeof m !== 'object') return false
              const mQq = m.qq || m.user_id || m.userId || m.uin || m.id
              return mQq && String(mQq) === qqStr
            })
            if (found) {
              member = found
              _log('debug', `1d 探索: e.group.${gkey} 数组找到 qq=${qqStr}`)
              break
            }
          }

          // 1d-3) 对象是普通对象：可能是 { qq1: member, qq2: member, ... }
          if (gval[qqStr] && typeof gval[qqStr] === 'object') {
            member = gval[qqStr]
            _log('debug', `1d 探索: e.group.${gkey}[${qqStr}] 对象找到`)
            break
          }
        }

        // 如果探索成功：尝试用 e.sender 同款字段名解析
        if (member && senderNameFields.length > 0) {
          for (const nf of senderNameFields) {
            const v = member[nf]
            if (v && String(v).trim()) {
              const trimmed = String(v).trim()
              if (trimmed !== groupName) {
                _log('debug', `用 e.sender 同款字段 ${nf} 解析: ${trimmed}`)
                return trimmed
              }
            }
          }
        }
      }

      // 1e) member 上拿 card / nickname（注意排除群名！）
      if (member) {
        const result = _getNameFromMember(member, groupName)
        if (result) {
          _log('debug', `群名片解析成功: ${result}`)
          return result
        }
        // member 对象存在但拿不到名字，打印一下看看它有啥字段
        _log('debug', `member 存在但无法解析名字, keys=${Object.keys(member).join(',')}`)
      }
    }
  } catch (err) {
    _log('debug', `e.group 整体异常: ${err?.message || err}`)
  }

  // ============================================================
  // 方法 2: 通过全局 Bot 对象查询
  // ============================================================
  if (gid) {
    try {
      const _Bot = typeof Bot !== 'undefined' ? Bot
        : typeof globalThis.Bot !== 'undefined' ? globalThis.Bot
        : typeof globalThis.bot !== 'undefined' ? globalThis.bot
        : typeof globalThis.Red !== 'undefined' ? globalThis.Red.Bot
        : null

      if (_Bot) {
        // 2a) Bot.getGroupMemberInfo(gid, qq) — Karin / 部分 TRSS 版本
        const directFns = [
          'getGroupMemberInfo', 'get_group_member_info',
          'getMemberInfo', 'getMember', 'pickMember',
          'getGroupMember', 'fetchMember'
        ]
        for (const fn of directFns) {
          if (typeof _Bot[fn] === 'function') {
            try {
              const m = await _Bot[fn](gid, qqStr)
              if (m) {
                const name = _getNameFromMember(m, groupName)
                if (name) { _log('debug', `Bot.${fn}() 成功: ${name}`); return name }
              }
            } catch (err) { _log('debug', `Bot.${fn}() err=${err?.message || err}`) }
          }
        }

        // 2b) pickGroup(gid) → pickMember(qq) — 标准 TRSS
        const groupFns = ['pickGroup', 'getGroup', 'get_group', 'pick_group']
        let groupObj = null
        for (const fn of groupFns) {
          if (typeof _Bot[fn] === 'function') {
            try { groupObj = await _Bot[fn](gid); if (groupObj) break } catch (_) {}
          }
        }
        if (!groupObj && _Bot.groups && typeof _Bot.groups.get === 'function') {
          try { groupObj = await _Bot.groups.get(gid) } catch (_) {}
        }
        if (groupObj) {
          const memFns = ['pickMember', 'getMember', 'getMemberInfo', 'get_member']
          for (const fn of memFns) {
            if (typeof groupObj[fn] === 'function') {
              try {
                const m = await groupObj[fn](qqStr)
                if (m) {
                  const name = _getNameFromMember(m, groupName)
                  if (name) { _log('debug', `Bot→group.${fn}() 成功: ${name}`); return name }
                }
              } catch (err) { _log('debug', `Bot→group.${fn}() err=${err?.message || err}`) }
            }
          }
          // 也试试 members Map
          if (groupObj.members && typeof groupObj.members.get === 'function') {
            try {
              const m = await groupObj.members.get(qqStr)
              if (m) {
                const name = _getNameFromMember(m, groupName)
                if (name) return name
              }
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      _log('debug', `Bot 查询异常: ${err?.message || err}`)
    }
  }

  // ============================================================
  // 方法 3: 消息级 bot (e.bot)
  // ============================================================
  if (gid && e?.bot) {
    try {
      const eBot = e.bot
      const directFns = ['getGroupMemberInfo', 'getGroupMember', 'getMemberInfo', 'pickMember', 'getMember']
      for (const fn of directFns) {
        if (typeof eBot[fn] === 'function') {
          try {
            const m = await eBot[fn](gid, qqStr)
            if (m) {
              const name = _getNameFromMember(m, groupName)
              if (name) return name
            }
          } catch (_) {}
        }
      }
    } catch (err) { _log('debug', `e.bot 查询异常: ${err?.message || err}`) }
  }

  // ============================================================
  // 方法 4: 如果拿不到群名片，试试从消息结构里解析 @ 对象里的 name
  // 一些框架会在 message 段里直接提供被 @ 人的显示名
  // ============================================================
  try {
    if (Array.isArray(e.message)) {
      for (const seg of e.message) {
        if (!seg) continue
        const type = String(seg.type || seg.msg_type || '').toLowerCase()
        if (type === 'at' || type === 'mention') {
          const data = seg.data || seg
          const segQq = data.qq || data.id || data.user_id || data.userId || data.uid || data.qqu
          if (segQq && String(segQq) === qqStr) {
            const name = data.name || data.nick || data.text || data.display_name || data.displayName
            if (name && String(name).trim()) {
              const trimmed = String(name).trim().replace(/^@/, '').trim()
              // 排除群名
              if (trimmed && trimmed !== groupName) return trimmed
            }
          }
        }
      }
    }
    // e.at 数组里可能有对象带 name
    if (Array.isArray(e.at)) {
      for (const item of e.at) {
        if (item && typeof item === 'object') {
          const itemQq = item.qq || item.id || item.user_id || item.userId
          if (itemQq && String(itemQq) === qqStr) {
            const name = item.name || item.nick || item.card || item.nickname || item.display_name
            if (name && String(name).trim()) {
              const trimmed = String(name).trim()
              if (trimmed !== groupName) return trimmed
            }
          }
        }
      }
    }
  } catch (_) { /* ignore */ }

  // ============================================================
  // 所有方法都失败 → dump e.group 结构让我们看该版本实际用什么字段
  // ============================================================
  try {
    const g = e?.group
    if (g) {
      const keys = Object.keys(g)
      const summary = {}
      for (const k of keys) {
        const v = g[k]
        const t = typeof v
        if (t === 'string' || t === 'number' || t === 'boolean') {
          summary[k] = String(v).slice(0, 80)
        } else if (t === 'function') {
          summary[k] = '[fn]'
        } else if (v && t === 'object') {
          if (typeof v.get === 'function') {
            try {
              summary[k] = `[Map size=${v.size}]`
              // 试取第一个元素看看结构
              let firstKey = null
              for (const mk of v.keys()) { firstKey = mk; break }
              if (firstKey) {
                const mv = v.get(firstKey)
                summary[k + '_first'] = mv ? Object.keys(mv).join(',') : 'null'
              }
            } catch (e2) { summary[k] = '[Map? err]' }
          } else if (Array.isArray(v)) {
            summary[k] = `[Array len=${v.length}]`
            if (v.length > 0 && v[0] && typeof v[0] === 'object') {
              summary[k + '_first'] = Object.keys(v[0]).join(',')
            }
          } else {
            summary[k] = `[Obj keys=${Object.keys(v).slice(0, 15).join(',')}]`
          }
        } else {
          summary[k] = String(v)
        }
      }
      _log('debug', `[调试] e.group 结构 dump: ${JSON.stringify(summary, null, 2)}`)
    }
    _log('debug', `[调试] e.sender 结构: ${JSON.stringify(e?.sender || {}, null, 2)}`)
    _log('debug', `[调试] e 顶层可用字段: ${Object.keys(e || {}).join(',')}`)
  } catch (err) {
    _log('debug', `[调试] dump 异常: ${err?.message || err}`)
  }
  _log('debug', `无法获取 ${qqStr} 的群名片，回落至 displayName/文本匹配`)
  return null
}

/**
 * 从 member 对象里尽量解析出群名片/昵称
 * 因为不同版本字段差异很大，这里把所有可能的字段都试一遍
 */
function _getNameFromMember (member, _excludeName) {
  if (!member) return null
  // member 可能直接是 { card, nickname }，也可能嵌套在 member.info / member.user / member.member 里
  const candidates = [member]
  if (member.info) candidates.push(member.info)
  if (member.member) candidates.push(member.member)
  if (member.user) candidates.push(member.user)
  if (member.data) candidates.push(member.data)

  // 先收集这个对象里所有"群名/群标题"字段的值，后面用来做反排除
  // （因为有些版本 member 对象上会带 group_name = 群名，这是"描述性字段"，不是成员群名片）
  const groupNameExclude = new Set()
  const groupNameFields = ['group_name', 'groupName', 'groupname', 'group_title', 'groupTitle', 'group_title', 'gn']
  for (const cand of candidates) {
    for (const f of groupNameFields) {
      const v = cand[f]
      if (v && typeof v !== 'function' && String(v).trim()) groupNameExclude.add(String(v).trim())
    }
  }
  if (_excludeName && String(_excludeName).trim()) groupNameExclude.add(String(_excludeName).trim())

  // 判断一个值是否"看起来像群名"，如果是则跳过
  const isGroupName = function (v) {
    const s = String(v).trim()
    if (!s) return true
    if (groupNameExclude.has(s)) return true
    return false
  }

  // 优先: 群名片字段（去掉 group_name/groupName — 那是群的名字，不是成员群名片）
  const cardFields = [
    'card', 'card_name', 'groupCard', 'group_card',
    'group_nick', 'groupNick',
    'groupcard', 'gcard', 'member_card', 'memberCard'
  ]
  for (const cand of candidates) {
    for (const f of cardFields) {
      const v = cand[f]
      if (v && typeof v !== 'function' && !isGroupName(v)) {
        return String(v).trim()
      }
    }
  }

  // 其次: 昵称 / 用户名（注意：member 对象里的 name 可能是群名，做反排除）
  const nickFields = [
    'nickname', 'nick', 'user_name', 'userName',
    'qq_nick', 'qqNick', 'nick_name',
    'display_name', 'displayName',
    'title', 'name' // name 放最后，因为有些版本里它是群名
  ]
  for (const cand of candidates) {
    for (const f of nickFields) {
      const v = cand[f]
      if (v && typeof v !== 'function' && !isGroupName(v)) {
        return String(v).trim()
      }
    }
  }

  return null
}

/**
 * 判断消息中是否有 @ 某人
 * 支持：e.at[] / e.ats[] / e.at_user / e.message 数组 / @xxx 文本 / [CQ:at...] / <at...> XML
 *
 * 设计要点：
 *   - 结构化源（e.at / e.message 数组）优先提供 QQ 号
 *   - 文本源（@xxx / CQ 码）**同时**提供显示名，便于群名片查询失败时回落
 */
function detectAt (e) {
  if (!e) return { hasAt: false, qq: null, displayName: null }

  let qq = null
  let displayName = null

  // ===== 1. 从结构化源收集 QQ 号 =====
  // 1a. e.at / e.ats 数组
  const arrFields = ['at', 'ats', 'atList', 'at_list']
  for (const field of arrFields) {
    const arr = e[field]
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0]
      if (first) {
        if (typeof first === 'object' && first !== null) {
          const foundQq = first.qq || first.id || first.user_id || first.userId
          if (foundQq) {
            qq = String(foundQq)
            // 若对象自带 name/nick，直接用
            displayName = displayName || first.name || first.nick || null
            break
          }
        } else if (typeof first === 'string' || typeof first === 'number') {
          qq = String(first)
          break
        }
      }
    }
  }

  // 1b. e.at_user / e.at_qq 等单字段
  if (!qq) {
    const singleFields = ['at_user', 'atUser', 'at_qq', 'atQq']
    for (const field of singleFields) {
      const v = e[field]
      if (v) { qq = String(v); break }
    }
  }

  // 1c. e.message 消息对象数组中的 at 类型段
  if (!qq && Array.isArray(e.message)) {
    for (const seg of e.message) {
      if (!seg) continue
      const type = String(seg.type || seg.msg_type || '').toLowerCase()
      if (type === 'at' || type === 'mention') {
        const data = seg.data || seg
        const foundQq = data.qq || data.id || data.user_id || data.userId || data.uid || data.qqu
        if (foundQq) {
          qq = String(foundQq)
          displayName = displayName || data.name || data.nick || data.text
          // 去掉 text 里的 @ 前缀
          if (displayName && typeof displayName === 'string' && displayName.startsWith('@')) {
            displayName = displayName.substring(1).trim()
          }
          break
        }
      }
    }
  }

  // ===== 2. 从文本源收集（补充 QQ + 显示名） =====
  const msg = (e?.msg || e?.raw_message || '').toString()

  // 2a. CQ 码 [CQ:at,qq=123456]
  if (!qq) {
    const cqMatch = msg.match(/\[CQ:at[^]]*qq=(\d+)/i)
    if (cqMatch && cqMatch[1]) qq = cqMatch[1]
  }
  // 2b. XML <at qq="123"/>
  if (!qq) {
    const xmlMatch = msg.match(/<at[^>]*?\s(?:qq|id)=["']?(\d+)/i)
    if (xmlMatch && xmlMatch[1]) qq = xmlMatch[1]
  }

  // 2c. 文本中查找 @显示名（**不管有没有 QQ，都尝试抓显示名**）
  if (!displayName) {
    const atTextMatch = msg.match(/@([^\s@,，。！!？?\[\]|]{1,20})/)
    if (atTextMatch && atTextMatch[1]) {
      let text = atTextMatch[1].trim()
      const kwIdx = text.search(/结婚|去结婚|结婚啦/)
      if (kwIdx > 0) text = text.substring(0, kwIdx).trim()
      if (text) {
        if (/^\d{5,}$/.test(text)) {
          // @后面是纯数字（如 @3182924395）→ 当 QQ 号
          if (!qq) qq = text
        } else {
          displayName = text
        }
      }
    }
  }

  // ===== 3. 返回合并结果 =====
  if (qq || displayName) {
    return { hasAt: true, qq, displayName }
  }
  return { hasAt: false, qq: null, displayName: null }
}

/**
 * 从消息中提取"对方"的名字
 * 优先级：
 *   1) 检测到 @ 提及 → 通过 QQ 号查群名片（或使用显示名）
 *   2) "我和XXX结婚了" 等句式中的 XXX
 *   3) 宽松正则兜底
 * 返回：{ source: 'at'|'text'|'none', name: string, qq: string|null }
 */
async function extractPartnerName (e) {
  const msg = (e?.msg || e?.raw_message || e?.message || '').toString()
  // 准备一份"纯净文本"：把 CQ 码、@提及标签等替换成空字符串，便于做文本模式匹配
  const cleanMsg = msg
    .replace(/\[CQ:[^\]]*\]/gi, '') // 去掉所有 CQ 码: [CQ:at,qq=123], [CQ:image,...] 等
    .replace(/<at[^>]*>/gi, '')   // 去掉 <at qq="123"/> 格式
    .replace(/@[^\s@,，。！!？?\[\]|]+/g, '') // 去掉 @XXX 文本
    .trim()
  const atInfo = detectAt(e)

  // ============================================================
  // 1) 有 @ 提及 → 优先用被 @ 者的群名片，其次显示名，最后才是 QQ
  // ============================================================
  if (atInfo.hasAt) {
    if (atInfo.qq) {
      // 1a) 有 QQ → 查群名片/昵称
      try {
        const name = await getGroupNameByQQ(e, atInfo.qq)
        if (name && String(name).trim()) {
          return { source: 'at', name: String(name).trim(), qq: atInfo.qq }
        }
      } catch (err) {
        _log('debug', `群名片查询异常: ${err?.message || err}`)
      }
      // 1b) 查不到群名片 → 若有显示名（@MCat 这种）就用它
      if (atInfo.displayName && String(atInfo.displayName).trim()) {
        return { source: 'at', name: atInfo.displayName.trim(), qq: atInfo.qq }
      }
      // 1c) 也没有显示名 → 再试一次文本模式（如"我要和你结婚"里的"你"）
      //     比直接回落 QQ 号更有意义
      const mText1 = cleanMsg.match(/^我(要)?(和|跟)([\u4e00-\u9fa5A-Za-z0-9_\- ]{1,20}?)(结婚了|结婚|去结婚|结婚啦)/)
      if (mText1 && mText1[3]) {
        const n = mText1[3].trim()
        if (n && n !== '你结婚') return { source: 'text', name: n, qq: atInfo.qq }
      }
      const mText2 = cleanMsg.match(/(我和|我跟|我要和|我要跟)([^结婚，,。！!？?@\s]{1,20})(结婚)/)
      if (mText2 && mText2[2]) {
        const n = mText2[2].trim()
        if (n) return { source: 'text', name: n, qq: atInfo.qq }
      }
      // 1d) 最后回落：用 QQ 号（保证至少有值，不会让用户看到"无法识别"）
      return { source: 'at', name: String(atInfo.qq), qq: atInfo.qq }
    }
    // 2) 只有显示名，没有 QQ 号（纯文本 @xxx 但无法识别为数字）
    if (atInfo.displayName) {
      return { source: 'at', name: atInfo.displayName, qq: null }
    }
  }

  // ============================================================
  // 3) 无 @ 信息：严格句式匹配
  //    - "我和XXX结婚了" / "我要跟XXX结婚"
  //    - 明确允许 "你" / "您"（即：我要和你结婚）
  //    - 使用 cleanMsg 剥离 CQ 码后再匹配，避免 CQ 码干扰
  // ============================================================
  const pattern1 = /^我(要)?(和|跟)([\u4e00-\u9fa5A-Za-z0-9_\- ]{1,20}?)(结婚了|结婚|去结婚|结婚啦)/
  const m1 = cleanMsg.match(pattern1)
  if (m1 && m1[3]) {
    const name = m1[3].trim()
    if (name && name !== '你结婚') {
      const clean = name.trim()
      if (clean) return { source: 'text', name: clean, qq: null }
    }
  }

  // 4) 宽松正则兜底：在"我和/我跟"与"结婚"之间截取
  const m2 = cleanMsg.match(/(我和|我跟|我要和|我要跟)([^结婚，,。！!？?@\s]{1,20})(结婚)/)
  if (m2 && m2[2]) {
    const name = m2[2].trim()
    if (name) return { source: 'text', name, qq: null }
  }

  return { source: 'none', name: null, qq: null }
}

/**
 * 构建结婚证 API URL
 */
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

    // 解析双方姓名
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

      // 发起一次请求验证接口返回
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
      _log('error', `request error: ${err?.message || err}`)
      return this.reply(`生成结婚证失败：${err?.message || err}`)
    }
  }
}

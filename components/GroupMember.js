function _log (level, ...args) {
  try {
    const g = globalThis
    const logger = g.logger || g.log || g.console
    const lv = level === 'debug' ? 'mark' : level
    if (logger && typeof logger[lv] === 'function') {
      logger[lv]('[GroupMember]', ...args)
    }
  } catch (_) { /* noop */ }
}

function _getBot (e) {
  if (e?.bot) return e.bot
  if (typeof Bot !== 'undefined') return Bot
  if (typeof globalThis?.Bot !== 'undefined') return globalThis.Bot
  if (typeof globalThis?.bot !== 'undefined') return globalThis.bot
  if (typeof globalThis?.Red?.Bot !== 'undefined') return globalThis.Red.Bot
  return null
}

function _getGroupId (e) {
  const gid = e?.group_id || e?.gid
    || (e?.group && (e.group.group_id || e.group.gid || e.group.id || e.group.groupid))
    || null
  return gid ? String(gid) : null
}

function _getGroupObj (e) {
  if (e?.group) return e.group
  const bot = _getBot(e)
  const gid = _getGroupId(e)
  if (!bot || !gid) return null
  const fns = ['pickGroup', 'getGroup', 'get_group', 'pick_group']
  for (const fn of fns) {
    if (typeof bot[fn] === 'function') {
      try {
        const g = bot[fn](gid)
        if (g) return g
      } catch (_) {}
    }
  }
  if (bot.groups && typeof bot.groups.get === 'function') {
    try { return bot.groups.get(gid) } catch (_) {}
  }
  return null
}

function _extractName (member, excludeNames) {
  if (!member) return null
  const exclude = new Set()
  if (Array.isArray(excludeNames)) {
    excludeNames.forEach(n => n && exclude.add(String(n).trim()))
  }

  const candidates = [member]
  if (member.info) candidates.push(member.info)
  if (member.member) candidates.push(member.member)
  if (member.user) candidates.push(member.user)
  if (member.data) candidates.push(member.data)

  const cardFields = [
    'card', 'card_name', 'groupCard', 'group_card',
    'group_nick', 'groupNick', 'groupcard', 'gcard',
    'member_card', 'memberCard'
  ]
  const nickFields = [
    'nickname', 'nick', 'user_name', 'userName',
    'qq_nick', 'qqNick', 'nick_name',
    'display_name', 'displayName', 'title', 'name'
  ]

  for (const cand of candidates) {
    for (const f of cardFields) {
      const v = cand?.[f]
      if (v && typeof v === 'string' && v.trim() && !exclude.has(v.trim())) {
        return v.trim()
      }
    }
  }
  for (const cand of candidates) {
    for (const f of nickFields) {
      const v = cand?.[f]
      if (v && typeof v === 'string' && v.trim() && !exclude.has(v.trim())) {
        return v.trim()
      }
    }
  }
  return null
}

async function _getMemberByPick (group, qqStr) {
  const pickFns = ['pickMember', 'getMember', 'getMemberInfo', 'get_member', 'fetchMember']
  for (const fn of pickFns) {
    if (typeof group[fn] !== 'function') continue
    try {
      const member = await group[fn](qqStr)
      if (!member) continue
      const info = await _resolveMemberInfo(member)
      if (info) {
        _log('debug', `group.${fn}() + getInfo 成功: qq=${qqStr}`)
        return info
      }
      return member
    } catch (err) {
      _log('debug', `group.${fn}() err=${err?.message || err}`)
    }
  }
  return null
}

async function _resolveMemberInfo (member) {
  if (!member) return null
  if (member.info && typeof member.info === 'object' && !member.info.then) {
    return member.info
  }
  const getInfoFns = ['getInfo', 'get_info', 'fetchInfo', 'loadInfo', 'queryInfo']
  for (const fn of getInfoFns) {
    if (typeof member[fn] === 'function') {
      try {
        const info = await member[fn]()
        if (info) return info
      } catch (err) {
        _log('debug', `member.${fn}() err=${err?.message || err}`)
      }
    }
  }
  return null
}

async function _getMemberByDirectCall (bot, gid, qqStr) {
  if (!bot || !gid) return null
  const fns = [
    'getGroupMemberInfo', 'get_group_member_info',
    'getMemberInfo', 'getMember', 'pickMember',
    'getGroupMember', 'fetchMember'
  ]
  for (const fn of fns) {
    if (typeof bot[fn] !== 'function') continue
    try {
      const m = await bot[fn](gid, qqStr)
      if (m) return m
    } catch (_) {}
  }
  return null
}

function _getMemberFromMembersMap (group, qqStr) {
  if (!group?.members) return null
  try {
    if (typeof group.members.get === 'function') {
      return group.members.get(qqStr)
    }
    if (typeof group.members === 'object' && group.members[qqStr]) {
      return group.members[qqStr]
    }
  } catch (_) {}
  return null
}

function _getMemberFromList (group, qqStr) {
  if (!group) return null
  const listFields = [
    'memberList', 'member_list', 'members_list',
    'memberInfoList', 'memberInfos'
  ]
  for (const field of listFields) {
    const list = group[field]
    if (Array.isArray(list)) {
      const found = list.find(m => {
        const mQq = m?.qq || m?.user_id || m?.userId || m?.uin || m?.id
        return mQq && String(mQq) === qqStr
      })
      if (found) return found
    }
  }
  return null
}

function _getNameFromAtMessage (e, qqStr) {
  if (!qqStr) return null
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
            if (name && typeof name === 'string') {
              const trimmed = name.trim().replace(/^@/, '').trim()
              if (trimmed) return trimmed
            }
          }
        }
      }
    }
    if (Array.isArray(e.at)) {
      for (const item of e.at) {
        if (!item || typeof item !== 'object') continue
        const itemQq = item.qq || item.id || item.user_id || item.userId
        if (itemQq && String(itemQq) === qqStr) {
          const name = item.name || item.nick || item.card || item.nickname || item.display_name
          if (name && typeof name === 'string' && name.trim()) return name.trim()
        }
      }
    }
  } catch (_) {}
  return null
}

export async function getGroupMemberInfo (e, qq) {
  if (!qq) return null
  const qqStr = String(qq)
  const group = _getGroupObj(e)
  const gid = _getGroupId(e)
  _log('mark', `查询群名片 qq=${qqStr} gid=${gid || '无'} e.group=${!!e?.group}`)
  const groupNames = []
  if (group) {
    const gnames = ['name', 'group_name', 'groupName', 'groupname', 'title', 'group_title']
    for (const f of gnames) {
      const v = group[f]
      if (v && typeof v === 'string' && v.trim()) groupNames.push(v.trim())
    }
  }

  if (group) {
    const m1 = await _getMemberByPick(group, qqStr)
    if (m1) {
      const name = _extractName(m1, groupNames)
      _log('mark', `pickMember 成功: qq=${qqStr} name=${name || '(空)'}`)
      return { member: m1, name }
    }
    const m2 = _getMemberFromMembersMap(group, qqStr)
    if (m2) {
      const name = _extractName(m2, groupNames)
      _log('mark', `members Map 成功: qq=${qqStr} name=${name || '(空)'}`)
      return { member: m2, name }
    }
    const m3 = _getMemberFromList(group, qqStr)
    if (m3) {
      const name = _extractName(m3, groupNames)
      _log('mark', `memberList 成功: qq=${qqStr} name=${name || '(空)'}`)
      return { member: m3, name }
    }
  }

  const bot = _getBot(e)
  if (bot && gid) {
    const m4 = await _getMemberByDirectCall(bot, gid, qqStr)
    if (m4) {
      const name = _extractName(m4, groupNames)
      _log('mark', `Bot 直接调用成功: qq=${qqStr} name=${name || '(空)'}`)
      return { member: m4, name }
    }
    if (!group) {
      let groupObj = null
      const groupFns = ['pickGroup', 'getGroup', 'get_group', 'pick_group']
      for (const fn of groupFns) {
        if (typeof bot[fn] === 'function') {
          try { groupObj = bot[fn](gid); if (groupObj) break } catch (_) {}
        }
      }
      if (!groupObj && bot.groups && typeof bot.groups.get === 'function') {
        try { groupObj = bot.groups.get(gid) } catch (_) {}
      }
      if (groupObj) {
        const m5 = await _getMemberByPick(groupObj, qqStr)
        if (m5) {
          const name = _extractName(m5, groupNames)
          _log('mark', `Bot.pickGroup + pickMember 成功: qq=${qqStr} name=${name || '(空)'}`)
          return { member: m5, name }
        }
      }
    }
  }

  const atName = _getNameFromAtMessage(e, qqStr)
  if (atName) {
    _log('mark', `消息 at 段获取显示名: qq=${qqStr} name=${atName}`)
    return { member: null, name: atName }
  }

  _log('mark', `未能获取群成员信息: qq=${qqStr}，回落 QQ 号`)
  return null
}

export async function getMemberName (e, qq) {
  const info = await getGroupMemberInfo(e, qq)
  if (info?.name) return info.name
  return qq ? String(qq) : null
}

export function getSenderName (e) {
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

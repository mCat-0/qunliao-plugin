import { httpFetch, getString, getStringList } from './ModuleHelper.js'

const IMAGE_URL_KEYS = [
  'image_url', 'imageUrl', 'img_url', 'imgUrl',
  'url', 'image', 'img', 'pic', 'pic_url', 'picUrl',
  'src', 'source', 'link', 'photo', 'picture'
]

const IMAGE_ARRAY_KEYS = ['data', 'images', 'list', 'result', 'results', 'dataList']

function isHttpUrl (v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v)
}

function looksLikeImageUrl (v) {
  if (!isHttpUrl(v)) return false
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/i.test(v) ||
    /image|img|pic|photo|picture/i.test(v)
}

function findStringInObject (obj, depth = 0) {
  if (!obj || depth > 4) return null
  if (typeof obj === 'string') return isHttpUrl(obj) ? obj : null

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findStringInObject(item, depth + 1)
      if (r) return r
    }
    return null
  }

  if (typeof obj === 'object') {
    for (const key of IMAGE_URL_KEYS) {
      const v = obj[key]
      if (isHttpUrl(v)) return v
      if (typeof v === 'object') {
        const r = findStringInObject(v, depth + 1)
        if (r) return r
      }
    }
    for (const key of Object.keys(obj)) {
      if (IMAGE_URL_KEYS.includes(key)) continue
      const v = obj[key]
      if (typeof v === 'object') {
        const r = findStringInObject(v, depth + 1)
        if (r) return r
      }
    }
  }
  return null
}

export function extractImageUrl (raw) {
  if (!raw) return null

  if (typeof raw === 'string') {
    const t = raw.trim()
    if (isHttpUrl(t)) return t
    try {
      const parsed = JSON.parse(t)
      return extractImageUrl(parsed)
    } catch (_) { return null }
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const r = extractImageUrl(item)
      if (r) return r
    }
    return null
  }

  if (typeof raw === 'object') {
    for (const key of IMAGE_URL_KEYS) {
      const v = raw[key]
      if (isHttpUrl(v)) return v
    }
    for (const key of IMAGE_ARRAY_KEYS) {
      const v = raw[key]
      if (Array.isArray(v) && v.length > 0) {
        for (const item of v) {
          const r = extractImageUrl(item)
          if (r) return r
        }
      }
    }
    const deep = findStringInObject(raw, 0)
    if (deep) return deep
  }

  return null
}

function normalizeApiList (apiUrls) {
  if (!apiUrls) return []
  if (Array.isArray(apiUrls)) {
    return apiUrls.map((s) => String(s).trim()).filter(Boolean)
  }
  if (typeof apiUrls === 'string') {
    return apiUrls.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function getApiUrlsFromModule (moduleKey, fallbackUrls) {
  const cfgVal = getStringList(moduleKey, 'apiUrls', [])
  if (cfgVal && cfgVal.length > 0) return cfgVal

  const single = getString(moduleKey, 'apiUrl', '')
  if (single) {
    const list = normalizeApiList(single)
    if (list.length > 0) return list
  }

  return normalizeApiList(fallbackUrls)
}

function shuffle (arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function fetchImageUrl (moduleKeyOrUrls, fallbackUrls, opts) {
  const urls = Array.isArray(moduleKeyOrUrls)
    ? normalizeApiList(moduleKeyOrUrls)
    : getApiUrlsFromModule(moduleKeyOrUrls, fallbackUrls || [])

  if (urls.length === 0) {
    return { ok: false, error: '未配置 API 地址' }
  }

  const shuffled = opts && opts.randomize === false ? urls : shuffle(urls)
  const errors = []

  for (const url of shuffled) {
    try {
      const resp = await httpFetch(url, opts && opts.fetchOpts)
      if (!resp || !resp.ok) {
        errors.push(`${url} → HTTP ${resp ? resp.status : '无响应'}`)
        continue
      }
      const contentType = resp.headers && (resp.headers.get ? resp.headers.get('content-type') : resp.headers['content-type'])
      const ct = contentType || ''

      if (/image\//i.test(ct) || /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/i.test(url)) {
        return { ok: true, url, source: url, contentType: ct }
      }

      let text = ''
      try {
        text = await resp.text()
      } catch (_) { errors.push(`${url} → 读取响应失败`); continue }

      const trimmed = text.trim()
      if (isHttpUrl(trimmed)) {
        return { ok: true, url: trimmed, source: url, rawType: 'text' }
      }

      let json = null
      try {
        json = JSON.parse(trimmed)
      } catch (_) {
        errors.push(`${url} → 响应不是图片也不是 JSON`)
        continue
      }

      const img = extractImageUrl(json)
      if (img) {
        return { ok: true, url: img, source: url, rawType: 'json', raw: json }
      }
      errors.push(`${url} → JSON 中未找到图片地址`)
    } catch (err) {
      errors.push(`${url} → ${err.message || err}`)
    }
  }

  return { ok: false, error: '所有 API 均失败：\n' + errors.join('\n'), errors }
}

export async function fetchImage (moduleKeyOrUrls, fallbackUrls, opts) {
  const r = await fetchImageUrl(moduleKeyOrUrls, fallbackUrls, opts)
  if (!r.ok) return r
  return { ...r, segment: segment.image(r.url) }
}

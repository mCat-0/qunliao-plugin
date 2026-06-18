import Config from "./components/Config.js"

// 预热配置（避免首次读取时为空）
Config.getConfig()

// 热搜平台选项
const platformOptions = [
  { label: "抖音", value: "douyin" },
  { label: "微博", value: "weibo" },
  { label: "B站", value: "bilibili" },
  { label: "百度", value: "baidu" },
  { label: "头条", value: "toutiao" },
  { label: "新浪", value: "sina" },
  { label: "原神", value: "genshin" },
  { label: "快手", value: "kuaishou" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "知乎", value: "zhihu" },
  { label: "星铁", value: "starrail" }
]

// 背景图分类 category 可选项（通用）
const bgCategoryOptions = [
  { label: "手机壁纸 mobile_wallpaper", value: "mobile_wallpaper" },
  { label: "电脑壁纸 pc_wallpaper", value: "pc_wallpaper" },
  { label: "二次元 acg（可配置 type）", value: "acg" },
  { label: "表情包 bq（可配置 type）", value: "bq" },
  { label: "福瑞 furry（可配置 type）", value: "furry" },
  { label: "混合动漫 anime / landscape", value: "landscape" },
  { label: "混合动漫 general_anime", value: "general_anime" },
  { label: "AI 绘画 ai_drawing", value: "ai_drawing" }
]

// 仅 acg 允许的 type 选项
const bgTypeAcgOptions = [
  { label: "pc 壁纸", value: "pc" },
  { label: "mb 手机", value: "mb" }
]
// 仅 bq 允许的 type 选项
const bgTypeBqOptions = [
  { label: "xiongmao 熊猫", value: "xiongmao" },
  { label: "waiguoren 外国人", value: "waiguoren" },
  { label: "maomao 猫猫", value: "maomao" },
  { label: "ikun", value: "ikun" },
  { label: "eciyuan 二次元", value: "eciyuan" }
]
// 仅 furry 允许的 type 选项
const bgTypeFurryOptions = [
  { label: "z4k", value: "z4k" },
  { label: "szs8k 竖屏8k", value: "szs8k" },
  { label: "s4k 横屏4k", value: "s4k" },
  { label: "4k", value: "4k" }
]

// 背景图 type 总选项（按 category 分组展示，实际值均为合法值）
const bgTypeOptions = [
  { label: "不使用 type（留空）", value: "" },

  // --- acg 对应的 type ---
  { label: "[acg] pc 壁纸", value: "pc" },
  { label: "[acg] mb 手机", value: "mb" },

  // --- bq 对应的 type ---
  { label: "[bq] xiongmao 熊猫", value: "xiongmao" },
  { label: "[bq] waiguoren 外国人", value: "waiguoren" },
  { label: "[bq] maomao 猫猫", value: "maomao" },
  { label: "[bq] ikun", value: "ikun" },
  { label: "[bq] eciyuan 二次元", value: "eciyuan" },

  // --- furry 对应的 type ---
  { label: "[furry] z4k", value: "z4k" },
  { label: "[furry] szs8k 竖屏8k", value: "szs8k" },
  { label: "[furry] s4k 横屏4k", value: "s4k" },
  { label: "[furry] 4k", value: "4k" }
]

export function supportGuoba() {
  // 群列表（在被调用时动态生成，此时 Bot 已经登录）
  let groupList = []
  try {
    if (Bot?.gl && typeof Bot.gl.values === 'function') {
      groupList = Array.from(Bot.gl.values()).map(g => {
        const id = String(g.group_id ?? g.gid ?? '')
        const name = g.group_name ?? g.groupName ?? `群 ${id}`
        return { label: `${name} - ${id}`, value: id }
      })
    }
  } catch (e) {
    groupList = []
  }

  const groupOptions = [
    { label: "私聊 - 8888", value: "8888" },
    ...groupList
  ]

  return {
    pluginInfo: {
      name: 'Qunliao-Plugin',
      title: '群聊插件 Qunliao Plugin',
      author: ['mCat', 'Trae'],
      authorLink: ['https://gitee.com/mcat0', 'https://github.com/mCat-0'],
      link: 'https://gitee.com/mcat0/qunliao-plugin',
      isV3: true,
      isV2: false,
      showInMenu: true,
      description: '一个集合了每日早报 / 早晚安问候 / 多平台热搜 / 天气查询 / 毒鸡汤 / 舔狗日记 / COS 图 / KFC 疯狂星期四 / 历史上的今天 的综合群聊插件。',
      icon: 'fluent-emoji-flat:speech-balloon',
      iconColor: '#4A90E2'
    },

    configInfo: {
      schemas: [
        // ============================================================
        // 通用配置
        // ============================================================
        {
          label: '通用配置',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "基础设置",
          componentProps: {
            orientation: "left",
            plain: true
          }
        },
        {
          field: "requestTimeoutMs",
          label: "请求超时时间（毫秒）",
          bottomHelpMessage: "各模块请求外部 API 的总超时时间，默认 15000 毫秒（15 秒）",
          component: "InputNumber",
          componentProps: {
            min: 1000,
            step: 1000
          }
        },
        {
          field: "userAgent",
          label: "请求 User-Agent",
          bottomHelpMessage: "向外部 API 发起请求时使用的 User-Agent 头部",
          component: "Input"
        },
        {
          field: "onlyGroupID",
          label: "全局白名单群",
          bottomHelpMessage: "仅设置后生效的群可以使用本插件所有功能，留空则所有群均可使用。私聊请填入 8888",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 每日早报
        // ============================================================
        {
          label: '每日早报',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "每日早报",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "dailyNews.enabled",
          label: "启用「每日早报」",
          component: "Switch"
        },
        {
          field: "dailyNews.apiUrl",
          label: "数据来源 API",
          bottomHelpMessage: "获取每日早报 JSON 数据的接口地址",
          component: "Input"
        },
        {
          field: "dailyNews.coverImageUrl",
          label: "封面图片 API",
          bottomHelpMessage: "早报卡片顶部使用的随机封面图接口，留空则不使用",
          component: "Input",
          componentProps: { placeholder: "https://api.elaina.cat/random/pc/" }
        },
        {
          field: "dailyNews.cron",
          label: "定时推送 Cron 表达式",
          bottomHelpMessage: "每日自动推送的定时任务 cron，默认 0 30 6 * * ? 表示每天 06:30 推送",
          component: "Input"
        },
        {
          field: "dailyNews.cacheTtlHours",
          label: "图片缓存有效期（小时）",
          bottomHelpMessage: "单张早报图片的缓存有效期，默认 12 小时；超过会重新生成；建议 1-18 之间，避免跨天命中旧内容",
          component: "InputNumber",
          componentProps: { min: 1, max: 18, step: 1 }
        },
        {
          field: "dailyNews.cacheKeepDays",
          label: "图片缓存保留天数",
          bottomHelpMessage: "自动清理超过设定天数的早报图片缓存，默认 2 天",
          component: "InputNumber",
          componentProps: { min: 0, step: 1 }
        },
        {
          field: "dailyNews.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅对这些群推送每日早报，留空则使用全局白名单",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 早晚安问候
        // ============================================================
        {
          label: '早晚安问候',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "早晚安问候",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "goodNight.enabled",
          label: "启用「早晚安问候」",
          component: "Switch"
        },
        {
          field: "goodNight.muteEnabled",
          label: "触发晚安后禁言",
          bottomHelpMessage: "开启后，触发晚安关键词的群成员将被禁言一段时间（仅群聊且机器人有管理员权限时生效）",
          component: "Switch"
        },
        {
          field: "goodNight.muteSeconds",
          label: "禁言时长（秒）",
          bottomHelpMessage: "默认 28800 秒 = 8 小时，最小 60 秒，最大 2592000 秒（30 天）",
          component: "InputNumber",
          componentProps: { min: 60, max: 2592000, step: 60 }
        },
        {
          field: "goodNight.goodNightKeywords",
          label: "晚安关键词",
          bottomHelpMessage: "用户消息中包含任一关键词即触发晚安回复",
          component: "GTags",
          componentProps: {
            placeholder: "如：晚安,睡觉了,我要睡了",
            allowAdd: true,
            allowDel: true
          }
        },
        {
          field: "goodNight.goodMorningKeywords",
          label: "早安关键词",
          bottomHelpMessage: "用户消息中包含任一关键词即触发早安回复",
          component: "GTags",
          componentProps: {
            placeholder: "如：早安,早上好,起床",
            allowAdd: true,
            allowDel: true
          }
        },
        {
          field: "goodNight.goodNightAPI",
          label: "晚安问候 API",
          bottomHelpMessage: "返回一段晚安问候语的 API 地址",
          component: "Input"
        },
        {
          field: "goodNight.goodMorningAPI",
          label: "早安问候 API",
          bottomHelpMessage: "返回一段早安问候语的 API 地址",
          component: "Input"
        },
        {
          field: "goodNight.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 热搜
        // ============================================================
        {
          label: '多平台热搜',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "多平台热搜",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "hotSearch.enabled",
          label: "启用「热搜」",
          component: "Switch"
        },
        {
          field: "hotSearch.defaultPlatform",
          label: "默认平台",
          bottomHelpMessage: "用户输入 #热搜 时默认使用的平台",
          component: "Select",
          componentProps: { options: platformOptions }
        },
        {
          field: "hotSearch.apiUrl",
          label: "热搜 API",
          bottomHelpMessage: "热搜数据接口地址",
          component: "Input"
        },
        {
          field: "hotSearch.bgBaseUrl",
          label: "背景图 API",
          bottomHelpMessage: "默认 https://uapis.cn/api/v1/random/image；留空即使用默认",
          component: "Input",
          componentProps: { placeholder: "https://uapis.cn/api/v1/random/image" }
        },
        {
          field: "hotSearch.bgCategory",
          label: "背景图 category",
          bottomHelpMessage: "选择图片分类；acg / bq / furry 可再设置下方 type",
          component: "Select",
          componentProps: { options: bgCategoryOptions }
        },
        {
          field: "hotSearch.bgType",
          label: "背景图 type",
          bottomHelpMessage: "仅当 bgCategory 为 acg / bq / furry 时才生效；其它分类请选「不使用 type」",
          component: "Select",
          componentProps: { options: bgTypeOptions }
        },
        {
          field: "hotSearch.bgCustomUrl",
          label: "背景图自定义 URL",
          bottomHelpMessage: "填此则跳过 category/type 拼装，直接使用该 URL 作为背景图",
          component: "Input",
          componentProps: { placeholder: "留空则使用 category/type 拼装" }
        },
        {
          field: "hotSearch.glassEnabled",
          label: "启用毛玻璃",
          bottomHelpMessage: "关闭后内容区退化为纯色半透明卡片",
          component: "Switch",
          componentProps: { checkedValue: true, uncheckedValue: false }
        },
        {
          field: "hotSearch.glassBlur",
          label: "模糊半径(px)",
          bottomHelpMessage: "值越大越模糊，建议 4~24",
          component: "InputNumber",
          componentProps: { min: 0, max: 60, step: 1, placeholder: "14" }
        },
        {
          field: "hotSearch.glassSaturate",
          label: "饱和度(%)",
          bottomHelpMessage: "100 为不变，增大可让底色更鲜艳，建议 100~180",
          component: "InputNumber",
          componentProps: { min: 0, max: 300, step: 10, placeholder: "140" }
        },
        {
          field: "hotSearch.glassOpacity",
          label: "卡片不透明度",
          bottomHelpMessage: "0~1，越大越不透明，建议 0.25~0.55",
          component: "InputNumber",
          componentProps: { min: 0, max: 1, step: 0.05, placeholder: "0.35" }
        },
        {
          field: "hotSearch.glassBorder",
          label: "边框颜色",
          bottomHelpMessage: "支持 #rrggbb / rgba(...)，留空使用默认",
          component: "Input",
          componentProps: { placeholder: "rgba(255,255,255,0.18)" }
        },
        {
          field: "hotSearch.glassRadius",
          label: "圆角(px)",
          bottomHelpMessage: "卡片圆角大小，建议 8~24",
          component: "InputNumber",
          componentProps: { min: 0, max: 48, step: 2, placeholder: "16" }
        },
        {
          field: "hotSearch.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 天气查询
        // ============================================================
        {
          label: '天气查询',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "天气查询",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "weather.enabled",
          label: "启用「天气查询」",
          component: "Switch"
        },
        {
          field: "weather.defaultCity",
          label: "默认城市",
          bottomHelpMessage: "当未在指令中指定城市时使用该城市，如：广州、北京、上海",
          component: "Input",
          componentProps: { placeholder: "留空则必须在指令中指定城市" }
        },
        {
          field: "weather.apiUrl",
          label: "天气 API",
          bottomHelpMessage: "天气数据接口地址",
          component: "Input"
        },
        {
          field: "weather.bgBaseUrl",
          label: "背景图 API",
          bottomHelpMessage: "默认 https://uapis.cn/api/v1/random/image；留空即使用默认",
          component: "Input",
          componentProps: { placeholder: "https://uapis.cn/api/v1/random/image" }
        },
        {
          field: "weather.bgCategory",
          label: "背景图 category",
          bottomHelpMessage: "选择图片分类；acg / bq / furry 可再设置下方 type",
          component: "Select",
          componentProps: { options: bgCategoryOptions }
        },
        {
          field: "weather.bgType",
          label: "背景图 type",
          bottomHelpMessage: "仅当 bgCategory 为 acg / bq / furry 时才生效；其它分类请选「不使用 type」",
          component: "Select",
          componentProps: { options: bgTypeOptions }
        },
        {
          field: "weather.bgCustomUrl",
          label: "背景图自定义 URL",
          bottomHelpMessage: "填此则跳过 category/type 拼装，直接使用该 URL 作为背景图",
          component: "Input",
          componentProps: { placeholder: "留空则使用 category/type 拼装" }
        },
        {
          field: "weather.glassEnabled",
          label: "启用毛玻璃",
          bottomHelpMessage: "关闭后内容区退化为纯色半透明卡片",
          component: "Switch",
          componentProps: { checkedValue: true, uncheckedValue: false }
        },
        {
          field: "weather.glassBlur",
          label: "模糊半径(px)",
          bottomHelpMessage: "值越大越模糊，建议 4~24",
          component: "InputNumber",
          componentProps: { min: 0, max: 60, step: 1, placeholder: "14" }
        },
        {
          field: "weather.glassSaturate",
          label: "饱和度(%)",
          bottomHelpMessage: "100 为不变，增大可让底色更鲜艳，建议 100~180",
          component: "InputNumber",
          componentProps: { min: 0, max: 300, step: 10, placeholder: "140" }
        },
        {
          field: "weather.glassOpacity",
          label: "卡片不透明度",
          bottomHelpMessage: "0~1，越大越不透明，建议 0.25~0.55",
          component: "InputNumber",
          componentProps: { min: 0, max: 1, step: 0.05, placeholder: "0.35" }
        },
        {
          field: "weather.glassBorder",
          label: "边框颜色",
          bottomHelpMessage: "支持 #rrggbb / rgba(...)，留空使用默认",
          component: "Input",
          componentProps: { placeholder: "rgba(255,255,255,0.18)" }
        },
        {
          field: "weather.glassRadius",
          label: "圆角(px)",
          bottomHelpMessage: "卡片圆角大小，建议 8~24",
          component: "InputNumber",
          componentProps: { min: 0, max: 48, step: 2, placeholder: "16" }
        },
        {
          field: "weather.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // B站直播推送
        // ============================================================
        {
          label: 'B站直播推送',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "B站直播推送",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "bilitvPush.enabled",
          label: "启用「B站直播推送」",
          component: "Switch"
        },
        {
          field: "bilitvPush.subscribeUIDs",
          label: "订阅的 B站 UID",
          bottomHelpMessage: "填 mid 纯数字，多个用逗号/空格/换行分隔；示例：401742377, 1636034895",
          component: "Input"
        },
        {
          field: "bilitvPush.cronHours",
          label: "定时扫描小时(0~23)",
          bottomHelpMessage: "每天这些整点各扫描一次；示例：6,11,12,18,20,22",
          component: "Input"
        },
        {
          field: "bilitvPush.scanIntervalHours",
          label: "兜底扫描间隔(小时)",
          bottomHelpMessage: "每 N 小时执行一次兜底扫描；默认 8 小时",
          component: "InputNumber",
          componentProps: { min: 1, max: 240, step: 1, placeholder: "8" }
        },
        {
          field: "bilitvPush.cooldownHours",
          label: "同一直播间冷却(小时)",
          bottomHelpMessage: "同一个直播间在该时长内不会重复推送；0 表示关闭去重；默认 2",
          component: "InputNumber",
          componentProps: { min: 0, max: 240, step: 1, placeholder: "2" }
        },
        {
          field: "bilitvPush.nightScanEnabled",
          label: "夜间是否扫描",
          bottomHelpMessage: "关闭后，在夜间时段内不扫描；夜间时段可在下方自定义",
          component: "Switch",
          componentProps: { checkedValue: true, uncheckedValue: false }
        },
        {
          field: "bilitvPush.nightStartHour",
          label: "夜间开始(24h)",
          bottomHelpMessage: "从该小时起算夜间；默认 23",
          component: "InputNumber",
          componentProps: { min: 0, max: 23, step: 1, placeholder: "23" }
        },
        {
          field: "bilitvPush.nightEndHour",
          label: "夜间结束(24h)",
          bottomHelpMessage: "到该小时为止算夜间；默认 8；结束必须晚于开始",
          component: "InputNumber",
          componentProps: { min: 0, max: 23, step: 1, placeholder: "8" }
        },
        {
          field: "bilitvPush.glassEnabled",
          label: "启用毛玻璃",
          bottomHelpMessage: "关闭后内容区退化为纯色半透明卡片",
          component: "Switch",
          componentProps: { checkedValue: true, uncheckedValue: false }
        },
        {
          field: "bilitvPush.glassBlur",
          label: "模糊半径(px)",
          bottomHelpMessage: "值越大越模糊，建议 0~24",
          component: "InputNumber",
          componentProps: { min: 0, max: 60, step: 1, placeholder: "3" }
        },
        {
          field: "bilitvPush.glassSaturate",
          label: "饱和度(%)",
          bottomHelpMessage: "100 为不变，增大可让底色更鲜艳，建议 100~180",
          component: "InputNumber",
          componentProps: { min: 0, max: 300, step: 10, placeholder: "140" }
        },
        {
          field: "bilitvPush.glassOpacity",
          label: "卡片不透明度",
          bottomHelpMessage: "0~1，越大越不透明，建议 0.25~0.55",
          component: "InputNumber",
          componentProps: { min: 0, max: 1, step: 0.05, placeholder: "0.35" }
        },
        {
          field: "bilitvPush.glassBorder",
          label: "边框颜色",
          bottomHelpMessage: "支持 #rrggbb / rgba(...)",
          component: "Input",
          componentProps: { placeholder: "rgba(255,255,255,0.18)" }
        },
        {
          field: "bilitvPush.glassRadius",
          label: "圆角(px)",
          bottomHelpMessage: "卡片圆角大小，建议 8~24",
          component: "InputNumber",
          componentProps: { min: 0, max: 48, step: 2, placeholder: "16" }
        },
        {
          field: "bilitvPush.coverFilterEnabled",
          label: "背景渐变滤镜",
          bottomHelpMessage: "关闭后封面图直接显示，不叠加彩色渐变；默认开启",
          component: "Switch",
          componentProps: { checkedValue: true, uncheckedValue: false }
        },
        {
          field: "bilitvPush.coverGradient",
          label: "自定义渐变",
          bottomHelpMessage: "任何合法 CSS background，如 linear-gradient / radial-gradient；留空使用默认",
          component: "Input",
          componentProps: { placeholder: "linear-gradient(135deg, rgba(14,165,233,0.45) 0%, rgba(99,102,241,0.40) 50%, rgba(236,72,153,0.40) 100%)" }
        },
        {
          field: "bilitvPush.coverMaskOpacity",
          label: "底部蒙版强度",
          bottomHelpMessage: "0~1，越大底部越暗，便于顶部标题文字显示；默认 0.55",
          component: "InputNumber",
          componentProps: { min: 0, max: 1, step: 0.05, placeholder: "0.55" }
        },

        // ============================================================
        // 毒鸡汤
        // ============================================================
        {
          label: '毒鸡汤',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "毒鸡汤",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "dujitang.enabled",
          label: "启用「毒鸡汤」",
          component: "Switch"
        },
        {
          field: "dujitang.apiUrl",
          label: "毒鸡汤 API",
          bottomHelpMessage: "返回一条随机毒鸡汤文案的接口地址",
          component: "Input"
        },
        {
          field: "dujitang.apiUrl2",
          label: "备用 API",
          bottomHelpMessage: "主 API 失败时尝试；留空则不使用",
          component: "Input"
        },
        {
          field: "dujitang.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 舔狗日记
        // ============================================================
        {
          label: '舔狗日记',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "舔狗日记",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "dogDiary.enabled",
          label: "启用「舔狗日记」",
          component: "Switch"
        },
        {
          field: "dogDiary.apiUrl",
          label: "舔狗日记 API",
          bottomHelpMessage: "返回一条随机舔狗日记文案的接口地址",
          component: "Input"
        },
        {
          field: "dogDiary.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // COS 图片
        // ============================================================
        {
          label: 'COS 图片',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "COS 图片",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "cosImage.enabled",
          label: "启用「COS 图片」",
          component: "Switch"
        },
        {
          field: "cosImage.apiUrl",
          label: "COS 图片 API",
          bottomHelpMessage: "返回一张随机 COS 图片的接口地址",
          component: "Input"
        },
        {
          field: "cosImage.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // JK 图片
        // ============================================================
        {
          label: 'JK 图片',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "JK 图片",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "jkImage.enabled",
          label: "启用「JK 图片」",
          component: "Switch"
        },
        {
          field: "jkImage.apiUrl",
          label: "JK 图片 API",
          bottomHelpMessage: "返回一张随机 JK 图片的接口地址",
          component: "Input"
        },
        {
          field: "jkImage.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 黑丝图片
        // ============================================================
        {
          label: '黑丝图片',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "黑丝图片",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "heisiImage.enabled",
          label: "启用「黑丝图片」",
          component: "Switch"
        },
        {
          field: "heisiImage.apiUrl",
          label: "黑丝图片 API",
          bottomHelpMessage: "返回一张随机黑丝图片的接口地址",
          component: "Input"
        },
        {
          field: "heisiImage.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 白丝图片
        // ============================================================
        {
          label: '白丝图片',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "白丝图片",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "baisiImage.enabled",
          label: "启用「白丝图片」",
          component: "Switch"
        },
        {
          field: "baisiImage.apiUrl",
          label: "白丝图片 API",
          bottomHelpMessage: "返回一张随机白丝图片的接口地址",
          component: "Input"
        },
        {
          field: "baisiImage.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // KFC 疯狂星期四
        // ============================================================
        {
          label: 'KFC 疯狂星期四',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "KFC 疯狂星期四",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "KFCV50.enabled",
          label: "启用「KFC 疯狂星期四」",
          component: "Switch"
        },
        {
          field: "KFCV50.apiUrl",
          label: "KFC 文案 API",
          bottomHelpMessage: "返回一段 KFC 疯狂星期四文案的接口地址",
          component: "Input"
        },
        {
          field: "KFCV50.triggerKeywords",
          label: "触发关键词",
          bottomHelpMessage: "用户消息中包含任一关键词即触发回复",
          component: "GTags",
          componentProps: {
            placeholder: "如：疯狂星期四,KFC,#V50",
            allowAdd: true,
            allowDel: true
          }
        },
        {
          field: "KFCV50.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 历史上的今天
        // ============================================================
        {
          label: '历史上的今天',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "历史上的今天",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "historyToday.enabled",
          label: "启用「历史上的今天」",
          component: "Switch"
        },
        {
          field: "historyToday.apiUrl",
          label: "历史上的今天 API",
          bottomHelpMessage: "返回历史事件数据的接口地址",
          component: "Input"
        },
        {
          field: "historyToday.maxItems",
          label: "最多显示条数",
          bottomHelpMessage: "单次回复中包含的历史事件最大条数，默认 10",
          component: "InputNumber",
          componentProps: { min: 1, max: 50, step: 1 }
        },
        {
          field: "historyToday.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 结婚证生成器
        // ============================================================
        {
          label: '结婚证生成器',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "结婚证生成器",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "marriageCertificate.enabled",
          label: "启用「结婚证」",
          component: "Switch"
        },
        {
          field: "marriageCertificate.apiUrl",
          label: "结婚证图片 API",
          bottomHelpMessage: "返回结婚证图片的接口地址，自动在 URL 后拼接 ?n1={姓名1}&n2={姓名2}",
          component: "Input"
        },
        {
          field: "marriageCertificate.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 群聊帮助
        // ============================================================
        {
          label: '群聊帮助',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "群聊帮助",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "help.enabled",
          label: "启用「群聊帮助」",
          component: "Switch"
        },
        {
          field: "help.title",
          label: "主标题（60px）",
          bottomHelpMessage: "图片左上角的大标题",
          component: "Input",
          componentProps: { placeholder: "群聊帮助" }
        },
        {
          field: "help.subtitle",
          label: "副标题（20px）",
          bottomHelpMessage: "显示在主标题下方的说明文字",
          component: "Input",
          componentProps: { placeholder: "mCat群聊指令查看" }
        },
        {
          field: "help.bgMode",
          label: "背景模式",
          bottomHelpMessage: "选择使用 API 随机图片或指定本地图片作为背景",
          component: "Select",
          componentProps: {
            options: [
              { label: "API 随机图片", value: "api" },
              { label: "本地图片", value: "local" }
            ]
          }
        },
        {
          field: "help.bgApiUrl",
          label: "背景图片 API",
          bottomHelpMessage: "bgMode=api 时使用。默认：https://api.elaina.cat/random/mobile",
          component: "Input",
          componentProps: { placeholder: "https://api.elaina.cat/random/mobile" }
        },
        {
          field: "help.bgLocalPath",
          label: "本地图片路径",
          bottomHelpMessage: "bgMode=local 时使用。填写本地图片的绝对路径，如 C:/Users/xxx/Pictures/bg.jpg",
          component: "Input",
          componentProps: { placeholder: "例如 C:/Users/xxx/Pictures/mybg.jpg" }
        },
        {
          field: "help.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        },

        // ============================================================
        // 插件更新 Update / Repair
        // ============================================================
        {
          label: '插件更新',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "插件更新（管理员）",
          componentProps: { orientation: "left", plain: true }
        },
        {
          field: "update.enabled",
          label: "启用「插件更新」",
          bottomHelpMessage: "启用后，管理员可使用 #更新群聊插件 / #修复群聊插件 指令",
          component: "Switch"
        },
        {
          field: "update.defaultPlatform",
          label: "默认拉取平台",
          bottomHelpMessage: "优先从该平台拉取文件，失败时自动回退到其他平台",
          component: "Select",
          componentProps: {
            options: [
              { label: "GitLab（推荐）", value: "gitlab" },
              { label: "Gitee（国内速度快）", value: "gitee" },
              { label: "GitHub（可能需要代理加速）", value: "github" }
            ]
          }
        },
        {
          field: "update.githubBranch",
          label: "GitHub 分支",
          bottomHelpMessage: "默认 main",
          component: "Input",
          componentProps: { placeholder: "main" }
        },
        {
          field: "update.githubProxy",
          label: "GitHub 代理地址",
          bottomHelpMessage: "可加速 GitHub 访问，如 https://ghproxy.com/，留空则直连",
          component: "Input",
          componentProps: { placeholder: "如 https://ghproxy.com/ 或留空" }
        },
        {
          field: "update.giteeBranch",
          label: "Gitee 分支",
          bottomHelpMessage: "默认 main",
          component: "Input",
          componentProps: { placeholder: "main" }
        },
        {
          field: "update.giteeUsername",
          label: "Gitee 账号",
          bottomHelpMessage: "当 Gitee API 要求登录时使用；留空则匿名访问",
          component: "Input",
          componentProps: { placeholder: "留空或填 Gitee 用户名" }
        },
        {
          field: "update.giteePassword",
          label: "Gitee 密码",
          bottomHelpMessage: "配合 Gitee 账号使用；留空则匿名访问",
          component: "Input",
          componentProps: { placeholder: "留空或填 Gitee 密码", type: "password" }
        },
        {
          field: "update.gitlabBranch",
          label: "GitLab 分支",
          bottomHelpMessage: "默认 main",
          component: "Input",
          componentProps: { placeholder: "main" }
        },
        {
          field: "update.gitlabAccessToken",
          label: "GitLab Access Token",
          bottomHelpMessage: "当 GitLab 仓库为私有时需填入；留空则匿名访问",
          component: "Input",
          componentProps: { placeholder: "留空或填 GitLab Personal Access Token", type: "password" }
        },
        {
          field: "update.sshKeyPath",
          label: "SSH 私钥路径",
          bottomHelpMessage: "SSH key 非默认文件名时填（如 ~/.ssh/id_ed25519_qunliao），留空则用 SSH 默认",
          component: "Input",
          componentProps: { placeholder: "留空 或 ~/.ssh/id_ed25519_qunliao" }
        },
        {
          field: "update.extraAdminQQ",
          label: "额外管理员 QQ",
          bottomHelpMessage: "除 Yunzai 内置 master 外，允许使用更新指令的 QQ 号。留空则只有 Bot 主人可用",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: []
          }
        },
        {
          field: "update.onlyGroupID",
          label: "白名单群",
          bottomHelpMessage: "仅在这些群生效，留空则所有群均生效",
          component: "Select",
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: "multiple",
            options: groupOptions
          }
        }
      ],

      getConfigData() {
        const cfg = Config.getConfig('config') || {}
        return cfg
      },

      setConfigData(data, { Result }) {
        try {
          // 读取当前配置作为基础对象（确保嵌套结构存在）
          let cfg = Config.getConfig('config') || {}
          cfg = typeof cfg === 'object' ? { ...cfg } : {}

          // 将扁平 keyPath 的 data 转换为嵌套对象（参照 siliconflow 的 lodash.set 逻辑）
          for (const [keyPath, value] of Object.entries(data || {})) {
            const keys = String(keyPath).split('.')
            let node = cfg
            for (let i = 0; i < keys.length - 1; i++) {
              const k = keys[i]
              if (!node[k] || typeof node[k] !== 'object' || Array.isArray(node[k])) {
                node[k] = {}
              }
              node = node[k]
            }
            node[keys[keys.length - 1]] = value
          }

          // 写入配置文件
          const saved = Config.setConfig(cfg, 'config')
          if (!saved) {
            return Result.error('保存失败，请查看控制台日志')
          }
          return Result.ok({}, '保存成功~配置已即时生效')
        } catch (err) {
          console.error('[qunliao-plugin] setConfigData error:', err)
          return Result.error('保存失败：' + (err?.message || err))
        }
      }
    }
  }
}

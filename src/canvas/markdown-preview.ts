import { Marked, type Tokens } from "marked"

import {
  escapeHtml,
  escapeHtmlAttribute,
  normalizeMarkdownImageSource,
  parseAllowedImageTag,
  parseAllowedInlineOpenTag,
  sanitizeMarkdownPreviewSource,
} from "@/canvas/markdown-sanitize"

export {
  escapeHtml,
  escapeHtmlAttribute,
  extractHtmlAttribute,
  normalizeMarkdownImageSource,
  parseAllowedImageTag,
  parseAllowedInlineOpenTag,
  sanitizeColorValue,
  sanitizeInlineStyle,
  sanitizeMarkdownPreviewSource,
  type AllowedInlineOpenTag,
  type SanitizedImageTag,
} from "@/canvas/markdown-sanitize"

const HEADING_PATTERN = /^(#{1,6})\s+/

export const MARKDOWN_PREVIEW_TEXT_LIMIT = 1200

function restorePlaceholders(value: string, prefix: string, placeholders: string[]): string {
  return placeholders.reduce(
    (current, html, index) => current.replaceAll(`%%${prefix}_${index}%%`, html),
    value,
  )
}

export function truncateMarkdownPreviewSource(markdown: string, limit = MARKDOWN_PREVIEW_TEXT_LIMIT): string {
  const normalized = sanitizeMarkdownPreviewSource(markdown)
  if (normalized.length <= limit) {
    return normalized
  }

  return `${normalized.slice(0, limit).trimEnd()}…`
}

export function extractHeadingSectionMarkdown(markdown: string, limit = MARKDOWN_PREVIEW_TEXT_LIMIT): string {
  const normalized = sanitizeMarkdownPreviewSource(markdown)
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n")
  const firstHeadingIndex = lines.findIndex((line) => HEADING_PATTERN.test(line.trim()))
  if (firstHeadingIndex < 0) {
    return truncateMarkdownPreviewSource(normalized, limit)
  }

  const headingLevel = lines[firstHeadingIndex]!.trim().match(HEADING_PATTERN)?.[1].length ?? 6
  const sectionLines = [lines[firstHeadingIndex]!]

  for (let index = firstHeadingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    const headingMatch = line.trim().match(HEADING_PATTERN)
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      break
    }
    sectionLines.push(line)
  }

  return truncateMarkdownPreviewSource(sectionLines.join("\n"), limit)
}

export interface MarkdownHeadingBlock {
  id: string
  level: number
  title: string
}

export interface MarkdownHeadingSection {
  level: number
  text: string
  title: string
}

export function extractMarkdownHeadingBlocks(markdown: string): MarkdownHeadingBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const headings: MarkdownHeadingBlock[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index]!.trim().match(/^(#{1,6})\s+(.+)$/)
    if (!headingMatch) {
      continue
    }

    const id = lines[index + 1]?.match(/\{\:\s*[^}]*\bid="(\d{14}-[a-z0-9]{7})"[^}]*\}/i)?.[1]
    if (!id) {
      continue
    }

    headings.push({
      id,
      level: headingMatch[1]!.length,
      title: headingMatch[2]!.trim(),
    })
  }

  return headings
}

export function extractMarkdownHeadingSections(markdown: string): MarkdownHeadingSection[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const headingIndexes: Array<{ index: number, level: number, title: string }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index]!.trim().match(/^(#{1,6})\s+(.+)$/)
    if (!headingMatch) {
      continue
    }

    headingIndexes.push({
      index,
      level: headingMatch[1]!.length,
      title: headingMatch[2]!.trim(),
    })
  }

  return headingIndexes.map((heading, index) => {
    const nextHeading = headingIndexes[index + 1]
    const sectionLines = lines.slice(heading.index, nextHeading?.index ?? lines.length)
    return {
      level: heading.level,
      text: sectionLines.join("\n").trim(),
      title: heading.title,
    }
  })
}

function extractAllowedInlineHtml(value: string): { placeholders: string[], text: string } {
  const placeholders: string[] = []
  let text = ""
  let index = 0

  while (index < value.length) {
    const openIndex = value.indexOf("<", index)
    if (openIndex === -1) {
      text += value.slice(index)
      break
    }

    text += value.slice(index, openIndex)

    const imageTag = parseAllowedImageTag(value.slice(openIndex))
    if (imageTag) {
      const placeholder = `%%HTML_${placeholders.length}%%`
      placeholders.push(imageTag.html)
      text += placeholder
      index = openIndex + imageTag.length
      continue
    }

    const openTag = parseAllowedInlineOpenTag(value.slice(openIndex))
    if (!openTag) {
      text += value[openIndex]!
      index = openIndex + 1
      continue
    }

    const contentStart = openIndex + openTag.length
    const closeIndex = value.toLowerCase().indexOf(openTag.closeTag, contentStart)
    const nextParagraphBreak = value.indexOf("\n\n", contentStart)
    let contentEnd: number

    if (closeIndex >= 0 && (nextParagraphBreak === -1 || closeIndex < nextParagraphBreak)) {
      contentEnd = closeIndex
    } else if (nextParagraphBreak >= 0) {
      contentEnd = nextParagraphBreak
    } else {
      contentEnd = value.length
    }

    const innerContent = value.slice(contentStart, contentEnd)
    const placeholder = `%%HTML_${placeholders.length}%%`

    placeholders.push(`${openTag.html}${innerContent}${openTag.closeTag}`)
    text += placeholder
    index = closeIndex >= 0 && closeIndex === contentEnd ? contentEnd + openTag.closeTag.length : contentEnd
  }

  return {
    placeholders,
    text,
  }
}

export function getVideoEmbedUrl(url: string): { type: "youtube" | "bilibili", embedUrl: string } | null {
  const cleanUrl = url.trim()
  let parsed: URL
  try {
    parsed = new URL(cleanUrl)
  } catch {
    // Try prepending https:// if it has no protocol
    if (!/^[a-zA-Z]+:\/\//i.test(cleanUrl)) {
      try {
        parsed = new URL(`https://${cleanUrl}`)
      } catch {
        return null
      }
    } else {
      return null
    }
  }

  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname

  // YouTube
  if (host.includes("youtube.com") || host.includes("youtu.be") || host.includes("youtube-nocookie.com")) {
    let videoId: string | null = null
    if (host.includes("youtu.be")) {
      videoId = path.slice(1)
    } else if (host.includes("youtube.com") || host.includes("youtube-nocookie.com")) {
      if (path.startsWith("/embed/")) {
        videoId = path.slice(7)
      } else if (path.startsWith("/shorts/")) {
        videoId = path.slice(8)
      } else if (path === "/watch") {
        videoId = parsed.searchParams.get("v")
      }
    }
    if (videoId) {
      videoId = videoId.split("?")[0].split("&")[0].split("/")[0]
      if (videoId) {
        return {
          type: "youtube",
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
        }
      }
    }
  }

  // Bilibili
  if (host.includes("bilibili.com") || host.includes("b23.tv")) {
    if (host.includes("player.bilibili.com")) {
      return {
        type: "bilibili",
        embedUrl: cleanUrl,
      }
    }
    const match = path.match(/\/video\/(BV[a-zA-Z0-9]+|av\d+)/i)
    if (match) {
      const id = match[1]!
      if (id.toLowerCase().startsWith("bv")) {
        return {
          type: "bilibili",
          embedUrl: createBilibiliEmbedUrl({ bvid: id }),
        }
      } else {
        const aid = id.slice(2)
        return {
          type: "bilibili",
          embedUrl: createBilibiliEmbedUrl({ aid }),
        }
      }
    }
    const bvid = parsed.searchParams.get("bvid")
    const aid = parsed.searchParams.get("aid")
    if (bvid) {
      return {
        type: "bilibili",
        embedUrl: createBilibiliEmbedUrl({ bvid }),
      }
    }
    if (aid) {
      return {
        type: "bilibili",
        embedUrl: createBilibiliEmbedUrl({ aid }),
      }
    }
  }

  return null
}

function createBilibiliEmbedUrl(params: { aid?: string, bvid?: string }): string {
  const searchParams = new URLSearchParams()

  if (params.bvid) {
    searchParams.set("bvid", params.bvid)
  } else if (params.aid) {
    searchParams.set("aid", params.aid)
  }

  searchParams.set("p", "1")
  searchParams.set("autoplay", "0")
  searchParams.set("high_quality", "1")
  searchParams.set("danmaku", "0")
  searchParams.set("as_wide", "1")

  return `https://player.bilibili.com/player.html?${searchParams.toString()}`
}

function createVideoIframeHtml(
  type: "youtube" | "bilibili",
  embedUrl: string,
  originalUrl: string,
  label?: string,
): string {
  const safeEmbedUrl = escapeHtmlAttribute(embedUrl)
  const safeOriginalUrl = escapeHtmlAttribute(originalUrl)
  const displayLabel = label?.trim() || (type === "youtube" ? "YouTube Video" : "Bilibili Video")
  const safeLabel = escapeHtml(displayLabel)

  const youtubeIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="color: #ff0000; display: inline-block; vertical-align: middle;"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.516 0-9.387.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11C4.483 20.455 12 20.455 12 20.455s7.517 0 9.387-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
  const bilibiliIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="color: #00aeec; display: inline-block; vertical-align: middle;"><path d="M17.877 1.258l1.49 1.336-2.617 2.923c.712.28 1.4.636 2.054 1.058l2.977-2.658 1.488 1.338-3.993 3.566c.866.93 1.547 2.003 2.005 3.197.643 1.678.711 3.447.195 5.17a10.278 10.278 0 0 1-5.116 6.305c-1.637.893-3.447 1.242-5.26 1.018a10.354 10.354 0 0 1-6.19-2.993 10.024 10.024 0 0 1-2.695-5.918c-.378-2.029.071-4.093 1.272-5.86.883-1.3 2.046-2.333 3.39-3.007L2.9 3.585l1.488-1.337 2.976 2.657c.654-.422 1.342-.777 2.055-1.057L6.802 1.258V1.26l1.488 1.336 3.187 3.56c.415-.058.835-.088 1.257-.088.423 0 .843.03 1.258.087l3.187-3.56 1.489.317c.07-.107.139-.214.21-.32zm-3.076 11.233c-.63 0-1.144.577-1.144 1.288s.514 1.288 1.144 1.288 1.144-.577 1.144-1.288-.514-1.288-1.144-1.288zm-5.602 0c-.63 0-1.144.577-1.144 1.288s.514 1.288 1.144 1.288 1.144-.577 1.144-1.288-.514-1.288-1.144-1.288z"/></svg>`

  const icon = type === "youtube" ? youtubeIcon : bilibiliIcon

  return `<div class="video-card video-card--${type}">`
    + `<div class="video-card__header">`
    + `<span class="video-card__platform-icon">${icon}</span>`
    + `<span class="video-card__title">${safeLabel}</span>`
    + `<a class="video-card__open-link" href="${safeOriginalUrl}" target="_blank" rel="noopener noreferrer" title="在新标签页打开">↗</a>`
    + `</div>`
    + `<div class="video-card__iframe-container">`
    + `<iframe class="video-card__iframe" width="100%" height="100%" src="${safeEmbedUrl}" scrolling="no" border="0" frameborder="no" framespacing="0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"></iframe>`
    + `</div>`
    + `</div>`
}

function parseSoloVideoLink(line: string): { type: "youtube" | "bilibili", embedUrl: string, originalUrl: string, label?: string } | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  // Try matching markdown link format: [label](url)
  const mdLinkMatch = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
  if (mdLinkMatch) {
    const label = mdLinkMatch[1]!
    const url = mdLinkMatch[2]!
    const videoInfo = getVideoEmbedUrl(url)
    if (videoInfo) {
      return {
        type: videoInfo.type,
        embedUrl: videoInfo.embedUrl,
        originalUrl: url,
        label,
      }
    }
  }

  // Try matching plain URL format: url
  const urlMatch = trimmed.match(/^(https?:\/\/[^\s)<>"]+)$/)
  if (urlMatch) {
    const url = urlMatch[1]!
    const videoInfo = getVideoEmbedUrl(url)
    if (videoInfo) {
      return {
        type: videoInfo.type,
        embedUrl: videoInfo.embedUrl,
        originalUrl: url,
      }
    }
  }

  return null
}

function extractVideoPlaceholders(text: string): { placeholders: string[], text: string } {
  const placeholders: string[] = []

  // 1. 抽取行内代码与代码块，防止代码块内的 url 被误替换
  const codePlaceholders: string[] = []
  let processed = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    const placeholder = `%%CODE_INLINE_${codePlaceholders.length}%%`
    codePlaceholders.push(`\`${code}\``)
    return placeholder
  })

  // 2. 匹配独占一行的独立视频链接
  const lines = processed.split("\n")
  const processedLines: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const soloVideo = parseSoloVideoLink(line)
    if (soloVideo) {
      const placeholder = `%%VIDEO_${placeholders.length}%%`
      placeholders.push(createVideoIframeHtml(soloVideo.type, soloVideo.embedUrl, soloVideo.originalUrl, soloVideo.label))
      processedLines.push(`\n\n${placeholder}\n\n`)
      continue
    }
    processedLines.push(line)
  }
  processed = processedLines.join("\n")

  // 3. 匹配行内的 Markdown 格式视频链接 [label](url)
  processed = processed.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, label: string, url: string) => {
    const videoInfo = getVideoEmbedUrl(url)
    if (videoInfo) {
      const placeholder = `%%VIDEO_${placeholders.length}%%`
      placeholders.push(createVideoIframeHtml(videoInfo.type, videoInfo.embedUrl, url, label))
      return placeholder
    }
    return match
  })

  // 4. 匹配行内的裸 URL
  processed = processed.replace(/(https?:\/\/[^\s)<>"]+)/g, (match) => {
    const videoInfo = getVideoEmbedUrl(match)
    if (videoInfo) {
      const placeholder = `%%VIDEO_${placeholders.length}%%`
      placeholders.push(createVideoIframeHtml(videoInfo.type, videoInfo.embedUrl, match, ""))
      return placeholder
    }
    return match
  })

  // 5. 还原行内代码
  processed = codePlaceholders.reduce(
    (current, code, index) => current.replaceAll(`%%CODE_INLINE_${index}%%`, code),
    processed,
  )

  return {
    placeholders,
    text: processed,
  }
}

function escapeRawHtmlOutsidePlaceholders(value: string): string {
  // 转义未被 %%HTML_\d+%% 保护的 < 标签（防止 <script> 等 XSS 攻击）
  return value.replace(/<(?!\/?%%HTML_\d+%%)([^>]+)>/g, (match) => {
    return escapeHtml(match)
  })
}

const markedInstance = new Marked({
  gfm: true,
  breaks: true,
})

markedInstance.use({
  renderer: {
    code({ text, lang }: { text: string, lang?: string }) {
      const language = (lang || "").trim().toLowerCase()
      const renderSubtypes = ["mermaid", "echarts", "chart", "mindmap", "flowchart", "graphviz", "math"]
      if (renderSubtypes.includes(language)) {
        const subtype = language === "chart" ? "echarts" : language
        const extraHtml = subtype === "echarts" ? '<div style="width:100%;height:320px;" contenteditable="false"></div>' : ""
        return `<div data-type="NodeCodeBlock" class="render-node" data-subtype="${subtype}" data-content="${escapeHtmlAttribute(text)}"><div spin="1"></div>${extraHtml}</div>\n`
      }
      return `<pre><code>${escapeHtml(text)}</code></pre>\n`
    },

    image({ href, title, text }: { href: string, title?: string | null, text: string }) {
      const src = escapeHtmlAttribute(normalizeMarkdownImageSource(href || ""))
      const alt = escapeHtmlAttribute(text || "")
      const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : ""
      return `<img src="${src}" alt="${alt}"${titleAttr}>`
    },

    link({ href, title, tokens }: { href: string, title?: string | null, tokens?: Tokens.Generic[] }) {
      const innerText = (this as any).parser?.parseInline ? (this as any).parser.parseInline(tokens || []) : href
      const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : ""
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${innerText}</a>`
    },

    list({ items, ordered, start }: { items: Array<{ text: string, task?: boolean, checked?: boolean, tokens?: Tokens.Generic[] }>, ordered: boolean, start?: number | "" }) {
      const hasTaskList = items.some((item) => item.task || item.text?.includes("task-list-item-checkbox"))
      const tag = ordered ? "ol" : "ul"
      const listClass = hasTaskList ? ' class="task-list"' : ""
      const startAttr = ordered && start && start !== 1 ? ` start="${start}"` : ""
      const body = items.map((item) => (this as any).listitem(item)).join("")
      return `<${tag}${startAttr}${listClass}>${body}</${tag}>\n`
    },

    listitem(item: { text: string, task?: boolean, checked?: boolean, tokens?: Tokens.Generic[] }) {
      const parser = (this as any).parser
      let content = ""

      if (item.tokens && item.tokens.length > 0 && parser) {
        // 如果只有一个纯文本或段落节点，解析为 inline 保持紧凑
        if (item.tokens.length === 1 && (item.tokens[0]?.type === "text" || item.tokens[0]?.type === "paragraph")) {
          const innerTokens = (item.tokens[0] as any).tokens || [item.tokens[0]]
          content = parser.parseInline(innerTokens)
        } else {
          content = parser.parse(item.tokens)
        }
      } else {
        content = item.text
      }

      if (item.task) {
        const checkboxHtml = `<input type="checkbox" disabled class="task-list-item-checkbox"${item.checked ? " checked" : ""}> `
        return `<li class="task-list-item">${checkboxHtml}${content}</li>`
      }
      return `<li>${content}</li>`
    },

    heading({ tokens, depth, text }: { tokens?: Tokens.Generic[], depth: number, text: string }) {
      const inlineHtml = (this as any).parser?.parseInline ? (this as any).parser.parseInline(tokens || []) : text
      const cleanHtml = inlineHtml.replace(/\s*#+\s*$/, "").trim()
      return `<h${depth}>${cleanHtml}</h${depth}>\n`
    },

    blockquote({ tokens, text }: { tokens?: Tokens.Generic[], text: string }) {
      const body = (this as any).parser?.parse ? (this as any).parser.parse(tokens || []) : `<p>${text}</p>`
      return `<blockquote>${body.trim()}</blockquote>\n`
    },

    paragraph({ tokens, text }: { tokens?: Tokens.Generic[], text: string }) {
      const inlineHtml = (this as any).parser?.parseInline ? (this as any).parser.parseInline(tokens || []) : text
      const trimmed = inlineHtml.trim()
      if (/^%%VIDEO_\d+%%$/.test(trimmed)) {
        return `${trimmed}\n`
      }
      return `<p>${inlineHtml}</p>\n`
    },
  },
})

export function renderMarkdownPreview(markdown: string): string {
  const normalized = sanitizeMarkdownPreviewSource(markdown)
  if (!normalized) {
    return ""
  }

  // 1. 保护代码块
  const codeBlockPlaceholders: string[] = []
  const lines = normalized.split("\n")
  const nonCodeLines: string[] = []
  let inCodeBlock = false
  let currentCodeLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true
        currentCodeLines = [line]
      } else {
        inCodeBlock = false
        currentCodeLines.push(line)
        const placeholder = `%%CODE_BLOCK_${codeBlockPlaceholders.length}%%`
        codeBlockPlaceholders.push(currentCodeLines.join("\n"))
        nonCodeLines.push(placeholder)
        currentCodeLines = []
      }
      continue
    }

    if (inCodeBlock) {
      currentCodeLines.push(line)
    } else {
      nonCodeLines.push(line)
    }
  }

  if (inCodeBlock && currentCodeLines.length > 0) {
    const placeholder = `%%CODE_BLOCK_${codeBlockPlaceholders.length}%%`
    codeBlockPlaceholders.push(currentCodeLines.join("\n"))
    nonCodeLines.push(placeholder)
  }

  const processedText = nonCodeLines.join("\n")

  // 2. 抽取白名单 HTML 标签（如 <font>, <mark>, <span style>, <img>）
  const { placeholders: htmlPlaceholders, text: textAfterHtml } = extractAllowedInlineHtml(processedText)

  // 3. 抽取视频链接占位符
  const { placeholders: videoPlaceholders, text: textAfterVideo } = extractVideoPlaceholders(textAfterHtml)

  // 4. 转义未受保护的非法 raw HTML 标签（如 <script>）
  const safeText = escapeRawHtmlOutsidePlaceholders(textAfterVideo)

  // 5. 还原代码块以供 marked 解析
  const textForMarked = restorePlaceholders(safeText, "CODE_BLOCK", codeBlockPlaceholders)

  // 6. 执行 marked 高速标准 GFM 解析
  let rendered = markedInstance.parse(textForMarked) as string

  // 7. 还原视频卡片
  rendered = restorePlaceholders(rendered, "VIDEO", videoPlaceholders)

  // 8. 还原安全白名单内联 HTML，并对其内部可能包含的 markdown 进行内联渲染
  const restoredHtmlPlaceholders = htmlPlaceholders.map((html) => {
    const match = html.match(/^((?:<mark|<font|<span)[\s\S]*?>)([\s\S]*?)((?:<\/mark>|<\/font>|<\/span>))$/i)
    if (match) {
      const openTag = match[1]!
      const inner = match[2]!
      const closeTag = match[3]!
      const renderedInner = (markedInstance.parseInline(inner) as string).trim()
      return `${openTag}${renderedInner}${closeTag}`
    }
    return html
  })

  rendered = restorePlaceholders(rendered, "HTML", restoredHtmlPlaceholders)

  return rendered.trim()
}

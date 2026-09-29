import { fetchSyncPost } from "siyuan"

/**
 * 清理斜杠菜单残留（用户敲的 `/过滤词`）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 为什么必须由插件自己做这件事 ★
 * ══════════════════════════════════════════════════════════════════════
 *   思源斜杠菜单调用插件的契约（从 main.js 的 fill() 读出，网盘插件已实测确认）：
 *
 *     cn.callback(D.getInstance(), ht)   // (protyle, 光标所在块元素)
 *     return;                            // ← 紧接着就 return 了
 *
 *   对照同一函数里**其它所有分支**（ZWSP、样式、普通插入…）：
 *   它们第一件事都是 `He.deleteContents()` —— 把用户敲的 `/` 和过滤词删掉。
 *   **唯独 plugin 分支没有这一步**：思源把「清掉 /xxx」留给了插件。
 *
 *   ⇒ 不做这件事，用户选完命令后笔记里会**残留 `/画布` 字样**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 为什么直连 fetchSyncPost，而不用 @/api 的 updateBlock / deleteBlock ★
 * ══════════════════════════════════════════════════════════════════════
 *   `api.ts` 的 `request()` 会**解包**：`response.code === 0 ? response.data : null`。
 *   而 deleteBlock / updateBlock 成功时内核返回的 `data` 就是 `null` ——
 *   于是「成功」和「失败」拿到的都是 null，**无法区分**。
 *   清理动作必须能确认「内核到底改没改」，否则会留下半截状态，
 *   所以这里直接用 fetchSyncPost 拿完整的 {code, msg}。
 */

type KernelResponse = { code?: number, msg?: string, data?: unknown } | null | undefined

/** 内核 API 薄封装：返回完整响应（含 code），失败不抛 */
async function kernelPost(path: string, body: Record<string, unknown>): Promise<KernelResponse> {
  try {
    return await fetchSyncPost(path, body) as KernelResponse
  } catch {
    return null
  }
}

/**
 * 判定「整块就是斜杠命令」的正则。
 * 例：`/`、`/画布`、`/canvas`、`/ 画布 `
 *
 * 斜杠字符有两种：半角 `/` 与中文顿号 `、`（思源两种都能唤起菜单），
 * 所以字符类统一写成 `[/、]`。
 */
const WHOLE_SLASH_BLOCK = /^\s*[/、]\S*\s*$/

/**
 * 判定「前文 + 斜杠命令」并**只保留前文**的正则。
 *
 * ★ 第一个捕获组**必须禁止出现斜杠**（`[^/、]*?`）★
 *   这是踩过坑才定下来的。曾经写成 `/^([\s\S]*?)\s*[/、]([^\s/、]*)\s*$/`
 *   再用「m[2] 不含斜杠」兜底，看似严谨，实则**被正则回溯绕过**：
 *
 *     输入 `路径 /usr/local/bin`
 *       → 先试 m[1]="路径 "  m[2]="usr/local/bin"（含 / ⇒ 守卫拦下）
 *       → 引擎回溯，改试 m[1]="路径 /usr"  m[2]="local"
 *         —— 第二个斜杠被吃进 m[1]，m[2] 反而不含斜杠，守卫失效！
 *       → 结果把用户的 `/usr/local/bin` 整段删掉，只剩 `路径 /usr`
 *
 *   改成组 1 不允许含斜杠后，锚点必然是「块内**最后一个**斜杠」，
 *   `/usr/local/bin` 这类路径天然整段保留。
 */
const TRAILING_SLASH_COMMAND = /^([^/、]*?)\s*[/、]([^\s/、]*)\s*$/

/**
 * 把用户敲的 `/过滤词` 从块里清掉。
 *
 * 两种情形：
 *   ① 整块只有 `/xxx`（且不是路径形状）⇒ **删除整个块**
 *      这种块本来就是用户为了唤起菜单而敲的，没有正文价值。
 *      早先用零宽占位符 `<wbr>` 去"保护"它，方向搞反了 ——
 *      用户看到的是插入完还挂着一个空行，还得手动删。
 *   ② 形如 `前文/过滤词` ⇒ 只删斜杠及其后内容，保留 `前文`
 *
 * @param anchorEl 斜杠菜单交给插件的「光标所在块元素」
 * @returns 是否真的改写了内核
 */
export async function cleanupSlashText(anchorEl: Element | null | undefined): Promise<boolean> {
  if (!anchorEl || anchorEl.nodeType !== 1) {
    return false
  }

  const el = anchorEl as HTMLElement

  // ── 1. 没有块 id 就不是真块，宁可不动 ──
  const blockId = el.getAttribute("data-node-id") || ""
  if (!blockId) {
    return false
  }

  // ── 2. 读「内层编辑区」文本，避开 protyle-attr 的零宽空格 ──
  //     实测外层块的 textContent = 正文 + "\u200b"，
  //     直接拿去匹配 `/^[/、]/` 会永远失败。
  const editEl = el.querySelector('[contenteditable="true"]') || el
  const raw = editEl.textContent || ""
  if (!raw) {
    return false
  }
  if (!raw.includes("/") && !raw.includes("、")) {
    return false
  }

  // ── 3. 判定目标文本；拿不准就返回 null（一个字都不改）──
  let next: string | null = null
  let deleteWholeBlock = false

  if (WHOLE_SLASH_BLOCK.test(raw)) {
    // 例外：`/usr/local/bin` 这种斜杠多于一个的，几乎一定是正文/路径，
    //       斜杠菜单的过滤词里不会再出现斜杠 ⇒ 保守放过。
    const slashCount = (raw.match(/\//g) || []).length
    if (slashCount > 1) {
      return false
    }
    deleteWholeBlock = true
    next = "" // 删块失败时的兜底：清成空串
  } else {
    const matched = raw.match(TRAILING_SLASH_COMMAND)
    // 过滤词必须非空：`前文/`（斜杠后没字了）交给用户自己，
    // 我们只负责「斜杠 + 过滤词」这种明确的菜单残留。
    if (matched && matched[2].length > 0) {
      next = matched[1]
    }
  }

  if (next === null) {
    return false
  }

  // ── 3.5 整块删除分支 ──
  if (deleteWholeBlock) {
    const deleted = await kernelPost("/api/block/deleteBlock", { id: blockId })
    if (deleted && deleted.code === 0) {
      return true
    }
    // 删不掉（例如只读块）就退化为清空内容，至少不留 /关键词 残渣
  }

  // ── 4. 已经干净了就别写内核（避免平白扰动光标/事务）──
  const current = raw.replace(/\u200b/g, "").trim()
  if (current === next.trim()) {
    return false
  }

  // ── 5. 走内核改写 —— 这一步才是「刷新后不再回来」的关键 ──
  //     只改 DOM 是存不住的：思源不认为那是一次编辑。
  const updated = await kernelPost("/api/block/updateBlock", {
    data: next,
    dataType: "markdown",
    id: blockId,
  })

  return Boolean(updated && updated.code === 0)
}

/** 供测试直接调用（与 siyuan-nebuladisk 的 `__nbCleanupSlashText` 同思路） */
export const __cleanupSlashText = cleanupSlashText

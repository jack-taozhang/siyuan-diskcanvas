<template>
  <div
    ref="canvasShellRef"
    class="canvas-shell"
    :class="{ 'canvas-shell--toolbar-collapsed': toolbarCollapsed }"
    data-testid="canvas-shell"
    :style="canvasShellInlineStyle"
    @dragstart.capture="handleShellCaptureDragStart"
    @dragover.capture="handleShellCaptureDragOver"
    @pointerdown.capture.middle="handleMiddleButtonDown"
  >
    <header
      class="canvas-toolbar"
      data-testid="top-toolbar"
      @pointerdown.capture="editor.deactivateCanvasSurface"
    >
      <div class="toolbar__group" :aria-label="t('toolbarGroupFile')">
        <button
          class="toolbar__button toolbar__button--icon toolbar__button--primary"
          data-testid="top-toolbar-new"
          :aria-label="t('toolbarNew')"
          :data-tooltip="t('toolbarNew')"
          type="button"
          @click="editor.newCanvas"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="new"
          />
        </button>
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-open"
          :aria-label="t('toolbarOpen')"
          :data-tooltip="t('toolbarOpen')"
          type="button"
          @click="editor.triggerImport"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="open"
          />
        </button>
        <button
          class="toolbar__button toolbar__button--icon toolbar__button--save"
          :class="{
            'toolbar__button--has-badge': editor.state.isDirty || editor.state.conflict,
            'toolbar__button--saving': editor.isSaving,
          }"
          data-testid="top-toolbar-save"
          :aria-label="editor.isSaving ? t('toolbarSaving') : t('toolbarSaveAs')"
          :data-tooltip="editor.isSaving ? t('toolbarSaving') : t('toolbarSaveAs')"
          :disabled="editor.isSaving"
          type="button"
          @click="editor.save"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="save"
          />
          <span
            v-if="editor.state.conflict"
            class="toolbar__button-badge toolbar__button-badge--danger"
            data-testid="top-toolbar-save-badge-conflict"
            aria-hidden="true"
          />
          <span
            v-else-if="editor.isSaving"
            class="toolbar__button-badge toolbar__button-badge--saving"
            data-testid="top-toolbar-save-badge-saving"
            aria-hidden="true"
          />
          <span
            v-else-if="editor.state.isDirty"
            class="toolbar__button-badge toolbar__button-badge--dirty"
            data-testid="top-toolbar-save-badge-dirty"
            aria-hidden="true"
          />
        </button>
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-refresh"
          :aria-label="t('toolbarRefresh')"
          :data-tooltip="t('toolbarRefresh')"
          type="button"
          @click="editor.reloadFromDisk"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="refresh"
          />
        </button>
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-export"
          :aria-label="t('toolbarExport')"
          :data-tooltip="t('toolbarExport')"
          type="button"
          @click="pngExportDialogVisible = true"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="export"
          />
        </button>
      </div>
      <span class="toolbar__divider" aria-hidden="true" />
      <div class="toolbar__group" :aria-label="t('toolbarGroupHistory')">
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-undo"
          :aria-label="t('toolbarUndo')"
          :data-tooltip="t('toolbarUndo')"
          :disabled="!editor.canUndo"
          type="button"
          @click="editor.undo"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="undo"
            :size="18"
          />
        </button>
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-redo"
          :aria-label="t('toolbarRedo')"
          :data-tooltip="t('toolbarRedo')"
          :disabled="!editor.canRedo"
          type="button"
          @click="editor.redo"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="redo"
            :size="18"
          />
        </button>
      </div>
      <span class="toolbar__divider" aria-hidden="true" />
      <div class="toolbar__group" :aria-label="t('toolbarGroupView')">
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-zoom-out"
          :aria-label="t('toolbarZoomOut')"
          :data-tooltip="t('toolbarZoomOut')"
          type="button"
          @click="editor.zoomOut"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="zoom-out"
          />
        </button>
        <button
          class="toolbar__stat toolbar__stat--button"
          data-testid="top-toolbar-scale-value"
          :aria-label="t('toolbarZoomActual')"
          :data-tooltip="t('toolbarZoomActual')"
          type="button"
          @click="editor.zoomToActualSize"
        >
          {{ Math.round(editor.viewport.scale * 100) }}%
        </button>
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-zoom-in"
          :aria-label="t('toolbarZoomIn')"
          :data-tooltip="t('toolbarZoomIn')"
          type="button"
          @click="editor.zoomIn"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="zoom-in"
          />
        </button>
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-reset-viewport"
          :aria-label="t('toolbarZoomFit')"
          :data-tooltip="t('toolbarZoomFit')"
          type="button"
          @click="editor.resetViewport"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="reset-viewport"
          />
        </button>
      </div>
      <span class="toolbar__divider" aria-hidden="true" />
      <div class="toolbar__group">
        <button
          ref="colorThemeButtonRef"
          class="toolbar__button toolbar__button--icon"
          :class="{ 'toolbar__button--active': colorThemePopoverOpen }"
          data-testid="top-toolbar-color-theme"
          :aria-label="t('toolbarColorTheme')"
          :data-tooltip="t('toolbarColorTheme')"
          aria-haspopup="menu"
          :aria-expanded="colorThemePopoverOpen"
          type="button"
          @click="toggleColorThemePopover"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="color"
          />
        </button>
      </div>
      <div class="toolbar__meta">
        <span class="toolbar__meta-stats">{{ t("toolbarGraphStats", { nodes: editor.state.document.nodes.length, edges: editor.state.document.edges.length }) }}</span>
        <span
          class="toolbar__status"
          :class="{
            'toolbar__status--dirty': editor.state.isDirty && !editor.state.conflict,
            'toolbar__status--saved': !editor.state.isDirty && !editor.state.conflict && !editor.isSaving,
            'toolbar__status--saving': editor.isSaving,
            'toolbar__status--conflict': !!editor.state.conflict,
          }"
        >
          <span class="toolbar__status-dot" aria-hidden="true" />
          {{
            editor.state.conflict
              ? t("toolbarConflictState")
              : editor.isSaving
                ? t("toolbarSavingState")
                : editor.state.isDirty
                  ? t("toolbarUnsavedChanges")
                  : t("toolbarSaved")
          }}
        </span>
      </div>
      <span class="toolbar__divider" aria-hidden="true" />
      <div class="toolbar__group">
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-help"
          :aria-label="t('helpDialogTitle')"
          :data-tooltip="t('helpDialogTitle')"
          type="button"
          @click="showHelpDialog"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="help"
          />
        </button>
        <button
          class="toolbar__button toolbar__button--icon"
          data-testid="top-toolbar-collapse"
          :aria-label="t('toolbarCollapse')"
          :data-tooltip="t('toolbarCollapse')"
          type="button"
          @click="toolbarCollapsed = true"
        >
          <CanvasIcon
            class="toolbar__icon"
            name="chevron-left"
          />
        </button>
      </div>
    </header>

    <div
      v-if="toolbarCollapsed"
      class="canvas-toolbar-collapsed-bar"
      @click="toolbarCollapsed = false"
    >
      <button
        class="collapsed-bar__button"
        :data-tooltip="t('toolbarExpand')"
        type="button"
      >
        <CanvasIcon
          name="chevron-right"
          :size="14"
        />
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="colorThemePopoverOpen"
        class="toolbar__theme-popover"
        data-testid="toolbar-color-theme-popover"
        :style="colorThemePopoverStyle"
        @pointerdown.stop
      >
        <button
          v-for="theme in editor.colorThemes"
          :key="theme.id"
          class="toolbar__theme-option"
          :class="{ 'toolbar__theme-option--active': editor.colorThemeId === theme.id }"
          :data-testid="`color-theme-${theme.id}`"
          type="button"
          @click="editor.setColorTheme(theme.id); colorThemePopoverOpen = false"
        >
          <span class="toolbar__theme-check" aria-hidden="true">
            {{ editor.colorThemeId === theme.id ? "✓" : "" }}
          </span>
          <span class="toolbar__theme-name">{{ t(theme.nameKey) }}</span>
          <span class="toolbar__theme-preview" aria-hidden="true">
            <span
              v-for="colorKey in ['1','2','3','4','5','6'] as const"
              :key="colorKey"
              class="toolbar__theme-dot"
              :style="{ backgroundColor: theme.colors[colorKey] }"
            />
          </span>
        </button>
      </div>
    </Teleport>

    <div
      class="workspace workspace--inspector-collapsed"
    >
      <section
        ref="stageRef"
        class="stage"
        :class="{
          'stage--readonly': editor.readonly,
        }"
        @pointerdown="handleStagePointerDown"
        @dblclick="handleStageDoubleClick"
        @paste="handleStagePaste"
        @wheel="editor.handleStageWheel"
        @contextmenu.prevent
        @dragover="editor.handleStageDragOver"
        @dragenter.prevent
        @drop.prevent="editor.handleStageDrop"
      >
        <div
          v-if="editor.state.conflict"
          class="conflict-banner"
          role="alert"
          data-testid="conflict-banner"
        >
          <div class="conflict-banner__body">
            <strong class="conflict-banner__title">{{ t('conflictBannerTitle') }}</strong>
            <span class="conflict-banner__description">{{ t('conflictBannerDescription') }}</span>
          </div>
          <div class="conflict-banner__actions">
            <button
              class="conflict-banner__button"
              type="button"
              @click="editor.loadConflictVersion"
            >
              {{ t('conflictBannerLoadDisk') }}
            </button>
            <button
              class="conflict-banner__button conflict-banner__button--primary"
              type="button"
              @click="editor.overwriteConflictVersion"
            >
              {{ t('conflictBannerOverwrite') }}
            </button>
          </div>
        </div>
        <div
          class="stage__world"
          :class="{
            // 演示模式已剥离
          }"
          :style="{
            height: `${editor.board.height}px`,
            transform: `translate(${editor.viewport.x}px, ${editor.viewport.y}px) scale(${editor.viewport.scale})`,
            width: `${editor.board.width}px`,
          }"
        >
          <svg
            class="stage__edges"
            :height="editor.board.height"
            :viewBox="`0 0 ${editor.board.width} ${editor.board.height}`"
            :width="editor.board.width"
          >
            <defs>
              <marker
                :id="edgeMarkerIds.base"
                markerHeight="14"
                markerUnits="userSpaceOnUse"
                markerWidth="14"
                orient="auto"
                refX="11"
                refY="7"
                viewBox="0 0 14 14"
              >
                <path
                  d="M 1.5 1.5 L 12 7 L 1.5 12.5 L 4.75 7 z"
                  fill="context-stroke"
                />
              </marker>
              <marker
                :id="edgeMarkerIds.end"
                markerHeight="14"
                markerUnits="userSpaceOnUse"
                markerWidth="14"
                orient="auto"
                refX="11"
                refY="7"
                viewBox="0 0 14 14"
              >
                <path
                  d="M 1.5 1.5 L 12 7 L 1.5 12.5 L 4.75 7 z"
                  fill="context-stroke"
                />
              </marker>
              <marker
                :id="edgeMarkerIds.start"
                markerHeight="14"
                markerUnits="userSpaceOnUse"
                markerWidth="14"
                orient="auto-start-reverse"
                refX="11"
                refY="7"
                viewBox="0 0 14 14"
              >
                <path
                  d="M 1.5 1.5 L 12 7 L 1.5 12.5 L 4.75 7 z"
                  fill="context-stroke"
                />
              </marker>
            </defs>
            <g
              v-for="edge in editor.state.document.edges"
              :key="`path-${edge.id}`"
            >
              <path
                class="stage__edge"
                :class="{ 'stage__edge--selected': editor.state.selectedEdgeId === edge.id }"
                :d="editor.getEdgePath(edge)"
                fill="none"
                :marker-start="resolveEdgeStartMarker(edge.startArrow ?? false)"
                :marker-end="resolveEdgeEndMarker(edge.endArrow ?? true)"
                stroke="#6b7280"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                :style="getEdgeStrokeStyle(edge)"
                @click.stop="editor.selectEdge(edge.id)"
              />
            </g>
            <path
              v-if="editor.connectionDraft.visible"
              class="stage__edge stage__edge--draft"
              :d="editor.getConnectionDraftPath()"
              fill="none"
              :marker-end="edgeMarkerRefs.base"
              stroke="#3b82f6"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
            />
            <path
              v-if="editor.edgeReconnectDraft.visible"
              class="stage__edge stage__edge--draft"
              data-testid="edge-reconnect-draft"
              :d="editor.getEdgeReconnectDraftPath()"
              fill="none"
              :marker-start="editor.edgeReconnectDraft.endpoint === 'from' ? edgeMarkerRefs.start : undefined"
              :marker-end="editor.edgeReconnectDraft.endpoint === 'to' ? edgeMarkerRefs.end : undefined"
              stroke="#3b82f6"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
            />
            <g
              v-for="edge in editor.state.document.edges"
              :key="`label-${edge.id}`"
            >
              <text
                v-if="edge.label"
                class="stage__edge-label"
                :x="editor.getEdgeLabelPosition(edge).x"
                :y="editor.getEdgeLabelPosition(edge).y"
                :style="getEdgeLabelStyle(edge)"
                @click.stop="editor.selectEdge(edge.id)"
              >
                {{ edge.label }}
              </text>
            </g>
          </svg>

          <svg
            v-if="editor.alignmentGuides.visible"
            class="stage__alignment-guides"
            :height="editor.board.height"
            :viewBox="`0 0 ${editor.board.width} ${editor.board.height}`"
            :width="editor.board.width"
          >
            <line
              v-for="guide in editor.alignmentGuides.guides"
              :key="`${guide.axis}-${guide.kind}-${guide.position}`"
              class="stage__alignment-guide"
              :data-testid="`alignment-guide-${guide.axis}`"
              :x1="guide.axis === 'x' ? guide.position - editor.board.left : 0"
              :x2="guide.axis === 'x' ? guide.position - editor.board.left : editor.board.width"
              :y1="guide.axis === 'y' ? guide.position - editor.board.top : 0"
              :y2="guide.axis === 'y' ? guide.position - editor.board.top : editor.board.height"
            />
          </svg>

          <article
            v-for="node in editor.displayNodes"
            :key="node.id"
            class="canvas-node"
            :data-canvas-node-id="node.id"
            :data-canvas-node-type="node.type"
            :class="[
              `canvas-node--${node.type}`,
              {
                'canvas-node--search-current': hasCanvasCurrentSearchMatch(node.id),
                'canvas-node--search-match': hasCanvasSearchMatch(node.id),
                'canvas-node--selected': editor.state.selectedNodeIds.includes(node.id),
                'canvas-node--no-header': !showNodeHeader,
                'canvas-node--group-collapsed': node.type === 'group' && node.collapsed,
                // 虚线样式（#17）：显式指定线型时才加类，缺省交由各类型自己的默认样式
                'canvas-node--dashed': node.lineStyle === 'dashed',
                'canvas-node--solid': node.lineStyle === 'solid',
              },
            ]"
            :style="getCanvasNodeStyle(node)"
            draggable="false"
            @pointerdown.stop="handleNodePointerDown(node, $event)"
            @mousedown.stop
            @click.stop="handleNodeClick(node, $event)"
            @dblclick.stop="handleNodeDoubleClick(node)"
            @wheel.passive="handleNodeWheel($event)"
            @mouseenter="handleNodeMouseEnter(node.id)"
            @mouseleave="handleNodeMouseLeave(node.id)"
            @dragstart.stop.prevent="handleNodeDragStart"
          >
            <header
              v-if="node.type !== 'group' && showNodeHeader"
              class="canvas-node__header"
              data-drag-handle="true"
              draggable="false"
            >
              <CanvasIcon
                class="canvas-node__header-icon"
                :name="getNodeHeaderIconName(node)"
                :size="14"
              />
              <span class="canvas-node__header-title" draggable="false">{{ getNodeHeaderTitle(node) }}</span>
              <!-- ★ 徽标移入抬头（用户要求）：与抬头同一行、靠右，避免正文再占一行 ★ -->
              <span
                v-if="getNodeHeaderBadge(node)"
                class="canvas-node__header-badge"
                draggable="false"
              >{{ getNodeHeaderBadge(node) }}</span>
              <a
                v-if="node.type === 'link' && node.url"
                class="canvas-node__header-action"
                :href="node.url"
                target="_blank"
                rel="noopener noreferrer"
                :title="t('linkCardOpenInBrowser')"
                @click.stop
                @pointerdown.stop
              >↗</a>
            </header>
            <div
              v-if="node.type !== 'group' || !node.collapsed"
              class="canvas-node__body"
              :class="{ 'canvas-node__body--selectable': node.type === 'text' || node.type === 'link' }"
            >
              <template v-if="shouldRenderNodeContent(node)">
                <template v-if="node.type === 'text'">
                <textarea
                  v-if="editingNodeId === node.id"
                  :ref="setEditingTextareaRef"
                  v-model="editingMarkdown"
                  class="canvas-node__editor"
                  @blur="commitTextNodeEditing"
                />
                <div
                  v-else
                  v-native-render
                  class="canvas-node__content markdown-preview"
                  data-canvas-field="text"
                  v-html="renderCanvasTextNodeContent(node)"
                />
              </template>
              <template v-else-if="node.type === 'file'">
                <div v-native-render data-canvas-field="note">
                  <CanvasFileCard
                    :canvas-thumbnail-view-box="getCanvasThumbnailViewBox(editor.getFileNodePreview(node).thumbnail)"
                    :document-preview-html="getFileCardDocumentPreviewHtml(node)"
                    :image-src="getFileCardImageSource(node)"
                    :node="node"
                    :preview="editor.getFileNodePreview(node)"
                    :show-detail="shouldShowFileCardDetail(node)"
                    :show-helper="shouldShowFileCardHelper(node)"
                    :show-headline="shouldShowFileCardHeadline(node)"
                    :tooltip="getFileCardTooltip(node)"
                    @image-error="handleFileCardImageError"
                    @preview-image-error="handleFileCardPreviewImageError"
                  />
                </div>
              </template>
              <template v-else-if="node.type === 'link'">
                <textarea
                  v-if="editingNodeId === node.id"
                  :ref="setEditingTextareaRef"
                  v-model="editingMarkdown"
                  class="canvas-node__editor"
                  @blur="commitTextNodeEditing"
                />
                <div
                  v-else
                  class="link-card"
                >
                  <div class="link-card__iframe-wrapper">
                    <iframe
                      :key="getLinkIframeKey(node)"
                      :src="getLinkNodeUrl(node)"
                      class="link-card__iframe"
                      :class="{ 'link-card__iframe--bilibili': isBilibiliLinkNode(node) }"
                      :style="getLinkIframeStyle(node)"
                      width="100%"
                      height="100%"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
                      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                      @error="onLinkIframeError(node.id)"
                    />
                    <!-- 未选中时遮罩拦截 iframe 抢焦点；选中后才允许直接交互 -->
                    <div
                      v-if="!editor.state.selectedNodeIds.includes(node.id)"
                      class="link-card__shield"
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </template>
              <template v-else-if="node.type === 'query'">
                <!-- 编辑状态：SQL 输入表单 -->
                <div
                  v-if="editingNodeId === node.id"
                  class="canvas-node__query-editor"
                  @pointerdown.stop
                >
                  <label class="query-editor__label">
                    <span>SQL 语句</span>
                    <textarea
                      v-model="editingQuerySql"
                      class="query-editor__textarea"
                      placeholder="SELECT * FROM blocks WHERE ..."
                      @keydown.stop
                    />
                  </label>
                  <div class="query-editor__row">
                    <label class="query-editor__input-group">
                      <span>自动刷新 (秒, 0代表手动)</span>
                      <input
                        v-model.number="editingQueryInterval"
                        type="number"
                        min="0"
                        class="query-editor__input"
                        @keydown.stop
                      />
                    </label>
                    <label class="query-editor__input-group">
                      <span>最大结果数</span>
                      <input
                        v-model.number="editingQueryMaxResults"
                        type="number"
                        min="1"
                        class="query-editor__input"
                        @keydown.stop
                      />
                    </label>
                  </div>
                  <div class="query-editor__buttons">
                    <button
                      class="query-editor__btn query-editor__btn--cancel"
                      type="button"
                      @click.stop="cancelQueryEditing"
                    >
                      取消
                    </button>
                    <button
                      class="query-editor__btn query-editor__btn--save"
                      type="button"
                      @click.stop="saveQueryEditing(node)"
                    >
                      保存
                    </button>
                  </div>
                </div>

                <!-- 正常展示状态 -->
                <div v-else class="canvas-node__query-view">
                  <header class="canvas-node__query-header">
                    <div class="query-header__left">
                      <CanvasIcon
                        class="query-header__icon"
                        name="search"
                        :size="14"
                      />
                      <span class="query-header__title">SQL 查询结果</span>
                      <span
                        v-if="queryResultsMap[node.id]"
                        class="query-header__count-badge"
                        title="查询结果数量"
                      >
                        {{ queryResultsMap[node.id].length }}
                      </span>
                      <span
                        v-if="node.refreshInterval && node.refreshInterval > 0"
                        class="query-header__badge"
                        title="已启用定时自动刷新"
                      >
                        ⏱️ {{ node.refreshInterval }}s
                      </span>
                    </div>
                    <div class="query-header__right">
                      <button
                        class="query-header__btn"
                        title="立即刷新"
                        type="button"
                        :disabled="queryLoadingMap[node.id]"
                        @click.stop="fetchQueryResult(node)"
                        @pointerdown.stop
                      >
                        <CanvasIcon
                          class="query-header__btn-icon"
                          :class="{ 'query-header__btn-icon--rotating': queryLoadingMap[node.id] }"
                          name="refresh"
                          :size="12"
                        />
                      </button>
                      <button
                        class="query-header__btn"
                        title="编辑 SQL"
                        type="button"
                        @click.stop="startQueryEditing(node)"
                        @pointerdown.stop
                      >
                        <CanvasIcon
                          class="query-header__btn-icon"
                          name="edit"
                          :size="12"
                        />
                      </button>
                    </div>
                  </header>
                  
                  <div class="canvas-node__query-content">
                    <!-- Loading 状态 -->
                    <div v-if="queryLoadingMap[node.id] && (!queryResultsMap[node.id] || !queryResultsMap[node.id].length)" class="query-status-info">
                      <div class="query-loading-spinner" />
                      <span>正在执行 SQL 查询...</span>
                    </div>

                    <!-- 错误状态 -->
                    <div v-else-if="queryErrorsMap[node.id]" class="query-error-info">
                      <span class="query-error-title">SQL 执行失败:</span>
                      <span class="query-error-msg">{{ queryErrorsMap[node.id] }}</span>
                    </div>

                    <!-- 空结果状态 -->
                    <div v-else-if="!queryResultsMap[node.id] || !queryResultsMap[node.id].length" class="query-status-info">
                      <span>无符合条件的查询结果</span>
                    </div>

                    <!-- 正常结果列表 -->
                    <div v-else class="query-results-list">
                      <div
                        v-for="(block, idx) in queryResultsMap[node.id]"
                        :key="block.id"
                        class="query-result-item"
                        draggable="true"
                        @pointerdown.stop
                        @dragstart="handleQueryResultDragStart($event, block.id, node.id)"
                      >
                        <div class="query-result-item__index-wrapper">
                          <div class="query-result-item__index">{{ idx + 1 }}</div>
                          <span
                            class="query-result-item__badge"
                            :class="block.type === 'd' ? 'query-result-item__badge--doc' : 'query-result-item__badge--block'"
                          >
                            {{ block.type === 'd' ? '文档' : '块' }}
                          </span>
                        </div>
                        <div class="query-result-item__body markdown-preview" v-html="block.renderedHtml" />
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else />
            </template>
            <div v-else class="canvas-node__content-skeleton" aria-hidden="true" />
          </div>
            <template v-if="node.type === 'group'">
              <div v-if="node.collapsed" class="canvas-node__group-collapsed-header" @dblclick.stop="editor.toggleGroupCollapse(node.id)">
                <CanvasIcon
                  class="canvas-node__group-collapsed-icon"
                  name="group"
                  :size="16"
                />
                <span class="canvas-node__group-collapsed-label">{{ node.label || '未命名群组' }}</span>
                <span class="canvas-node__group-collapsed-badge">{{ node.collapsedNodes?.length || 0 }}</span>
              </div>
              <template v-else>
                <textarea
                  v-if="editingNodeId === node.id"
                  :ref="setEditingTextareaRef"
                  v-model="editingMarkdown"
                  class="canvas-node__group-label canvas-node__group-label-editor"
                  @blur="commitTextNodeEditing"
                />
                <div
                  v-else
                  class="canvas-node__group-label"
                  data-canvas-field="label"
                  :style="getCanvasNodeContentStyle(node)"
                >
                  <span v-html="renderCanvasGroupLabel(node)" />
                </div>
              </template>
            </template>
            <template v-if="shouldRenderNodeHandles(node)">
              <button
                v-for="side in editor.sides"
                :key="`anchor-${node.id}-${side}`"
                class="canvas-node__anchor"
                :class="[
                  `canvas-node__anchor--${side}`,
                  { 'canvas-node__anchor--active': editor.isConnectionTarget(node.id, side) },
                ]"
                :data-testid="`node-anchor-${side}`"
                type="button"
                @pointerdown.stop.prevent="editor.startConnectionDrag(node, side, $event)"
              />
              <button
                v-for="segment in NODE_RESIZE_SEGMENTS"
                :key="`resize-${node.id}-${segment.id}`"
                class="canvas-node__resize-handle"
                :class="`canvas-node__resize-handle--${segment.id}`"
                :data-testid="`node-resize-${segment.id}`"
                type="button"
                @pointerdown.stop.prevent="editor.startResize(node, segment.side, $event)"
              />
              <button
                class="canvas-node__resize-corner"
                data-testid="node-resize-corner"
                type="button"
                @pointerdown.stop.prevent="editor.startCornerResize(node, $event)"
              >
                <svg class="resize-grip-icon" viewBox="0 0 10 10" width="10" height="10">
                  <path d="M8 2 L2 8 M9 5 L5 9 M9 8 L8 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" />
                </svg>
              </button>
            </template>
          </article>

          <svg
            class="stage__edges stage__edges--interactive"
            data-canvas-png-export-ignore="true"
            :height="editor.board.height"
            :viewBox="`0 0 ${editor.board.width} ${editor.board.height}`"
            :width="editor.board.width"
          >
            <g
              v-for="edge in editor.state.document.edges"
              :key="`interactive-${edge.id}`"
            >
              <path
                class="stage__edge stage__edge--overlay"
                :class="{
                  'stage__edge--hovered': hoveredEdgeId === edge.id,
                  'stage__edge--selected': editor.state.selectedEdgeId === edge.id,
                  'stage__edge--visible': hoveredEdgeId === edge.id || editor.state.selectedEdgeId === edge.id,
                }"
                :d="editor.getEdgePath(edge)"
                fill="none"
                :marker-start="resolveEdgeStartMarker(edge.startArrow ?? false)"
                :marker-end="resolveEdgeEndMarker(edge.endArrow ?? true)"
                :style="getEdgeStrokeStyle(edge)"
                :data-testid="`edge-overlay-${edge.id}`"
              />
              <path
                class="stage__edge stage__edge--hit-area"
                :d="editor.getEdgePath(edge)"
                fill="none"
                :data-testid="`edge-hit-area-${edge.id}`"
                @mouseenter="setHoveredEdge(edge.id)"
                @mouseleave="clearHoveredEdge(edge.id)"
                @pointerdown.stop
                @click.stop="handleEdgeClick(edge.id)"
              />
            </g>
          </svg>
        </div>

        <div
          v-if="editor.selectionBox.visible"
          class="stage__selection-box"
          :style="{
            height: `${editor.selectionBox.height}px`,
            left: `${editor.selectionBox.x}px`,
            top: `${editor.selectionBox.y}px`,
            width: `${editor.selectionBox.width}px`,
          }"
          data-testid="selection-box"
        />

        <button
          v-if="editor.selectedEdgeHandlePositions"
          class="edge-endpoint-handle"
          data-testid="edge-endpoint-from"
          type="button"
          :style="{
            left: `${editor.selectedEdgeHandlePositions.from.x}px`,
            top: `${editor.selectedEdgeHandlePositions.from.y}px`,
          }"
          @pointerdown.stop.prevent="editor.startEdgeEndpointDrag('from', $event)"
        />

        <button
          v-if="editor.selectedEdgeHandlePositions"
          class="edge-endpoint-handle"
          data-testid="edge-endpoint-to"
          type="button"
          :style="{
            left: `${editor.selectedEdgeHandlePositions.to.x}px`,
            top: `${editor.selectedEdgeHandlePositions.to.y}px`,
          }"
          @pointerdown.stop.prevent="editor.startEdgeEndpointDrag('to', $event)"
        />

        <div
          v-if="editor.edgeToolbar.visible && editor.capabilities.select"
          :ref="setEdgeToolbarRef"
          class="edge-toolbar selection-toolbar"
          :class="[
            `selection-toolbar--${editor.edgeToolbar.placement}`,
            `selection-toolbar--${selectionToolbarThemeMode}`,
          ]"
          :style="{
            left: `${editor.edgeToolbar.x}px`,
            top: `${editor.edgeToolbar.y}px`,
          }"
          data-testid="edge-toolbar"
          @click.stop
          @pointerdown.stop
        >
          <button
            class="selection-toolbar__button"
            data-testid="edge-toolbar-delete"
            :aria-label="SELECTION_TOOLBAR_TOOLTIPS.delete"
            :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.delete"
            type="button"
            @click.stop="editor.deleteSelection"
          >
              <CanvasIcon class="selection-toolbar__icon" name="delete" />
          </button>
          <button
            class="selection-toolbar__button"
            :class="{ 'selection-toolbar__button--active': editor.selectedEdge?.lineStyle === 'dashed' }"
            data-testid="edge-toolbar-line-style"
            :aria-label="t('lineStyleDashed')"
            :data-tooltip="t('lineStyleDashed')"
            type="button"
            @click.stop="toggleEdgeLineStyle"
          >
            <CanvasIcon class="selection-toolbar__icon" name="line-style" />
          </button>
          <div class="selection-toolbar__menu">
            <button
              class="selection-toolbar__button"
              :class="{ 'selection-toolbar__button--active': editor.edgeToolbarPopover === 'color' }"
              data-testid="edge-toolbar-color"
              :aria-label="SELECTION_TOOLBAR_TOOLTIPS.color"
              :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.color"
              type="button"
              @click.stop="editor.toggleEdgePopover('color')"
            >
              <CanvasIcon class="selection-toolbar__icon" name="color" />
            </button>
            <div
              v-if="editor.edgeToolbarPopover === 'color'"
              class="selection-toolbar__popover selection-toolbar__popover--colors"
              role="menu"
              data-testid="edge-color-palette"
              @click.stop
              @pointerdown.stop
            >
              <button
                v-for="color in editor.edgeColorOptions"
                :key="`edge-color-${color}`"
                class="selection-toolbar__swatch"
                :class="{ 'selection-toolbar__swatch--active': activeEdgeColor === color }"
                :data-testid="`edge-color-${color}`"
                :style="getSelectionColorStyle(color)"
                :aria-label="`${t('selectionToolbarColor')} ${color}`"
                :aria-pressed="activeEdgeColor === color"
                type="button"
                @click.stop="editor.applyEdgeColor(color)"
              />
              <button
                class="selection-toolbar__swatch selection-toolbar__swatch--clear"
                :class="{ 'selection-toolbar__swatch--active': activeEdgeColor === CLEAR_SELECTION_COLOR }"
                data-testid="edge-color-clear"
                :style="getSelectionColorStyle(CLEAR_SELECTION_COLOR)"
                :aria-label="t('selectionToolbarClearColor')"
                :aria-pressed="activeEdgeColor === CLEAR_SELECTION_COLOR"
                :title="t('selectionToolbarClearColor')"
                type="button"
                @click.stop="editor.applyEdgeColor(CLEAR_SELECTION_COLOR)"
              />
              <button
                v-if="lastCustomColor"
                class="selection-toolbar__swatch"
                :class="{ 'selection-toolbar__swatch--active': activeEdgeColor === lastCustomColor }"
                data-testid="edge-color-custom-last"
                :style="getSelectionColorStyle(lastCustomColor)"
                :aria-label="t('selectionToolbarLastCustomColor') || '最近自定义颜色'"
                :aria-pressed="activeEdgeColor === lastCustomColor"
                type="button"
                @click.stop="editor.applyEdgeColor(lastCustomColor)"
              />
              <button
                v-else
                class="selection-toolbar__swatch selection-toolbar__swatch--custom-empty"
                data-testid="edge-color-custom-empty"
                :aria-label="t('selectionToolbarCustomColorEmpty') || '未设置自定义颜色'"
                type="button"
                @click.stop="triggerCustomColorPicker('edge', $event)"
              >
                +
              </button>
              <button
                class="selection-toolbar__swatch selection-toolbar__swatch--picker"
                data-testid="edge-color-picker"
                :aria-label="t('selectionToolbarCustomColorPicker') || '自定义选色器'"
                type="button"
                @click.stop="triggerCustomColorPicker('edge', $event)"
              />
            </div>
          </div>
          <button
            class="selection-toolbar__button"
            data-testid="edge-toolbar-center"
            :aria-label="SELECTION_TOOLBAR_TOOLTIPS.center"
            :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.center"
            type="button"
            @click.stop="editor.centerEdgeInViewport"
          >
            <CanvasIcon class="selection-toolbar__icon" name="center" />
          </button>
          <div
            class="selection-toolbar__menu"
            data-testid="edge-toolbar-direction"
          >
            <button
              class="selection-toolbar__button"
              :class="{ 'selection-toolbar__button--active': editor.edgeToolbarPopover === 'direction' }"
              data-testid="edge-toolbar-direction-trigger"
              type="button"
              :aria-label="t('edgeToolbarDirection')"
              :data-tooltip="t('edgeToolbarDirection')"
              @click.stop="editor.toggleEdgePopover('direction')"
            >
              <CanvasIcon class="selection-toolbar__icon" name="edge-direction" />
            </button>
            <div
              v-if="editor.edgeToolbarPopover === 'direction'"
              class="selection-toolbar__popover selection-toolbar__popover--layout"
              role="menu"
              data-testid="edge-direction-menu"
              @click.stop
              @pointerdown.stop
            >
              <button
                class="selection-toolbar__menu-button"
                :class="{ 'selection-toolbar__menu-button--active': editor.selectedEdgeDirectionMode === 'none' }"
                data-testid="edge-toolbar-direction-none"
                type="button"
                @click.stop="editor.updateSelectedEdgeDirection('none')"
              >
                <CanvasIcon
                  class="selection-toolbar__menu-icon"
                  :name="EDGE_DIRECTION_ICON_NAMES.none"
                />
                {{ t("edgeDirectionNone") }}
              </button>
              <button
                class="selection-toolbar__menu-button"
                :class="{ 'selection-toolbar__menu-button--active': editor.selectedEdgeDirectionMode === 'single' }"
                data-testid="edge-toolbar-direction-single"
                type="button"
                @click.stop="editor.updateSelectedEdgeDirection('single')"
              >
                <CanvasIcon
                  class="selection-toolbar__menu-icon"
                  :name="EDGE_DIRECTION_ICON_NAMES.single"
                />
                {{ t("edgeDirectionSingle") }}
              </button>
              <button
                class="selection-toolbar__menu-button"
                :class="{ 'selection-toolbar__menu-button--active': editor.selectedEdgeDirectionMode === 'both' }"
                data-testid="edge-toolbar-direction-both"
                type="button"
                @click.stop="editor.updateSelectedEdgeDirection('both')"
              >
                <CanvasIcon
                  class="selection-toolbar__menu-icon"
                  :name="EDGE_DIRECTION_ICON_NAMES.both"
                />
                {{ t("edgeDirectionBoth") }}
              </button>
            </div>
          </div>
          <button
            class="selection-toolbar__button"
            data-testid="edge-toolbar-edit-label"
            :aria-label="t('edgeToolbarEditLabel')"
            :data-tooltip="t('edgeToolbarEditLabel')"
            type="button"
            @click.stop="editor.startEdgeLabelEditing"
          >
            <CanvasIcon class="selection-toolbar__icon" name="edit" />
          </button>
        </div>

        <input
          v-if="editor.editingEdgeLabelId && editor.edgeLabelEditorPosition"
          ref="edgeLabelInputRef"
          :value="editor.edgeLabelDraft"
          class="edge-label-editor"
          data-testid="edge-label-editor"
          :style="{
            left: `${editor.edgeLabelEditorPosition.x}px`,
            top: `${editor.edgeLabelEditorPosition.y}px`,
          }"
          @blur="editor.submitEdgeLabelEditing"
          @input="editor.updateEditingEdgeLabel(valueFromEvent($event))"
          @keydown="handleEdgeLabelEditorKeydown"
        >

        <div
          v-if="editor.bottomToolbarVisible && editor.capabilities.editDocument"
          class="bottom-toolbar"
          data-testid="bottom-toolbar"
          :style="{
            '--selection-toolbar-tooltip-bg': 'var(--canvas-floating-tooltip-bg)',
            '--selection-toolbar-tooltip-border': 'var(--canvas-floating-border)',
            '--selection-toolbar-tooltip-text': 'var(--canvas-floating-tooltip-text)',
          }"
          @click.stop
          @pointerdown.stop
        >
          <button
            class="bottom-toolbar__button"
            data-testid="bottom-toolbar-text"
            :aria-label="t('bottomToolbarText')"
            :data-tooltip="t('bottomToolbarText')"
            type="button"
            @click.stop="editor.addNode('text')"
          >
            <CanvasIcon
              class="bottom-toolbar__icon"
              name="text"
            />
          </button>
          <button
            class="bottom-toolbar__button"
            data-testid="bottom-toolbar-file"
            :aria-label="t('bottomToolbarFile')"
            :data-tooltip="t('bottomToolbarFile')"
            type="button"
            @click.stop="editor.openFilePickerDialog"
          >
            <CanvasIcon
              class="bottom-toolbar__icon"
              name="file"
            />
          </button>
          <button
            class="bottom-toolbar__button"
            data-testid="bottom-toolbar-asset"
            :aria-label="t('bottomToolbarAsset')"
            :data-tooltip="t('bottomToolbarAsset')"
            type="button"
            @click.stop="openAssetPicker"
          >
            <CanvasIcon
              class="bottom-toolbar__icon"
              name="asset"
            />
          </button>
          <button
            class="bottom-toolbar__button"
            data-testid="bottom-toolbar-nebula"
            :aria-label="t('bottomToolbarNebula')"
            :data-tooltip="t('bottomToolbarNebula')"
            type="button"
            @click.stop="openNebulaPicker"
          >
            <CanvasIcon
              class="bottom-toolbar__icon"
              name="nebula"
            />
          </button>
          <button
            class="bottom-toolbar__button"
            data-testid="bottom-toolbar-connect"
            :aria-label="t('bottomToolbarConnect')"
            :data-tooltip="t('bottomToolbarConnect')"
            type="button"
            @click.stop="editor.openCreateEdgeDialog"
          >
            <CanvasIcon
              class="bottom-toolbar__icon"
              name="connect"
            />
          </button>
          <button
            class="bottom-toolbar__button"
            data-testid="bottom-toolbar-group"
            :aria-label="t('bottomToolbarGroup')"
            :data-tooltip="t('bottomToolbarGroup')"
            type="button"
            @click.stop="editor.addNode('group')"
          >
            <CanvasIcon
              class="bottom-toolbar__icon"
              name="group"
            />
          </button>
        </div>

        <div
          v-if="editor.selectionToolbar.visible && editor.capabilities.select && !editingNodeId"
          :ref="setSelectionToolbarRef"
          class="selection-toolbar"
          :class="[
            `selection-toolbar--${editor.selectionToolbar.placement}`,
            `selection-toolbar--${selectionToolbarThemeMode}`,
          ]"
          :data-theme-mode="selectionToolbarThemeMode"
          :style="{
            left: `${editor.selectionToolbar.x}px`,
            top: `${editor.selectionToolbar.y}px`,
          }"
          data-testid="selection-toolbar"
          @click.stop
          @pointerdown.stop
        >
          <button
            class="selection-toolbar__button"
            data-testid="selection-toolbar-delete"
            :aria-label="SELECTION_TOOLBAR_TOOLTIPS.delete"
            :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.delete"
            type="button"
            @click.stop="editor.deleteSelection"
          >
            <CanvasIcon
              class="selection-toolbar__icon"
              name="delete"
            />
          </button>
          <button
            class="selection-toolbar__button"
            :class="{ 'selection-toolbar__button--active': selectionLineStyleIsDashed }"
            data-testid="selection-toolbar-line-style"
            :aria-label="t('lineStyleDashed')"
            :data-tooltip="t('lineStyleDashed')"
            type="button"
            @click.stop="toggleSelectionLineStyle"
          >
            <CanvasIcon class="selection-toolbar__icon" name="line-style" />
          </button>
          <div class="selection-toolbar__menu">
            <button
              class="selection-toolbar__button"
              :class="{ 'selection-toolbar__button--active': editor.selectionToolbarPopover === 'color' }"
              :aria-label="SELECTION_TOOLBAR_TOOLTIPS.color"
              :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.color"
              :aria-haspopup="'menu'"
              :aria-expanded="editor.selectionToolbarPopover === 'color'"
              data-testid="selection-toolbar-color"
              type="button"
              @click.stop="editor.toggleSelectionPopover('color')"
            >
              <CanvasIcon
                class="selection-toolbar__icon"
                name="color"
              />
            </button>
            <div
              v-if="editor.selectionToolbarPopover === 'color'"
              class="selection-toolbar__popover selection-toolbar__popover--colors"
              role="menu"
              data-testid="selection-color-palette"
              @click.stop
              @pointerdown.stop
            >
              <button
                v-for="color in editor.selectionColors"
                :key="color"
                class="selection-toolbar__swatch"
                :class="{ 'selection-toolbar__swatch--active': activeSelectionColor === color }"
                :data-testid="`selection-color-${color}`"
                :style="getSelectionColorStyle(color)"
                :aria-label="`${t('selectionToolbarColor')} ${color}`"
                :aria-pressed="activeSelectionColor === color"
                type="button"
                @click.stop="editor.applySelectionColor(color)"
              />
              <button
                class="selection-toolbar__swatch selection-toolbar__swatch--clear"
                :class="{ 'selection-toolbar__swatch--active': activeSelectionColor === CLEAR_SELECTION_COLOR }"
                data-testid="selection-color-clear"
                :style="getSelectionColorStyle(CLEAR_SELECTION_COLOR)"
                :aria-label="t('selectionToolbarClearColor')"
                :aria-pressed="activeSelectionColor === CLEAR_SELECTION_COLOR"
                :title="t('selectionToolbarClearColor')"
                type="button"
                @click.stop="editor.applySelectionColor(CLEAR_SELECTION_COLOR)"
              />
              <button
                v-if="lastCustomColor"
                class="selection-toolbar__swatch"
                :class="{ 'selection-toolbar__swatch--active': activeSelectionColor === lastCustomColor }"
                data-testid="selection-color-custom-last"
                :style="getSelectionColorStyle(lastCustomColor)"
                :aria-label="t('selectionToolbarLastCustomColor') || '最近自定义颜色'"
                :aria-pressed="activeSelectionColor === lastCustomColor"
                type="button"
                @click.stop="editor.applySelectionColor(lastCustomColor)"
              />
              <button
                v-else
                class="selection-toolbar__swatch selection-toolbar__swatch--custom-empty"
                data-testid="selection-color-custom-empty"
                :aria-label="t('selectionToolbarCustomColorEmpty') || '未设置自定义颜色'"
                type="button"
                @click.stop="triggerCustomColorPicker('selection', $event)"
              >
                +
              </button>
              <button
                class="selection-toolbar__swatch selection-toolbar__swatch--picker"
                data-testid="selection-color-picker"
                :aria-label="t('selectionToolbarCustomColorPicker') || '自定义选色器'"
                type="button"
                @click.stop="triggerCustomColorPicker('selection', $event)"
              />
            </div>
          </div>
          <button
            class="selection-toolbar__button"
            data-testid="selection-toolbar-center"
            :aria-label="SELECTION_TOOLBAR_TOOLTIPS.center"
            :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.center"
            type="button"
            @click.stop="editor.centerSelectionInViewport"
          >
            <CanvasIcon
              class="selection-toolbar__icon"
              name="center"
            />
          </button>
          <button
            v-if="editor.canRefreshSelectedSiyuanNode"
            class="selection-toolbar__button"
            data-testid="selection-toolbar-refresh"
            :aria-label="SELECTION_TOOLBAR_TOOLTIPS.refresh"
            :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.refresh"
            type="button"
            @click.stop="editor.refreshSelectedSiyuanNode"
          >
            <CanvasIcon
              class="selection-toolbar__icon"
              name="refresh"
            />
          </button>
                              <button
            v-if="editor.selectedNodeCount === 1 && editor.selectedNode"
            class="selection-toolbar__button"
            data-testid="selection-toolbar-edit"
            :aria-label="SELECTION_TOOLBAR_TOOLTIPS.edit"
            :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.edit"
            type="button"
            @click.stop="handleToolbarEdit"
          >
            <CanvasIcon
              class="selection-toolbar__icon"
              name="edit"
            />
          </button>
          <button
            v-if="editor.canRelayoutConnectedNodes"
            class="selection-toolbar__button"
            data-testid="selection-toolbar-relayout"
            :aria-label="SELECTION_TOOLBAR_TOOLTIPS.relayout"
            :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.relayout"
            type="button"
            @click.stop="editor.relayoutConnectedNodes"
          >
            <CanvasIcon
              class="selection-toolbar__icon"
              name="arrange-row"
            />
          </button>
          <button
            v-if="editor.state.selectedNodeIds.length === 1 && editor.state.document.nodes.find(n => n.id === editor.state.selectedNodeIds[0])?.type === 'group'"
            class="selection-toolbar__button"
            data-testid="selection-toolbar-toggle-group-collapse"
            :aria-label="editor.state.document.nodes.find(n => n.id === editor.state.selectedNodeIds[0])?.collapsed ? '展开群组' : '折叠群组'"
            :data-tooltip="editor.state.document.nodes.find(n => n.id === editor.state.selectedNodeIds[0])?.collapsed ? '展开群组' : '折叠群组'"
            type="button"
            @click.stop="editor.toggleGroupCollapse(editor.state.selectedNodeIds[0])"
          >
            <CanvasIcon
              class="selection-toolbar__icon"
              :name="editor.state.document.nodes.find(n => n.id === editor.state.selectedNodeIds[0])?.collapsed ? 'unfold' : 'fold'"
            />
          </button>
          <template v-else-if="editor.selectedNodeCount > 1">
                                    <button
              class="selection-toolbar__button"
              data-testid="selection-toolbar-create-group"
              :aria-label="SELECTION_TOOLBAR_TOOLTIPS.createGroup"
              :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.createGroup"
              type="button"
              @click.stop="editor.createGroupFromSelection"
            >
              <CanvasIcon
                class="selection-toolbar__icon"
                name="group"
              />
            </button>

            <div class="selection-toolbar__menu">
              <button
                class="selection-toolbar__button"
                :class="{ 'selection-toolbar__button--active': editor.selectionToolbarPopover === 'layout' }"
                :aria-label="SELECTION_TOOLBAR_TOOLTIPS.align"
                :data-tooltip="SELECTION_TOOLBAR_TOOLTIPS.align"
                :aria-haspopup="'menu'"
                :aria-expanded="editor.selectionToolbarPopover === 'layout'"
                data-testid="selection-toolbar-align"
                type="button"
                @click.stop="editor.toggleSelectionPopover('layout')"
              >
                <CanvasIcon
                  class="selection-toolbar__icon"
                  name="align"
                />
              </button>
              <div
                v-if="editor.selectionToolbarPopover === 'layout'"
                class="selection-toolbar__popover selection-toolbar__popover--layout"
                role="menu"
                data-testid="selection-layout-menu"
                @click.stop
                @pointerdown.stop
              >
                <button
                  v-for="layoutAction in editor.selectionLayoutActions"
                  :key="layoutAction.action"
                  class="selection-toolbar__menu-button"
                  :data-testid="`selection-layout-action-${layoutAction.action}`"
                  :data-tooltip="layoutAction.label"
                  type="button"
                  @click.stop="editor.applySelectionLayout(layoutAction.action)"
                >
                  <CanvasIcon
                    class="selection-toolbar__menu-icon"
                    :name="SELECTION_LAYOUT_ICON_NAMES[layoutAction.action]"
                  />
                  {{ layoutAction.label }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <CanvasMinimap
          v-if="showCanvasThumbnails"
          :editor="editor"
        />

        <div
          v-if="editor.isRelayouting"
          class="canvas-relayout-overlay"
          data-testid="relayout-overlay"
        >
          <div class="canvas-relayout-spinner" />
          <span class="canvas-relayout-text">{{ t('relayoutComputing') }}</span>
        </div>

        <div
          v-if="editor.filePickerDialog.visible"
          class="canvas-dialog-backdrop"
          data-testid="file-picker-dialog"
          @click.self="editor.closeFilePickerDialog"
        >
          <div
            class="canvas-dialog"
            @wheel.passive.stop
          >
            <div class="canvas-dialog__header">
              <h2>{{ t("filePickerDialogTitle") }}</h2>
            </div>
            <label class="canvas-dialog__field">
              <span>{{ t("filePickerSearchLabel") }}</span>
              <input
                ref="filePickerInputRef"
                :value="editor.filePickerDialog.query"
                class="canvas-dialog__control"
                @input="editor.updateFilePickerQuery(valueFromEvent($event))"
                @keydown="onFilePickerKeyDown"
              >
            </label>
            <div ref="filePickerOptionsRef" class="canvas-node-picker__options">
              <template v-for="group in getFilePickerGroups()" :key="group.kind">
                <div class="canvas-node-picker__group-header">{{ getFilePickerGroupLabel(group.kind) }}</div>
                <button
                  v-for="result in group.items"
                  :key="`file-picker-${result.kind}-${result.path}`"
                  :class="['canvas-node-picker__option', { 'canvas-node-picker__option--active': getFilePickerFlatIndex(result) === filePickerActiveIndex }]"
                  :data-testid="`file-picker-option-${result.kind}`"
                  type="button"
                  @click="editor.selectFilePickerResult(result)"
                  @mouseenter="filePickerActiveIndex = getFilePickerFlatIndex(result)"
                >
                  <span class="canvas-node-picker__option-kind">{{ getFilePickerKindLabel(result.kind) }}</span>
                  <strong v-html="highlightText(result.title, editor.filePickerDialog.query)" />
                  <span v-html="highlightText(result.subtitle, editor.filePickerDialog.query)" />
                </button>
              </template>
            </div>
          </div>
        </div>
      </section>

    </div>

    <CanvasCreateEdgeDialog
      v-if="editor.createEdgeDialog.visible"
      :editor="editor"
      :get-side-label="getSideLabel"
      :t="t"
    />

    <!--
      ★ 只以 nebulaPickerVisible 为闸门，不再要求 client 非空 ★
        client 为 null（设置里缺 baseUrl/username/password 任一项）时，
        对话框应弹出并显示「未配置 → 去设置」引导；
        此前写成 `... && nebulaPickerClient` 会把对话框整个挡掉，
        使组件内 `!configured` 引导分支永远走不到（点按钮毫无反应）。
    -->
    <CanvasNebulaPickerDialog
      v-if="nebulaPickerVisible"
      :client="nebulaPickerClient"
      :t="t"
      @close="closeNebulaPicker"
      @insert="onNebulaFileInserted"
      @open-settings="openNebulaSettings"
    />

    <!--
      「思源资源」选择器。
      搜索函数以 prop 注入（不在组件内 fetch），组件只管交互、不管数据来源。
    -->
    <CanvasAssetPickerDialog
      v-if="assetPickerVisible"
      :search="searchAssetOptions"
      :t="t"
      @close="closeAssetPicker"
      @insert="onAssetInserted"
    />
    <CanvasPngExportDialog
      v-model:png-export-background-mode="pngExportBackgroundMode"
      v-model:png-export-custom-color="pngExportCustomColor"
      v-model:png-export-range="pngExportRange"
      :loading="pngExportLoading"
      :t="t"
      :visible="pngExportDialogVisible"
      @close="pngExportDialogVisible = false"
      @confirm="handlePngExportConfirm"
    />

    <input
      ref="fileInputRef"
      accept=".canvas,application/json"
      class="visually-hidden"
      type="file"
      @change="handleImport"
    >
    <input
      ref="customColorInputRef"
      type="color"
      :style="customColorInputStyle"
      @change="onCustomColorChange"
    >
  </div>
</template>

<script setup lang="ts">
import type { Plugin } from "siyuan"
import { showMessage } from "siyuan"
import { sql } from "@/api"
import type { CanvasQueryNode } from "@/canvas/types"
import { createQueryNodeRuntime } from "@/canvas/query-node-runtime"

import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onBeforeUnmount,
  onMounted,
  ref,
  unref,
  watch,
} from "vue"
import type { CanvasTabBootstrap } from "@/main"
import { useCanvasEditor } from "@/canvas/use-canvas-editor"
import {
  CanvasIcon,
} from "@/components/canvas/canvas-icon"
import type { CanvasIconName } from "@/components/canvas/canvas-icon"
import {
  EDGE_DIRECTION_ICON_NAMES,
  SELECTION_LAYOUT_ICON_NAMES,
  createSelectionToolbarTooltips,
} from "@/components/canvas/canvas-selection-toolbar-icon"
import CanvasCreateEdgeDialog from "@/components/canvas/CanvasCreateEdgeDialog.vue"
import { openHelpDialog } from "@/canvas/help-dialog"
import CanvasFileCard from "@/components/canvas/CanvasFileCard.vue"
import CanvasMinimap from "@/components/canvas/CanvasMinimap.vue"
import CanvasNebulaPickerDialog from "@/components/canvas/CanvasNebulaPickerDialog.vue"
import CanvasPngExportDialog from "@/components/canvas/CanvasPngExportDialog.vue"
import type {
  CanvasPngExportBackgroundMode,
  CanvasPngExportRange,
} from "@/canvas/png-export"
import {
  markCanvasSearchTextRanges,
  renderCanvasSearchMarkedText,
  type CanvasSearchDecoration,
} from "@/canvas/search-bridge"
import CanvasAssetPickerDialog from "@/components/canvas/CanvasAssetPickerDialog.vue"
import type { CanvasAssetPickerOption } from "@/canvas/asset-picker"
import { toAssetPickerOption } from "@/canvas/asset-picker"
import { findSiyuanAssetsByQuery } from "@/canvas/siyuan-kernel-file-node-lookups"
import { getNebulaClient } from "@/canvas/nebula-client-provider"
import type { NebulaClient } from "@/resources/nebula-client"
import {
  CLEAR_SELECTION_COLOR,
  getCanvasNodeContentStyle as resolveCanvasNodeContentStyle,
  getCanvasNodeStyle as buildCanvasNodeStyle,
  getSelectionColorStyle as resolveSelectionColorStyle,
  selectionColorStyles,
} from "@/components/canvas/canvas-workspace-display"
import { useCanvasWorkspaceBehavior } from "@/components/canvas/use-canvas-workspace-behavior"
import { createCanvasI18n } from "@/i18n/canvas"
import type {
  CanvasEdge,
  CanvasNode,
  CanvasSide,
} from "@/canvas/types"
import {
  applyFilePreviewImageOverrides,
  getFilePreviewImageCandidates,
  getNextFilePreviewImageSource,
} from "@/canvas/file-preview-fallbacks"
import type { CanvasFilePickerOption } from "@/canvas/file-picker-dialog"
import { getVideoEmbedUrl } from "@/canvas/markdown-preview"
import { triggerNativeProtyleRender } from "@/canvas/protyle-native-render"
import { createCanvasNode, createCanvasEdge } from "@/canvas/document"
import {
  computeViewportVisibleBounds,
  isNodeInViewportBounds,
} from "@/canvas/viewport-culling"

const vNativeRender = {
  mounted(el: HTMLElement) {
    triggerNativeProtyleRender(el)
  },
  updated(el: HTMLElement) {
    triggerNativeProtyleRender(el)
  },
}

const props = defineProps<{
  bootstrap: CanvasTabBootstrap
  plugin: Plugin
  setTitle: (title: string) => void
}>()

const t = createCanvasI18n((props.plugin as Plugin & { i18n?: Record<string, string> }).i18n)
const editor = useCanvasEditor(props.plugin, props.bootstrap, props.setTitle)

const bindEditorToPlugin = () => {
  if (props.plugin && (props.plugin as any).activeEditor) {
    (props.plugin as any).activeEditor.value = editor
  }
}

const unbindEditorFromPlugin = () => {
  if (props.plugin && (props.plugin as any).activeEditor && (props.plugin as any).activeEditor.value === editor) {
    (props.plugin as any).activeEditor.value = null
  }
}

onMounted(bindEditorToPlugin)
onActivated(bindEditorToPlugin)
onBeforeUnmount(unbindEditorFromPlugin)
onDeactivated(unbindEditorFromPlugin)
const fileInputRef = editor.fileInputRef
const stageRef = editor.stageRef ?? ref<HTMLElement>()
const SELECTION_TOOLBAR_TOOLTIPS = createSelectionToolbarTooltips(t)
const {
  activeSelectionColor,
  canvasShellRef,
  commitTextNodeEditing,
  editingMarkdown,
  editingNodeId,
  handleImport,
  handleNodeDoubleClick,
  handleToolbarEdit,
  selectionToolbarThemeMode,
  setEdgeToolbarRef,
  setEditingTextareaRef,
  setSelectionToolbarRef,
} = useCanvasWorkspaceBehavior(editor)
const edgeLabelInputRef = ref<HTMLInputElement>()
const toolbarCollapsed = ref(false)

/**
 * ★ 外壳关键布局约束走内联样式 ★
 *
 * 为什么必须有这一层：外部样式表（含 scoped 的 `.canvas-shell[data-v-*]`）在
 * 元素插入文档与样式命中之间存在**时序窗口**。窗口内元素退化为默认
 * `display:block`，子元素 `height:100%` 失去参照 → 外壳被内容撑到数千像素
 * （实测 4414px），画布随即按这个假高度计算 fit-view 比例与缩放中心，
 * 首帧出现空白／比例乱跳。真机实测该抖动与「编辑器 和嵌入块 不稳定」直接相关。
 *
 * ★ 为什么**不**内联 grid-template-rows ★
 *   两种模式的列数不同，交给样式表（它同时定义了编辑态两行与嵌入态单行）：
 *     · 编辑（页签）：`.canvas-shell` → `auto minmax(0,1fr)`（工具条 + 舞台）
 *     · 嵌入（预览）：`.dc-embed-canvas-host > .canvas-shell` → `minmax(0,1fr)`
 *       （工具条被 `display:none` 摘掉，舞台必须独占那一行）
 *   之前把 `auto minmax(0,1fr)` 内联进来，在嵌入态会把**舞台落在 `auto` 行**
 *   → `height:100%` 对着不确定高度解析成 0，舞台 `rectH=0`，右键平移与
 *   一切舞台手势全部失效（实测 rectH=0.0 / 平移无位移）。
 *   ⇒ 内联只钉「与行列数无关」的部分：display / 尺寸 / 盒模型。
 */
const canvasShellInlineStyle = {
  display: "grid",
  width: "100%",
  minWidth: "0",
  height: "100%",
  minHeight: "0",
  boxSizing: "border-box",
} as const

/**
 * 网盘选择器。
 *
 * client 必须**在打开瞬间**解析（而不是挂载时）——用户在设置里改完网盘地址后
 * 回到画布点按钮，拿到的必须是新配置。provider 的签名机制会在设置变更时重建实例。
 */
const nebulaPickerVisible = ref(false)
const nebulaPickerClient = ref<NebulaClient | null>(null)

function openNebulaPicker() {
  const client = getNebulaClient(editor.getPluginSettings().nebula)
  nebulaPickerVisible.value = true
  nebulaPickerClient.value = client
}

function closeNebulaPicker() {
  nebulaPickerVisible.value = false
}

function openNebulaSettings() {
  closeNebulaPicker()
  const pluginWithSettings = props.plugin as Plugin & { openCanvasSettings?: () => void, openSetting?: () => void }
  if (typeof pluginWithSettings.openCanvasSettings === "function") {
    pluginWithSettings.openCanvasSettings()
    return
  }
  pluginWithSettings.openSetting?.()
}

async function onNebulaFileInserted(payload: { mount: string, path: string, name: string }) {
  closeNebulaPicker()
  // 只插文件；目录双击是「进入」而不是「插入」，选择器已保证不会把目录传出来。
  await editor.insertNebulaFileNode(payload.mount, payload.path)
  showMessage(t("messageNebulaInserted", { name: payload.name }), 2500)
}

/**
 * 「思源资源」选择器。
 *
 * 与网盘选择器的差别：资源来自思源内核本地库（`assets` 表），
 * 不需要连接测试与配置引导 —— 内核可达即可，因此没有 `configured` 分支。
 */
const assetPickerVisible = ref(false)

function openAssetPicker() {
  assetPickerVisible.value = true
}

function closeAssetPicker() {
  assetPickerVisible.value = false
}

/**
 * 供选择器调用的搜索函数。
 *
 * 链路：内核 SQL（`assets` 表）→ `findSiyuanAssetsByQuery`
 *       → `toAssetPickerOption` 映射成展示字段。
 * 空关键字也放行 —— 内核侧返回最近 60 条，让选择器一打开就有内容。
 */
async function searchAssetOptions(query: string): Promise<CanvasAssetPickerOption[]> {
  const assets = await findSiyuanAssetsByQuery(query)
  return assets.map(toAssetPickerOption)
}

async function onAssetInserted(payload: { path: string, name: string }) {
  closeAssetPicker()
  await editor.insertSiyuanAssetNode(payload.path)
  showMessage(t("messageAssetInserted", { name: payload.name }), 2500)
}

const fileCardImageOverrides = ref<Record<string, string>>({})
const fileCardPreviewImageOverrides = ref<Record<string, Record<string, string>>>({})
const fileCardImageBlobUrls = ref<Record<string, string>>({})
const textMarkdownImageBlobUrls = ref<Record<string, string>>({})
const hoveredEdgeId = ref("")
const hoveredNodeId = ref("")

function shouldRenderNodeHandles(node: CanvasNode): boolean {
  /**
   * ★★★ 只读 / 嵌入（预览）态下**永不渲染**节点把手 ★★★
   *
   * 用户反馈（原话）：「左键目前还是可以点中卡片」，
   * 追问后确认表现是「**出现四个连线点**」。
   *
   * ★ 为什么上一轮加了 selectNode 的守卫、用户仍然说「点得中」 ★
   *   因为「四个连线点」**不是选中环**，而是这里的**连接锚点**
   *   （`.canvas-node__anchor`，四边各一个），外加 8 个缩放手柄
   *   （`.canvas-node__resize-handle`）和 1 个转角手柄
   *   （`.canvas-node__resize-corner`）—— 它们由**本函数**统一控制是否渲染。
   *
   *   而这些把手各自绑着 `@pointerdown.stop.prevent="editor.startConnectionDrag(...)"`
   *   / `startResize` / `startCornerResize`：左键按上去会被**它们自己**接住
   *   （`.stop` 让事件连节点都到不了），所以：
   *     · 禁 `selectNode` 只能消掉「选中态」
   *     · 消不掉用户看到的那四个点，也消不掉「点中」的体感
   *   ⇒ 必须在**渲染层**直接不生成这些把手。
   *
   * ★ 为什么放在最前面（在 collapsed / <=20 判断之前）★
   *   下面有一条「节点 ≤ 20 时全量渲染（保留已有测试兼容）」的捷径，
   *   对大多数小画布它**无条件返回 true** —— 正是那四个点出现的原因。
   *   只读守卫必须**先于**它，否则等于没加。
   *
   * ★ 编辑器无关：只读态本来就不允许连线 / 改尺寸（那些手势内部也查
   *   `capabilities.editDocument`），把把手藏掉只是让 UI 与真实能力一致，
   *   顺带消除「看得见却点不动」的困惑。
   *
   * ★ 判据用 capabilities.renderNodeHandles（＝ `!readonly`）★
   */
  if (!editor.capabilities.renderNodeHandles) {
    return false
  }

  if (node.collapsed) {
    return false
  }
  // 节点总数较少（<= 20）时保持全量显示，保证小画布即时可见性与已有测试兼容
  if (editor.state.document.nodes.length <= 20) {
    return true
  }
  // 大规模节点场景下按需渲染：仅在选中、悬浮或连线目标候选时挂载把手
  return (
    editor.state.selectedNodeIds.includes(node.id) ||
    hoveredNodeId.value === node.id ||
    editor.isConnectionTarget(node.id, "top") ||
    editor.isConnectionTarget(node.id, "right") ||
    editor.isConnectionTarget(node.id, "bottom") ||
    editor.isConnectionTarget(node.id, "left")
  )
}

function handleNodeMouseEnter(nodeId: string) {
  hoveredNodeId.value = nodeId
}

function handleNodeMouseLeave(nodeId: string) {
  if (hoveredNodeId.value === nodeId) {
    hoveredNodeId.value = ""
  }
}

const viewportVisibleBounds = computed(() => {
  const stage = stageRef?.value
  if (!stage || stage.clientWidth <= 0 || stage.clientHeight <= 0) {
    return null
  }
  const board = unref(editor.board)
  const viewport = unref(editor.viewport)
  if (!board || !viewport) {
    return null
  }
  return computeViewportVisibleBounds(
    viewport,
    board,
    { clientWidth: stage.clientWidth, clientHeight: stage.clientHeight },
    400,
  )
})

function shouldRenderNodeContent(node: CanvasNode): boolean {
  // 1. 节点总数较少时（<= 20）保持全量渲染，兼顾小规模操作与已有单测兼容
  if (editor.state.document.nodes.length <= 20) {
    return true
  }
  // 2. 正在编辑的节点必须完整渲染
  if (editingNodeId.value === node.id) {
    return true
  }
  // 3. 当前被选中的节点必须完整渲染
  if (editor.state.selectedNodeIds.includes(node.id)) {
    return true
  }
  // 4. 当前搜索高亮命中的节点完整渲染
  if (hasCanvasSearchMatch(node.id)) {
    return true
  }
  // 5. 演示模式相关的节点完整渲染（演示模式已剥离，此处不再有额外保底条件）
  // 6. 若容器尺寸尚未初始化（如部分单测环境 clientWidth === 0），安全保底渲染
  const bounds = viewportVisibleBounds.value
  if (!bounds) {
    return true
  }
  // 7. AABB 碰撞检测视口裁剪
  return isNodeInViewportBounds(node, bounds)
}
const colorThemePopoverOpen = ref(false)
const colorThemeButtonRef = ref<HTMLElement>()
const colorThemePopoverStyle = ref<Record<string, string>>({})

/**
 * ★ 线型（实线 / 虚线）—— 第 11 轮 #17 ★
 *
 * 用户要求：「卡片样式/分组样式/连线样式 增加虚线样式」。
 *
 * 交互做成**一个切换按钮**（不放颜色那种弹层）：
 * 线型只有两个取值，多一层弹层反而增加点击成本，且不好看出当前状态。
 * 按钮高亮 = 当前是虚线。
 *
 * 选中多个节点时，只要**不是全部都是虚线**就切成虚线（"全都设成虚线"），
 * 全虚线时才切回实线 —— 与常见编辑器"三态切换"的直觉一致。
 */
const selectionLineStyleIsDashed = computed(() => {
  const ids = editor.state.selectedNodeIds
  if (!ids.length) {
    return false
  }

  return ids.every((id) => {
    const node = editor.state.document.nodes.find(n => n.id === id)
    return node?.lineStyle === "dashed"
  })
})

function toggleSelectionLineStyle() {
  editor.applySelectionLineStyle(selectionLineStyleIsDashed.value ? "solid" : "dashed")
}

function toggleEdgeLineStyle() {
  editor.applyEdgeLineStyle(editor.selectedEdge?.lineStyle === "dashed" ? "solid" : "dashed")
}

/**
 * ★ 鼠标中键**双击** = 适应内容（第 11 轮 #7）★
 *
 * 用户要求：「画布编辑器和预览窗口增加鼠标中键双击 显示所有内容」。
 * 「显示所有内容」＝把所有节点缩放到刚好铺满视口（＝既有的「适应内容」，
 * 与工具栏按钮 / F 快捷键同一条路径 `editor.zoomToFit()`）。
 *
 * ★ 三个实现要点 ★
 *   1. **挂在根容器并走捕获阶段**：卡片上有 `@pointerdown.stop`，
 *      挂冒泡阶段的 stage 处理器时"中键点在卡片上"不生效。
 *      捕获阶段在根容器就能先拿到，卡片内部也能触发。
 *   2. **自己判定"双击"**：`dblclick` 是**主键**专属事件，中键（button 1）
 *      不会派发 `dblclick`，必须按时间窗口自己算。
 *   3. **必须 preventDefault**：Chromium 下中键按下会进入"自动滚动"模式，
 *      不挡掉会一边滚动一边触发适应，观感很乱。
 *
 * 属于**导航类**能力（与缩放/平移同级），因此编辑态与预览态**都可用**，
 * 不受 `capabilities` 只读守卫限制。
 */
const MIDDLE_DOUBLE_CLICK_MS = 400
let lastMiddleButtonDownAt = 0

function handleMiddleButtonDown(event: PointerEvent) {
  if (event.button !== 1) {
    return
  }

  event.preventDefault()

  const now = Date.now()
  if (now - lastMiddleButtonDownAt <= MIDDLE_DOUBLE_CLICK_MS) {
    lastMiddleButtonDownAt = 0
    editor.zoomToFit()
    return
  }

  lastMiddleButtonDownAt = now
}

/**
 * PNG 导出（第 11 轮从 .baseline/src-v150 恢复）。
 *
 * 默认值必须与上游一致：范围 full、背景 white ——
 * 组件测试直接断言这两个默认选中项。
 */
const pngExportDialogVisible = ref(false)
const pngExportLoading = ref(false)
const pngExportRange = ref<CanvasPngExportRange>("full")
const pngExportBackgroundMode = ref<CanvasPngExportBackgroundMode>("white")
const pngExportCustomColor = ref("#ffffff")

async function handlePngExportConfirm() {
  pngExportLoading.value = true
  try {
    await editor.exportCanvasPng({
      background: {
        color: pngExportCustomColor.value,
        mode: pngExportBackgroundMode.value,
      },
      range: pngExportRange.value,
    })
  } finally {
    pngExportLoading.value = false
    pngExportDialogVisible.value = false
  }
}

const lastCustomColor = ref<string | null>(localStorage.getItem("diskcanvas-last-custom-color"))

function setLastCustomColor(color: string) {
  lastCustomColor.value = color
  localStorage.setItem("diskcanvas-last-custom-color", color)
}

// SQL 动态智能节点运行时
const {
  queryResultsMap,
  queryErrorsMap,
  queryLoadingMap,
  editingQuerySql,
  editingQueryInterval,
  editingQueryMaxResults,
  fetchQueryResult,
  startQueryEditing,
  cancelQueryEditing,
  saveQueryEditing,
  handleQueryResultDragStart,
  cleanup: cleanupQueryRuntime,
} = createQueryNodeRuntime({
  getNodes: () => editor.state.document.nodes,
  updateNodeField: editor.updateNodeField,
  editingNodeId,
  renderMarkdown: editor.getRenderedMarkdown,
  processRenderedHtml: (html) => {
    for (const source of collectWorkspaceStorageImages(html)) {
      void loadTextMarkdownImageBlobUrl(source)
    }
    return applyTextMarkdownImageBlobUrls(html)
  },
  executeSql: sql,
  showMessage,
  t: (key) => t(key as any),
})

const customColorContext = ref<'selection' | 'edge' | null>(null)
const customColorInputRef = ref<HTMLInputElement | null>(null)
const customColorInputStyle = ref<Record<string, string>>({
  position: 'fixed',
  left: '0px',
  top: '0px',
  width: '0px',
  height: '0px',
  opacity: '0',
  pointerEvents: 'none',
  zIndex: '-1000',
})

function triggerCustomColorPicker(context: 'selection' | 'edge', event?: Event) {
  customColorContext.value = context
  if (event && event.currentTarget && customColorInputRef.value) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    customColorInputStyle.value = {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1000',
    }
  }
  nextTick(() => {
    if (customColorInputRef.value) {
      customColorInputRef.value.value = lastCustomColor.value || '#3575f0'
      customColorInputRef.value.click()
    }
  })
}

function onCustomColorChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selectedColor = input.value
  if (!selectedColor) return

  setLastCustomColor(selectedColor)

  if (customColorContext.value === 'selection') {
    editor.applySelectionColor(selectedColor)
  } else if (customColorContext.value === 'edge') {
    editor.applyEdgeColor(selectedColor)
  }
  customColorContext.value = null
}

const activeEdgeColor = computed(() => {
  return editor.state.selectedEdgeId && editor.selectedEdge
    ? (editor.selectedEdge.color || CLEAR_SELECTION_COLOR)
    : CLEAR_SELECTION_COLOR
})

const settingsRevision = ref(0)
const fileCardImageBlobUrlLoads = new Set<string>()
const textMarkdownImageBlobUrlLoads = new Set<string>()

function isWorkspaceStorageImageSource(source: string): boolean {
  return /^\/data\/storage\/.+\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(source.trim())
}

async function loadTextMarkdownImageBlobUrl(source: string) {
  if (textMarkdownImageBlobUrls.value[source] || textMarkdownImageBlobUrlLoads.has(source)) {
    return
  }

  textMarkdownImageBlobUrlLoads.add(source)
  try {
    const response = await fetch("/api/file/getFile", {
      body: JSON.stringify({ path: source }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    if (!response.ok) {
      return
    }

    const blobUrl = URL.createObjectURL(await response.blob())
    textMarkdownImageBlobUrls.value = {
      ...textMarkdownImageBlobUrls.value,
      [source]: blobUrl,
    }
  } catch (error) {
    console.warn("[diskcanvas] unable to load text markdown image:", source, error)
  } finally {
    textMarkdownImageBlobUrlLoads.delete(source)
  }
}

async function loadFileCardImageBlobUrl(source: string) {
  if (fileCardImageBlobUrls.value[source] || fileCardImageBlobUrlLoads.has(source)) {
    return
  }

  fileCardImageBlobUrlLoads.add(source)
  try {
    const response = await fetch("/api/file/getFile", {
      body: JSON.stringify({ path: source }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    if (!response.ok) {
      return
    }

    const blobUrl = URL.createObjectURL(await response.blob())
    fileCardImageBlobUrls.value = {
      ...fileCardImageBlobUrls.value,
      [source]: blobUrl,
    }
  } catch (error) {
    console.warn("[diskcanvas] unable to load file card image:", source, error)
  } finally {
    fileCardImageBlobUrlLoads.delete(source)
  }
}

function collectWorkspaceStorageImages(html: string): string[] {
  const sources = new Set<string>()
  html.replace(/<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi, (_match, _quote: string, source: string) => {
    if (isWorkspaceStorageImageSource(source)) {
      sources.add(source)
    }
    return _match
  })
  return [...sources]
}

function applyTextMarkdownImageBlobUrls(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=(["']))([^"']+)(\2)/gi,
    (match, prefix: string, _quote: string, source: string, suffix: string) => {
      const blobUrl = textMarkdownImageBlobUrls.value[source]
      return blobUrl ? `${prefix}${blobUrl}${suffix}` : match
    },
  )
}

const showCanvasThumbnails = computed(() => {
  settingsRevision.value
  return editor.getPluginSettings().showCanvasThumbnails
})

const showNodeHeader = computed(() => {
  settingsRevision.value
  return editor.getPluginSettings().showNodeHeader
})

function handleCanvasSettingsChanged() {
  settingsRevision.value += 1
}

function toggleColorThemePopover() {
  if (colorThemePopoverOpen.value) {
    colorThemePopoverOpen.value = false
    return
  }
  const button = colorThemeButtonRef.value
  if (button) {
    const rect = button.getBoundingClientRect()
    colorThemePopoverStyle.value = {
      position: "fixed",
      top: `${rect.bottom + 6}px`,
      left: `${rect.left + rect.width / 2}px`,
      transform: "translateX(-50%)",
      zIndex: "10000",
    }
  }
  colorThemePopoverOpen.value = true
}

function closeColorThemePopover(event: PointerEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('[data-testid="toolbar-color-theme-popover"]')
    && !target.closest('[data-testid="top-toolbar-color-theme"]')) {
    colorThemePopoverOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener("diskcanvas-settings-changed", handleCanvasSettingsChanged)
  document.addEventListener("pointerdown", closeColorThemePopover)
})

onBeforeUnmount(() => {
  for (const blobUrl of Object.values(fileCardImageBlobUrls.value)) {
    URL.revokeObjectURL(blobUrl)
  }
  for (const blobUrl of Object.values(textMarkdownImageBlobUrls.value)) {
    URL.revokeObjectURL(blobUrl)
  }
  window.removeEventListener("diskcanvas-settings-changed", handleCanvasSettingsChanged)
  document.removeEventListener("pointerdown", closeColorThemePopover)
  cleanupQueryRuntime()
})

// 文件选择器键盘导航
const filePickerInputRef = ref<HTMLInputElement>()
const filePickerOptionsRef = ref<HTMLElement>()
const filePickerActiveIndex = ref(0)

function getFilePickerFlatResults() {
  const groups = getFilePickerGroups()
  return groups.flatMap((g) => g.items)
}

function getFilePickerFlatIndex(result: CanvasFilePickerOption): number {
  return getFilePickerFlatResults().indexOf(result)
}

function filePickerScrollActiveIntoView() {
  void nextTick(() => {
    const container = filePickerOptionsRef.value
    if (!container) return
    const active = container.querySelector<HTMLElement>(".canvas-node-picker__option--active")
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" })
    }
  })
}

function onFilePickerKeyDown(event: KeyboardEvent) {
  const total = getFilePickerFlatResults().length
  if (event.key === "Escape") {
    event.preventDefault()
    editor.closeFilePickerDialog()
    return
  }
  if (event.key === "ArrowDown") {
    event.preventDefault()
    filePickerActiveIndex.value = total > 0 ? (filePickerActiveIndex.value + 1) % total : 0
    filePickerScrollActiveIntoView()
    return
  }
  if (event.key === "ArrowUp") {
    event.preventDefault()
    filePickerActiveIndex.value = total > 0 ? (filePickerActiveIndex.value - 1 + total) % total : 0
    filePickerScrollActiveIntoView()
    return
  }
  if (event.key === "Enter") {
    event.preventDefault()
    const target = getFilePickerFlatResults()[filePickerActiveIndex.value]
    if (target) {
      editor.selectFilePickerResult(target)
    }
  }
}

watch(() => editor.filePickerDialog.visible, (visible) => {
  if (visible) {
    filePickerActiveIndex.value = 0
    void nextTick(() => filePickerInputRef.value?.focus())
  }
})

watch(() => editor.filePickerDialog.query, () => {
  filePickerActiveIndex.value = 0
})

const NODE_RESIZE_SEGMENTS: Array<{ id: string, side: CanvasSide }> = [
  { id: "top-left", side: "top" },
  { id: "top-right", side: "top" },
  { id: "right-top", side: "right" },
  { id: "right-bottom", side: "right" },
  { id: "bottom-left", side: "bottom" },
  { id: "bottom-right", side: "bottom" },
  { id: "left-top", side: "left" },
  { id: "left-bottom", side: "left" },
]

function valueFromEvent(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function handleStagePointerDown(event: PointerEvent) {
  commitTextNodeEditing()
  editor.activateCanvasSurface()
  editor.startPan(event)
}

function handleStageDoubleClick(event: MouseEvent) {
  /**
   * ★ 只读（含嵌入预览）下不要在空白处新建节点 ★
   *
   * `commitDocument` 的能力守卫确实拦住了文档变更，但 `addNodeAtPosition`
   * 在守卫之后还有一句 `state.selectNode(node.id)` —— 那会**选中一个并不存在的节点 id**
   * （幽灵选中），让选中态与渲染结果对不上。
   * 在入口处直接返回最干净。
   *
   * ★ 判据用 capabilities.createByDoubleClick（＝ `!readonly`）★
   */
  if (!editor.capabilities.createByDoubleClick) {
    return
  }

  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect) return
  const stageX = event.clientX - rect.left
  const stageY = event.clientY - rect.top
  const canvasX = (stageX - editor.viewport.x) / editor.viewport.scale + editor.board.left
  const canvasY = (stageY - editor.viewport.y) / editor.viewport.scale + editor.board.top
  editor.addNodeAtPosition('text', canvasX, canvasY)
}

function handleStagePaste(event: ClipboardEvent) {
  const file = [...(event.clipboardData?.files || [])].find((candidate) => candidate.type.startsWith("image/"))
  if (!file) {
    return
  }

  event.preventDefault()
  void editor.handleClipboardImagePaste(file)
}

function handleNodePointerDown(node: CanvasNode, event: PointerEvent) {
  editor.activateCanvasSurface()
  editor.handleNodePointerDown(node, event)
}

function handleShellCaptureDragStart(event: DragEvent) {
  const target = event.target as HTMLElement | null
  // 放行 SQL 查询结果项的内部拖拽创建卡片行为
  if (target?.closest?.(".query-result-item[draggable='true']")) {
    return
  }
  // 坚决阻止任何内部卡片或文字的原生拖拽穿透到思源全局 window
  event.preventDefault()
  event.stopPropagation()
}

function handleShellCaptureDragOver(event: DragEvent) {
  const types = event.dataTransfer?.types

  // ① 操作系统外部文件拖入 → 放行（要让宿主知道，它能显示分屏指示）
  if (types?.includes("Files")) {
    return
  }

  /**
   * ★ ② 网盘 dock 拖入 → **也必须放行**（第 17 轮修「拖入显示禁止光标、无反应」）★
   *
   * 这个处理器挂在根容器的**捕获阶段**，`stopPropagation()` 会**在事件下行时就把事件掐死**，
   * 舞台上的 `@dragover`（冒泡阶段）**根本收不到** ⇒ 没人 `preventDefault()`
   * ⇒ 浏览器判定"此处不接受拖放"，显示**禁止光标**，并且**永远不会派发 drop**。
   *
   * 实测症状与用户反馈完全一致：「拖入 鼠标显示禁止图标，拖入放后没有发生任何变化」。
   * 而且这条拦截是"自己人拦自己人" —— 网盘拖拽恰恰不是 `Files` 类型。
   *
   * 注意：放过 dragover **不等于**会重复插入。真正防重复是在 **drop** 阶段
   * `stopPropagation()`（见 use-canvas-editor 的 `nebulaDrop`）。
   */
  if (types && Array.from(types).includes("application/x-nebuladisk-embed")) {
    return
  }

  // ③ 其余（思源内部拖拽等）→ 阻挡冒泡，避免触发宿主的分屏指示
  event.stopPropagation()
}

function handleNodeDragStart(event: DragEvent) {
  // 允许 SQL 查询结果项的特定拖拽；阻止其他卡片内容的原生 HTML5 拖拽，避免冒泡干扰卡片移动与穿透至思源分屏宿主
  const target = event.target as HTMLElement | null
  if (target?.closest?.(".query-result-item[draggable='true']")) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
}

function handleNodeClick(node: CanvasNode, event: MouseEvent) {
  /**
   * ★★★ 嵌入（预览）模式下**不得**选中节点 ★★★
   *
   * 用户要求：「嵌入块只做预览」「左右会点中画布里面的块」（＝点了不该有反应）。
   *
   * 嵌入块的画布是**纯预览**：可以缩放、可以右键平移看全貌，
   * 但**不参与任何编辑语义** —— 选中态、选中环、选择工具条都不该出现。
   *
   * 之前这里没有能力守卫，于是嵌入块里点一下卡片就把它选中了，
   * 出现高亮边框（用户体感："点中画布里面的块"）。
   * 编辑页签里 `editor.capabilities.select` 为 true，行为完全不变。
   *
   * ★ 判据用 capabilities.select（＝ `!readonly`）★
   */
  if (!editor.capabilities.select) {
    return
  }

  editor.activateCanvasSurface()
  editor.selectNode(node.id, event)
}

function onLinkIframeError(nodeId: string) {
  const iframe = document.querySelector(`[data-node-id="${nodeId}"] .link-card__iframe`) as HTMLIFrameElement | null
  if (iframe) {
    iframe.style.display = "none"
    const fallback = document.createElement("div")
    fallback.className = "link-card__fallback"
    fallback.textContent = t("linkCardFallback")
    iframe.parentElement?.appendChild(fallback)
  }
}

function handleNodeWheel(event: WheelEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return
  // 卡片内可自行滚动的区域：滚到边界后事件继续上浮，交给画布平移或缩放
  const scrollable = target.closest(
    ".canvas-node__body, .markdown-preview pre, .file-card__document-preview, .canvas-node__query-content",
  ) as HTMLElement | null
  if (!scrollable) return
  const {
    clientHeight,
    clientWidth,
    scrollHeight,
    scrollLeft,
    scrollTop,
    scrollWidth,
  } = scrollable
  // 按主轴判断边界，避免纯横向滑动被整段吞掉
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
  const viewportSize = horizontal ? clientWidth : clientHeight
  const contentSize = horizontal ? scrollWidth : scrollHeight
  const offset = horizontal ? scrollLeft : scrollTop
  const delta = horizontal ? event.deltaX : event.deltaY

  if (contentSize <= viewportSize) return

  const atStart = offset <= 0 && delta < 0
  const atEnd = offset + viewportSize >= contentSize - 1 && delta > 0
  if (!atStart && !atEnd) {
    event.stopPropagation()
  }
}

function handleEdgeClick(edgeId: string) {
  /**
   * ★ 只读 / 嵌入（预览）态下点击连线**不得**选中它 ★
   *
   * 与 `handleNodeClick` 同一个道理：选中边会渲染出两个**端点句柄**
   * （`.edge-endpoint-handle`，见模板里 `editor.selectedEdgeHandlePositions`），
   * 那又是一种「点一下就冒出可拖的小圆点」——
   * 对「只做预览」的嵌入块来说同样不应该出现。
   *
   * 注：`.stage__edge--hit-area` 上绑的是 `@click.stop`，
   * 也就是点击**不会**冒泡到 stage，只读下这里必须自己挡住。
   *
   * ★ 判据用 capabilities.select（＝ `!readonly`）★
   */
  if (!editor.capabilities.select) {
    return
  }

  editor.activateCanvasSurface()
  editor.selectEdge(edgeId)
}

function setHoveredEdge(edgeId: string) {
  hoveredEdgeId.value = edgeId
}

function clearHoveredEdge(edgeId: string) {
  if (hoveredEdgeId.value === edgeId) {
    hoveredEdgeId.value = ""
  }
}

function showHelpDialog() {
  const shortcuts = [
    { key: t("helpShortcutDoubleClick"), action: t("helpActionDoubleClick") },
    { key: t("helpShortcutDoubleClickStage"), action: t("helpActionDoubleClickStage") },
    { key: t("helpShortcutEscape"), action: t("helpActionEscape") },
    { key: t("helpShortcutDelete"), action: t("helpActionDelete") },
    { key: t("helpShortcutCtrlA"), action: t("helpActionCtrlA") },
    { key: t("helpShortcutCtrlS"), action: t("helpActionCtrlS") },
    { key: t("helpShortcutUndo"), action: t("helpActionUndo") },
    { key: t("helpShortcutRedo"), action: t("helpActionRedo") },
    { key: t("helpShortcutDuplicate"), action: t("helpActionDuplicate") },
    { key: t("helpShortcutZoomIn"), action: t("helpActionZoomIn") },
    { key: t("helpShortcutZoomOut"), action: t("helpActionZoomOut") },
    { key: t("helpShortcutZoomActual"), action: t("helpActionZoomActual") },
    { key: t("helpShortcutZoomFit"), action: t("helpActionZoomFit") },
    { key: t("helpShortcutCommandPalette"), action: t("helpActionCommandPalette") },
    { key: t("helpShortcutDoubleBracket"), action: t("helpActionDoubleBracket") },
    { key: t("helpShortcutTab"), action: t("helpActionTab") },
    { key: t("helpShortcutEnter"), action: t("helpActionEnter") },
    { key: t("helpShortcutWheel"), action: t("helpActionWheel") },
    { key: t("helpShortcutDrag"), action: t("helpActionDrag") },
    { key: t("helpShortcutDragSecondary"), action: t("helpActionDragSecondary") },
    { key: t("helpShortcutDragNode"), action: t("helpActionDragNode") },
    { key: t("helpShortcutDragAnchor"), action: t("helpActionDragAnchor") },
  ]
  openHelpDialog(t("helpDialogTitle"), shortcuts)
}

function getSideLabel(side: string): string {
  switch (side) {
    case "top":
      return t("sideTop")
    case "right":
      return t("sideRight")
    case "bottom":
      return t("sideBottom")
    case "left":
      return t("sideLeft")
    default:
      return side
  }
}

function getSelectionColorStyle(color: string) {
  return resolveSelectionColorStyle(color, editor.currentColorStyles)
}

function resolveEdgeStartMarker(enabled?: boolean) {
    return enabled ? edgeMarkerRefs.start : undefined
}

/**
 * ★ 边箭头 marker 的 id 必须**按画布实例唯一**（第 13 轮修 #8）★
 *
 * 症状：用户反馈「连续修改箭头后不立即显示」。
 *
 * 根因：SVG 的 `url(#id)` 是**文档级**解析，而原来的 id 是硬编码的
 * `canvas-edge-arrow[-end|-start]`。本插件允许**同时挂载多个画布实例**
 * （一个编辑页签 + 笔记正文里的若干嵌入预览块），于是第二个及之后的实例
 * 里的 `url(#canvas-edge-arrow-end)` 会解析到**文档里第一个** marker ——
 * 箭头用的是别的实例的定义，重渲染时机也就跟着错乱（表现为"改了不立刻显示"）。
 *
 * 修法：每个实例生成一个随机后缀，id 与引用都带上它，互不干扰。
 */
const edgeMarkerSuffix = Math.random().toString(36).slice(2, 9)
const edgeMarkerIds = {
  base: `dc-edge-arrow-${edgeMarkerSuffix}`,
  end: `dc-edge-arrow-end-${edgeMarkerSuffix}`,
  start: `dc-edge-arrow-start-${edgeMarkerSuffix}`,
}
const edgeMarkerRefs = {
  base: `url(#${edgeMarkerIds.base})`,
  end: `url(#${edgeMarkerIds.end})`,
  start: `url(#${edgeMarkerIds.start})`,
}

function resolveEdgeEndMarker(enabled?: boolean) {
    return enabled ? edgeMarkerRefs.end : undefined
}

/**
 * 把 `edge.color` 解析成实际可用的 CSS 颜色。
 *
 * ★ 为什么需要这个函数（第 11 轮修 #9）★
 *   `colorStyles` 是**按主题色键**（"1".."6"）索引的表：
 *     `buildColorStyles(theme)` 里 `for (const [key, hex] of Object.entries(theme.colors))`
 *   ⇒ 调色板里的颜色存的是**键**（如 "3"），查表能命中；
 *     **自定义颜色**存的是**原始十六进制**（如 "#3575f0"），`styles["#3575f0"]` 必然 miss，
 *     于是 `getEdgeStrokeStyle` 返回 undefined ⇒ 连线维持原色。
 *     用户现象：「连线的颜色不会变成…后面那个自定义颜色」。
 *
 * 兜底规则：查不到键就把它当作**原始 CSS 颜色**直接使用（做个宽松校验，
 * 避免把脏字符串塞进 style）。
 */
const RAW_CSS_COLOR_PATTERN = /^(?:#[\da-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)$/i

function resolveEdgeColorValue(edge: CanvasEdge): string | undefined {
  const key = edge.color
  if (!key) {
    return undefined
  }

  const styles = editor.currentColorStyles ?? selectionColorStyles
  const themed = styles[key]
  if (themed) {
    return themed.border
  }

  const raw = key.trim()
  return RAW_CSS_COLOR_PATTERN.test(raw) ? raw : undefined
}

function getEdgeStrokeStyle(edge: CanvasEdge) {
  const color = resolveEdgeColorValue(edge)
  const dashed = edge.lineStyle === "dashed"

  if (!color && !dashed) {
    return undefined
  }

  return {
    ...(color ? { color, stroke: color } : {}),
    // 虚线（#17）：SVG 用 stroke-dasharray 表达
    // ★ 稀疏一些（第 18 轮）：原来 6/5 太密，肉眼分不清是虚线还是粗线
    ...(dashed ? { strokeDasharray: "12 9" } : {}),
  }
}

function getEdgeLabelStyle(edge: CanvasEdge) {
  const color = resolveEdgeColorValue(edge)
  return color ? { fill: color } : undefined
}

function getCanvasNodeStyle(node: CanvasNode) {
  return buildCanvasNodeStyle(node, editor.getNodeStyle(node), {
    // 演示模式（presentation）已随上游业务剥离，遮罩恒不激活
    presentationMaskActive: false,
    selected: editor.state.selectedNodeIds.includes(node.id),
    themeMode: selectionToolbarThemeMode.value,
  }, editor.currentColorStyles)
}

function getCanvasNodeContentStyle(node: CanvasNode) {
  return resolveCanvasNodeContentStyle(node, editor.currentColorStyles)
}

function hasCanvasSearchMatch(nodeId: string) {
  return (editor.searchDecorations ?? []).some(decoration => decoration.targetId.startsWith(`node:${nodeId}:`))
}

function hasCanvasCurrentSearchMatch(nodeId: string) {
  return (editor.searchDecorations ?? []).some(decoration =>
    decoration.current && decoration.targetId.startsWith(`node:${nodeId}:`),
  )
}

/**
 * 取出某个搜索目标（如 `node:<id>:text`）上的全部命中片段。
 *
 * ★ 第 11 轮恢复搜索高亮时补回 ★
 */
function getCanvasTargetDecorations(targetId: string): CanvasSearchDecoration[] {
  return (editor.searchDecorations ?? []).filter(decoration => decoration.targetId === targetId)
}

/**
 * 分组标题：把搜索命中的片段包成 `<mark class="canvas-search-mark">`。
 *
 * 剥离时这里被简化成"直接返回纯文本"，于是 Ctrl+F 能搜到但**看不见高亮**。
 */
function renderCanvasGroupLabel(node: CanvasNode) {
  const label = node.type === "group"
    ? node.label || t("nodeDefaultGroupLabel")
    : ""
  return renderCanvasSearchMarkedText(label, getCanvasTargetDecorations(`node:${node.id}:label`))
}

/**
 * 文本节点内容：先在 markdown 源码上把命中区间用 `<mark>` 标出，再交给 markdown 渲染。
 *
 * 必须在**渲染成 HTML 之前**标记（`markCanvasSearchTextRanges`），
 * 否则 markdown 渲染会把标记吃掉。
 * `markdown-sanitize.ts` 里已为 `canvas-search-mark` 开了白名单。
 */
function renderCanvasTextNodeContent(node: CanvasNode) {
  if (node.type !== "text") {
    return ""
  }

  const decorations = getCanvasTargetDecorations(`node:${node.id}:text`)
  const markdown = decorations.length
    ? markCanvasSearchTextRanges(node.text, decorations)
    : node.text
  const html = editor.getRenderedMarkdown(markdown)
  if (!html.includes("/data/storage/")) {
    return html
  }
  for (const source of collectWorkspaceStorageImages(html)) {
    void loadTextMarkdownImageBlobUrl(source)
  }
  return applyTextMarkdownImageBlobUrls(html)
}

function getLinkNodeUrl(node: CanvasNode): string {
  if (node.type !== "link" || !node.url) {
    return ""
  }
  const videoInfo = getVideoEmbedUrl(node.url)
  return videoInfo ? videoInfo.embedUrl : node.url
}

function getLinkIframeKey(node: CanvasNode): string {
  if (node.type !== "link" || !node.url) {
    return node.id
  }
  const videoInfo = getVideoEmbedUrl(node.url)
  if (videoInfo?.type === "bilibili") {
    return `${node.id}:${node.width}x${node.height}:${videoInfo.embedUrl}`
  }
  return `${node.id}:${videoInfo?.embedUrl ?? node.url}`
}

function isBilibiliLinkNode(node: CanvasNode): boolean {
  return node.type === "link" && !!node.url && getVideoEmbedUrl(node.url)?.type === "bilibili"
}

function getLinkIframeStyle(node: CanvasNode): Record<string, string> | undefined {
  if (!isBilibiliLinkNode(node)) {
    return undefined
  }

  const headerHeight = showNodeHeader.value ? 35 : 0
  const viewportWidth = Math.max(1, node.width)
  const viewportHeight = Math.max(1, node.height - headerHeight)
  const playerHeight = Math.max(1, viewportWidth * 9 / 16)
  const scaleY = viewportHeight / playerHeight

  return {
    height: `${playerHeight}px`,
    left: '0',
    top: '0',
    transform: `scaleY(${scaleY})`,
    transformOrigin: 'left top',
    width: `${viewportWidth}px`,
  }
}

/**
 * 节点 header 上显示的类型图标。文本/文件/链接三类节点 header 的图标视觉锚点
 * 来自 canvas-icon 字典，与底部 toolbar 添加按钮保持一致。
 */
function getNodeHeaderIconName(node: CanvasNode): CanvasIconName {
  if (node.type === "text") return "text"
  if (node.type === "file") return "canvas-file"
  if (node.type === "link") return "open"
  return "text"
}

/**
 * 节点 header 上显示的标题。优先使用节点已有元数据，最后退化到节点类型默认文案。
 *
 * ★ 文本节点：标题不得与正文首行重复 ★
 *   用户反馈：「目前文本框上面的标题和内容一致，标题需要处理」。
 *
 *   旧实现取「正文里第一行非空文本」当标题，而正文区（`.canvas-node__content`）
 *   渲染的是**完整 markdown**，第一行当然也在里面 ⇒
 *   一张只有一行的文本卡片，header 和 body 显示的是同一句话，纯重复。
 *
 *   新规则（只在文本节点生效）：
 *     · 首行之外**还有**其它非空内容 ⇒ 首行当标题是有信息量的（它相当于小标题，
 *       帮你在卡片塌陷/滚动时知道里面是什么）⇒ 保留。
 *     · 整段就只有这一行 ⇒ 标题没有任何额外信息，退化成类型名「卡片」。
 *
 *   这样既消掉了重复，又没有把「多行卡片」的可用标题一起干掉。
 */
/**
 * 抬头右侧的**类型徽标**（第 20 轮，用户要求「卡片中的徽标显示在抬头中」）。
 *
 * 数据来源与原来的卡片正文徽标完全一致（`preview.badge`），
 * 只是搬到了抬头 —— 既省一行高度，也让「类型」和「抬头」在同一视觉行上。
 * 非文件节点没有徽标，返回空串（模板用 v-if 挡掉，不会渲染空壳）。
 */
function getNodeHeaderBadge(node: CanvasNode): string {
  if (node.type !== "file") {
    return ""
  }
  try {
    return editor.getFileNodePreview?.(node)?.badge || ""
  } catch {
    // 解析尚未完成时 getFileNodePreview 可能抛，抬头不该因为徽标而挂掉
    return ""
  }
}

function getNodeHeaderTitle(node: CanvasNode): string {
  if (node.type === "text") {
    const lines = (node.text || "").split("\n")
    const firstIndex = lines.findIndex((line) => line.trim().length > 0)
    const firstLine = firstIndex === -1 ? "" : lines[firstIndex]
    const title = firstLine.trim().replace(/^#{1,6}\s+/, "").trim()

    // 首行之后是否还有实质内容（跳过空行）
    const hasMoreContent = firstIndex !== -1
      && lines.slice(firstIndex + 1).some((line) => line.trim().length > 0)

    if (!hasMoreContent) {
      return t("nodeKindText")
    }

    return title.slice(0, 60) || t("nodeKindText")
  }
  if (node.type === "file") {
    /**
     * ★ 卡片抬头显示「类型名」而不是文件名（第 18 轮，用户要求）★
     *
     * 用户原话：
     *   2、网盘文件目前显示的是文件名，改为「网盘文件」
     *   3、思源资源显示的也是文件名，改为「内部文件」
     *   4、如果是关联的思源笔记显示 NotePage，如果是思源块显示 Block
     *
     * 为什么按**解析结果**而不是文件名判断：文件名（`node.file`）对
     * 网盘 / 思源资源 / 笔记 / 块来说都只是一个路径串，看不出"它是什么"；
     * 而 `getResolvedFileNode` 给出的 `kind` 才是类型的事实来源。
     *
     * 兜底：解析尚未完成（异步）时退回原来的文件名，避免抬头空白。
     * `canvas`（嵌套画布）保持原样 —— 它的标题本身就是有意义的画布名。
     */
    const resolvedKind = editor.getFileNodeKind?.(node)
    if (resolvedKind === "nebula") {
      return t("nodeKindNebulaFile")
    }
    if (resolvedKind === "asset" || resolvedKind === "image") {
      return t("nodeKindAssetFile")
    }
    if (resolvedKind === "document") {
      return t("nodeKindNotePage")
    }
    if (resolvedKind === "block") {
      return t("nodeKindBlock")
    }

    return editor.getNodeTitle?.(node)
      || (node.file ? node.file.split("/").pop() || node.file : t("toolbarFile"))
  }
  if (node.type === "link") {
    if (!node.url) return t("nodeKindExternalLink")
    try {
      return new URL(node.url).hostname || node.url
    } catch {
      return node.url
    }
  }
  return ""
}

function getFileCardImageSource(node: CanvasNode): string | undefined {
  if (node.type !== "file") {
    return undefined
  }

  const preview = editor.getFileNodePreview(node)
  if (preview.kind !== "image" || !preview.imageSrc) {
    return undefined
  }

  if (isWorkspaceStorageImageSource(preview.imageSrc)) {
    const blobUrl = fileCardImageBlobUrls.value[preview.imageSrc]
    if (blobUrl) {
      return blobUrl
    }
    void loadFileCardImageBlobUrl(preview.imageSrc)
  }

  const candidates = getFilePreviewImageCandidates(preview.imageSrc)
  const override = fileCardImageOverrides.value[node.id]
  return override && candidates.includes(override) ? override : candidates[0]
}

function shouldShowFileCardHeadline(node: CanvasNode) {
  if (node.type !== "file") {
    return false
  }

  return !["block", "image"].includes(editor.getFileNodePreview(node).kind)
}

function shouldShowFileCardDetail(node: CanvasNode) {
  if (node.type !== "file") {
    return false
  }

  const kind = editor.getFileNodePreview(node).kind
  return !["block", "document", "image"].includes(kind)
}

function shouldShowFileCardHelper(node: CanvasNode) {
  if (node.type !== "file") {
    return false
  }

  const preview = editor.getFileNodePreview(node)
  // 网盘文件（nebula）曾经落到 file 兜底分支，卡片上会多出一行英文
  // 「Double click to open」。用户要求去掉 ⇒ 这里连同 helper 一起不显示。
  if (!preview.helper) {
    return false
  }

  return !["block", "document", "image"].includes(preview.kind)
}

function getFileCardTooltip(node: CanvasNode): string | undefined {
  if (node.type !== "file") {
    return undefined
  }

  return editor.getFileNodePreview(node).detail || undefined
}

function getFileCardDocumentPreviewHtml(node: CanvasNode): string {
  if (node.type !== "file") {
    return ""
  }

  const preview = editor.getFileNodePreview(node)
  const previewHtml = preview.previewHtml || ""
  const overrides = fileCardPreviewImageOverrides.value[node.id]
  return applyFilePreviewImageOverrides(previewHtml, overrides)
}

function handleFileCardImageError(node: CanvasNode) {
  if (node.type !== "file") {
    return
  }

  const preview = editor.getFileNodePreview(node)
  if (!preview.imageSrc) {
    return
  }

  const currentSource = getFileCardImageSource(node)
  const nextSource = getNextFilePreviewImageSource(preview.imageSrc, currentSource)

  if (!nextSource) {
    return
  }

  fileCardImageOverrides.value = {
    ...fileCardImageOverrides.value,
    [node.id]: nextSource,
  }
}

function handleFileCardPreviewImageError(node: CanvasNode, event: Event) {
  if (node.type !== "file") {
    return
  }

  const target = event.target
  if (!(target instanceof HTMLImageElement)) {
    return
  }

  const currentSource = target.getAttribute("src")?.trim()
  if (!currentSource) {
    return
  }

  const storedCandidates = target.dataset.canvasImageCandidates
  const candidates = storedCandidates
    ? JSON.parse(storedCandidates) as string[]
    : getFilePreviewImageCandidates(currentSource)
  const currentIndex = Number.parseInt(target.dataset.canvasImageCandidateIndex || "", 10)
  const resolvedIndex = Number.isNaN(currentIndex)
    ? candidates.indexOf(currentSource)
    : currentIndex
  const nextSource = candidates[resolvedIndex + 1]

  if (!nextSource || nextSource === currentSource) {
    return
  }

  target.dataset.canvasImageCandidates = JSON.stringify(candidates)
  target.dataset.canvasImageCandidateIndex = String(resolvedIndex + 1)
  target.setAttribute("src", nextSource)

  fileCardPreviewImageOverrides.value = {
    ...fileCardPreviewImageOverrides.value,
    [node.id]: {
      ...(fileCardPreviewImageOverrides.value[node.id] || {}),
      [candidates[0] || currentSource]: nextSource,
    },
  }
}

function getFilePickerResults() {
  return [
    ...editor.filePickerDialog.groups.blocks,
    ...editor.filePickerDialog.groups.documents,
    ...editor.filePickerDialog.groups.canvases,
    ...editor.filePickerDialog.groups.images,
  ]
}

type FilePickerKind = "block" | "canvas" | "document" | "image" | "query"

function getFilePickerGroups() {
  const g = editor.filePickerDialog.groups
  const candidates: Array<{ kind: FilePickerKind, items: any[] }> = []

  const queryText = editor.filePickerDialog.query.trim()
  if (/^\s*select\s/i.test(queryText)) {
    candidates.push({
      kind: "query" as FilePickerKind,
      items: [{
        kind: "query" as const,
        path: "new-query-node",
        title: t("createQueryNodeWithSql"),
        subtitle: queryText,
      }]
    })
  }

  candidates.push(
    { kind: "document" as FilePickerKind, items: g.documents },
    { kind: "canvas" as FilePickerKind, items: g.canvases },
    { kind: "block" as FilePickerKind, items: g.blocks },
    { kind: "image" as FilePickerKind, items: g.images }
  )
  return candidates.filter((group) => group.items.length > 0)
}

function getFilePickerGroupLabel(kind: FilePickerKind): string {
  if (kind === "query") return t("filePickerGroupQueries" as any)
  return t(`filePickerGroup${kind.charAt(0).toUpperCase()}${kind.slice(1)}s` as any)
}

function getFilePickerKindLabel(kind: FilePickerKind): string {
  switch (kind) {
    case "block":
      return "Block"
    case "canvas":
      return "Canvas"
    case "document":
      return "Document"
    case "image":
      return "Image"
    case "query":
      return "SQL"
    default:
      return kind
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function highlightText(text: string, query: string): string {
  if (!query) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escapedQuery})`, "gi")
  return escaped.replace(regex, "<mark>$1</mark>")
}

function getCanvasThumbnailViewBox(thumbnail?: {
  edges: Array<{ fromX: number, fromY: number, toX: number, toY: number }>
  nodes: Array<{ height: number, width: number, x: number, y: number }>
}) {
  if (!thumbnail || thumbnail.nodes.length === 0) {
    return "0 0 100 64"
  }

  const nodeMinX = Math.min(...thumbnail.nodes.map((node) => node.x))
  const nodeMinY = Math.min(...thumbnail.nodes.map((node) => node.y))
  const nodeMaxX = Math.max(...thumbnail.nodes.map((node) => node.x + node.width))
  const nodeMaxY = Math.max(...thumbnail.nodes.map((node) => node.y + node.height))
  const edgePoints = thumbnail.edges.flatMap((edge) => [
    { x: edge.fromX, y: edge.fromY },
    { x: edge.toX, y: edge.toY },
  ])
  const edgeMinX = edgePoints.length > 0 ? Math.min(...edgePoints.map((point) => point.x)) : nodeMinX
  const edgeMinY = edgePoints.length > 0 ? Math.min(...edgePoints.map((point) => point.y)) : nodeMinY
  const edgeMaxX = edgePoints.length > 0 ? Math.max(...edgePoints.map((point) => point.x)) : nodeMaxX
  const edgeMaxY = edgePoints.length > 0 ? Math.max(...edgePoints.map((point) => point.y)) : nodeMaxY
  const minX = Math.min(nodeMinX, edgeMinX)
  const minY = Math.min(nodeMinY, edgeMinY)
  const maxX = Math.max(nodeMaxX, edgeMaxX)
  const maxY = Math.max(nodeMaxY, edgeMaxY)
  const padding = 24

  return `${minX - padding} ${minY - padding} ${Math.max(maxX - minX + padding * 2, 1)} ${Math.max(maxY - minY + padding * 2, 1)}`
}

function handleEdgeLabelEditorKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault()
    editor.submitEdgeLabelEditing()
    return
  }

  if (event.key === "Escape") {
    event.preventDefault()
    editor.cancelEdgeLabelEditing()
  }
}

watch(
  () => editor.editingEdgeLabelId,
  async () => {
    if (!editor.editingEdgeLabelId) {
      return
    }

    await nextTick()
    edgeLabelInputRef.value?.focus()
    edgeLabelInputRef.value?.select()
  },
)
</script>

<style scoped lang="scss" src="./canvas-workspace.scss"></style>


<style lang="scss">
.canvas-relayout-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: color-mix(in srgb, var(--b3-theme-background, #fff) 60%, transparent);
  pointer-events: all;
  cursor: wait;
}

.canvas-relayout-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid color-mix(in srgb, var(--b3-theme-primary, #5b8ff9) 25%, transparent);
  border-top-color: var(--b3-theme-primary, #5b8ff9);
  border-radius: 50%;
  animation: canvas-relayout-spin 0.8s linear infinite;
}

.canvas-relayout-text {
  font-size: 13px;
  color: var(--b3-theme-on-surface, #333);
}

@keyframes canvas-relayout-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

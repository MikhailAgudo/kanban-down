import classcat from 'classcat';
import Mark from 'mark.js';
import moment from 'moment';
import { Component, MarkdownRenderer as ObsidianRenderer, getLinkpath } from 'obsidian';
import { CSSProperties, memo, useEffect, useRef } from 'preact/compat';
import { useContext } from 'preact/hooks';
import { KanbanView } from 'src/KanbanView';
import { DndManagerContext, EntityManagerContext } from 'src/dnd/components/context';
import { PromiseCapability } from 'src/helpers/util';

import { applyCheckboxIndexes } from '../../helpers/renderMarkdown';
import { IntersectionObserverContext, KanbanContext, SortContext } from '../context';
import { c, useGetDateColorFn, useGetTagColorFn } from '../helpers';
import { DateColor, TagColor } from '../types';

interface MarkdownRendererProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  markdownString: string;
  sourceLineOffset?: number;
  sourceLineEnd?: number;
  searchQuery?: string;
  entityId?: string;
}

function colorizeTags(wrapperEl: HTMLElement, getTagColor: (tag: string) => TagColor) {
  if (!wrapperEl) return;
  const tagEls = wrapperEl.querySelectorAll<HTMLAnchorElement>('a.tag');
  if (!tagEls?.length) return;

  tagEls.forEach((a) => {
    const color = getTagColor(a.getAttr('href'));
    if (!color) return;
    a.setCssProps({
      '--tag-color': color.color,
      '--tag-background': color.backgroundColor,
    });
  });
}

function colorizeDates(wrapperEl: HTMLElement, getDateColor: (date: moment.Moment) => DateColor) {
  if (!wrapperEl) return;
  const dateEls = wrapperEl.querySelectorAll<HTMLElement>('.' + c('date'));
  if (!dateEls?.length) return;
  dateEls.forEach((el) => {
    const dateStr = el.dataset.date;
    if (!dateStr) return;
    const parsed = moment(dateStr);
    if (!parsed.isValid()) return;
    const color = getDateColor(parsed);
    el.toggleClass('has-background', !!color?.backgroundColor);
    if (!color) return;
    el.setCssProps({
      '--date-color': color.color,
      '--date-background-color': color.backgroundColor,
    });
  });
}

export class BasicMarkdownRenderer extends Component {
  containerEl: HTMLElement;
  wrapperEl: HTMLElement;
  renderCapability: PromiseCapability;
  observer: ResizeObserver | null = null;
  isVisible: boolean = false;
  renderPending: boolean = false;
  onRender?: (containerEl: HTMLElement) => void;
  mark: Mark;

  private renderPromise: Promise<void> | null = null;
  private renderTask: Promise<void> | null = null;

  lastWidth = -1;
  lastHeight = -1;
  lastRefWidth = -1;
  lastRefHeight = -1;

  constructor(
    public view: KanbanView,
    public markdown: string,
    public sourceLineOffset: number = 0,
    public sourceLineEnd: number = sourceLineOffset
  ) {
    super();
    this.containerEl = createDiv(
      'markdown-preview-view markdown-rendered ' + c('markdown-preview-view')
    );
    this.containerEl.dataset.kanbanSourceLineStart = String(sourceLineOffset);
    this.containerEl.dataset.kanbanSourceLineEnd = String(sourceLineEnd);
    this.mark = new Mark(this.containerEl);
    this.renderCapability = new PromiseCapability<void>();
  }

  onload() {
    this.containerEl.addEventListener('click', this.onTaskListCheckboxClick, { capture: true });
    this.containerEl.addEventListener('contextmenu', this.onTaskListCheckboxContextMenu, {
      capture: true,
    });

    const renderPromise = this.render();
    this.renderPromise = renderPromise;
    void renderPromise.then(
      () => this.onRenderComplete(renderPromise),
      () => this.onRenderComplete(renderPromise)
    );
  }

  onunload() {
    this.observer?.disconnect();
    this.observer = null;
    this.containerEl.removeEventListener('click', this.onTaskListCheckboxClick, true);
    this.containerEl.removeEventListener('contextmenu', this.onTaskListCheckboxContextMenu, true);
    super.onunload();
  }

  private onTaskListCheckboxClick = (evt: MouseEvent) => {
    const { targetNode } = evt;
    if (
      targetNode.instanceOf(HTMLElement) &&
      targetNode.hasClass('task-list-item-checkbox') &&
      !targetNode.closest('.markdown-embed')
    ) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  private onTaskListCheckboxContextMenu = (evt: MouseEvent) => {
    const { targetNode } = evt;
    if (targetNode.instanceOf(HTMLElement) && targetNode.hasClass('task-list-item-checkbox')) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  private onRenderComplete(promise: Promise<void>) {
    if (this.renderPromise === promise) {
      this.renderPromise = null;
    }
  }

  private attachContainer() {
    const { wrapperEl, containerEl } = this;
    if (!wrapperEl || !this.isVisible || this.renderPending) return;

    wrapperEl.append(containerEl);
    if (wrapperEl.style.minHeight) wrapperEl.style.minHeight = '';
  }

  private renderPendingChanges(): Promise<void> {
    if (this.renderTask) return this.renderTask;

    const renderTask = (async () => {
      while (this.renderPending && this.isVisible) {
        if (this.renderPromise) {
          await this.renderPromise;
          continue;
        }

        this.renderCapability = new PromiseCapability<void>();
        const renderCapability = this.renderCapability;
        this.unload();
        this.load();
        await (this.renderPromise || renderCapability.promise);
      }

      this.attachContainer();
    })();

    this.renderTask = renderTask;
    void renderTask.then(
      () => {
        if (this.renderTask === renderTask) this.renderTask = null;
      },
      () => {
        if (this.renderTask === renderTask) this.renderTask = null;
      }
    );
    return renderTask;
  }

  async render() {
    const markdown = this.markdown;
    const sourceLineOffset = this.sourceLineOffset;
    const sourceLineEnd = this.sourceLineEnd;
    const renderCapability = this.renderCapability;

    this.containerEl.empty();

    await ObsidianRenderer.render(
      this.view.app,
      markdown,
      this.containerEl,
      this.view.file.path,
      this
    );

    this.renderPending =
      markdown !== this.markdown ||
      sourceLineOffset !== this.sourceLineOffset ||
      sourceLineEnd !== this.sourceLineEnd;
    renderCapability.resolve();
    if (!(this.view as any)?._loaded || !(this as any)._loaded) return;

    const { containerEl } = this;

    this.resolveLinks();
    applyCheckboxIndexes(containerEl);

    const observer = (this.observer = new ResizeObserver((entries) => {
      if (!entries.length) return;

      const entry = entries.first().contentBoxSize[0];
      if (entry.blockSize === 0) return;

      if (this.wrapperEl) {
        const rect = this.wrapperEl.getBoundingClientRect();
        if (this.lastRefHeight === -1 || rect.height > 0) {
          this.lastRefHeight = rect.height;
          this.lastRefWidth = rect.width;
        }
      }

      this.lastWidth = entry.inlineSize;
      this.lastHeight = entry.blockSize;
    }));

    containerEl.win.setTimeout(() => {
      if (this.observer === observer && (this as any)._loaded) {
        observer.observe(containerEl, { box: 'border-box' });
      }
    });

    this.onRender?.(containerEl);
  }

  migrate(el: HTMLElement, isVisible: boolean = this.isVisible) {
    const { lastRefHeight, lastRefWidth, containerEl } = this;
    this.wrapperEl = el;
    this.isVisible = isVisible;
    if (lastRefHeight > 0) {
      el.style.width = `${lastRefWidth}px`;
      el.style.height = `${lastRefHeight}px`;
      if (this.renderPending) el.style.minHeight = `${lastRefHeight}px`;
      el.win.setTimeout(() => {
        el.style.width = '';
        el.style.height = '';
      }, 50);
    }

    if (this.renderPending) {
      containerEl.detach();
      if (this.isVisible) void this.renderPendingChanges();
    } else if (containerEl.parentElement !== el) {
      el.append(containerEl);
    }

    this.mark.unmark();
  }

  show() {
    if (!this.wrapperEl) return;
    this.isVisible = true;

    if (this.renderPending) {
      void this.renderPendingChanges();
    } else {
      this.attachContainer();
    }
  }

  hide() {
    const { containerEl, wrapperEl } = this;
    if (!wrapperEl) return;
    wrapperEl.style.minHeight = this.lastRefHeight + 'px';
    containerEl.detach();
    this.isVisible = false;
  }

  set(
    markdown: string,
    sourceLineOffset: number = this.sourceLineOffset,
    sourceLineEnd: number = this.sourceLineEnd
  ) {
    if (
      (this as any)._loaded &&
      (markdown !== this.markdown ||
        sourceLineOffset !== this.sourceLineOffset ||
        sourceLineEnd !== this.sourceLineEnd)
    ) {
      this.markdown = markdown;
      this.sourceLineOffset = sourceLineOffset;
      this.sourceLineEnd = sourceLineEnd;
      this.containerEl.dataset.kanbanSourceLineStart = String(sourceLineOffset);
      this.containerEl.dataset.kanbanSourceLineEnd = String(sourceLineEnd);
      this.renderPending = true;
      if (this.isVisible) void this.renderPendingChanges();
    }
  }

  resolveLinks() {
    const { containerEl, view } = this;
    const internalLinkEls = containerEl.findAll('a.internal-link');
    for (const internalLinkEl of internalLinkEls) {
      const href = this.getInternalLinkHref(internalLinkEl);
      if (!href) continue;

      const path = getLinkpath(href);
      const file = view.app.metadataCache.getFirstLinkpathDest(path, view.file.path);
      internalLinkEl.toggleClass('is-unresolved', !file);
    }
  }

  getInternalLinkHref(el: HTMLElement) {
    const href = el.getAttr('data-href') || el.getAttr('href');
    if (!href) return null;
    return href;
  }
}

export const MarkdownRenderer = memo(function MarkdownPreviewRenderer({
  entityId,
  className,
  markdownString,
  sourceLineOffset = 0,
  sourceLineEnd = sourceLineOffset,
  searchQuery,
  ...divProps
}: MarkdownRendererProps) {
  const { view, stateManager } = useContext(KanbanContext);
  const entityManager = useContext(EntityManagerContext);
  const dndManager = useContext(DndManagerContext);
  const sortContext = useContext(SortContext);
  const intersectionContext = useContext(IntersectionObserverContext);
  const getTagColor = useGetTagColorFn(stateManager);
  const getDateColor = useGetDateColorFn(stateManager);

  const renderer = useRef<BasicMarkdownRenderer>();
  const elRef = useRef<HTMLDivElement>();
  const onRenderRef = useRef<(containerEl: HTMLElement) => void>(() => {});
  onRenderRef.current = (containerEl) => {
    colorizeTags(containerEl, getTagColor);
    colorizeDates(containerEl, getDateColor);
  };

  // Reset virtualization if this entity is a managed entity and has changed sort order
  useEffect(() => {
    if (!entityManager || !entityId || !renderer.current) return;

    const observer = entityManager?.scrollParent?.observer;
    if (!observer) return;

    observer.unobserve(entityManager.measureNode);
    observer.observe(entityManager.measureNode);
  }, [sortContext]);

  // If we have an intersection context (eg, in table view) then use that for virtualization
  useEffect(() => {
    if (!intersectionContext || !elRef.current) return;

    intersectionContext.registerHandler(elRef.current, (entry) => {
      if (entry.isIntersecting) renderer.current?.show();
      else renderer.current?.hide();
    });

    return () => {
      if (elRef.current) {
        intersectionContext?.unregisterHandler(elRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onVisibilityChange = (isVisible: boolean) => {
      const preview = renderer.current;
      if (!preview || !entityManager?.parent) return;

      const { dragManager } = dndManager;
      if (dragManager.dragEntityId === entityManager.entityId) return;
      if (dragManager.dragEntityId === entityManager.parent.entityId) return;

      if (preview.isVisible && !isVisible) {
        preview.hide();
      } else if (!preview.isVisible && isVisible) {
        preview.show();
      }
    };

    if (entityId && view.previewCache.has(entityId)) {
      const preview = view.previewCache.get(entityId);

      renderer.current = preview;
      preview.onRender = (containerEl) => onRenderRef.current(containerEl);
      preview.migrate(elRef.current, entityManager?.isVisible ?? true);

      entityManager?.emitter.on('visibility-change', onVisibilityChange);
      return () => entityManager?.emitter.off('visibility-change', onVisibilityChange);
    }

    const markdownRenderer = new BasicMarkdownRenderer(
      view,
      markdownString,
      sourceLineOffset,
      sourceLineEnd
    );
    markdownRenderer.wrapperEl = elRef.current;
    markdownRenderer.onRender = (containerEl) => onRenderRef.current(containerEl);

    const preview = (renderer.current = view.addChild(markdownRenderer));
    if (entityId) view.previewCache.set(entityId, preview);

    elRef.current.empty();
    elRef.current.append(preview.containerEl);

    entityManager?.emitter.on('visibility-change', onVisibilityChange);

    return () => {
      renderer.current?.renderCapability.resolve();
      entityManager?.emitter.off('visibility-change', onVisibilityChange);
    };
  }, [view, entityId, entityManager]);

  // Respond to changes to the markdown string
  useEffect(() => {
    const preview = renderer.current;
    if (
      !preview ||
      (markdownString === preview.markdown &&
        sourceLineOffset === preview.sourceLineOffset &&
        sourceLineEnd === preview.sourceLineEnd)
    )
      return;

    preview.renderCapability.resolve();

    preview.set(markdownString, sourceLineOffset, sourceLineEnd);
  }, [markdownString, sourceLineOffset, sourceLineEnd]);

  useEffect(() => {
    if (!renderer.current) return;
    colorizeTags(renderer.current.containerEl, getTagColor);
    colorizeDates(renderer.current.containerEl, getDateColor);
  }, [getTagColor, getDateColor]);

  useEffect(() => {
    const preview = renderer.current;
    if (!preview) return;
    preview.mark.unmark();
    if (searchQuery && searchQuery.trim()) {
      preview.mark.mark(searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    const preview = renderer.current;
    if (elRef.current && preview && preview.wrapperEl !== elRef.current) {
      preview.migrate(elRef.current, entityManager?.isVisible ?? true);
    }
  }, [entityManager]);

  let styles: CSSProperties | undefined = undefined;
  if (!renderer.current && view.previewCache.has(entityId)) {
    const preview = view.previewCache.get(entityId);
    if (preview.lastRefHeight > 0) {
      styles = {
        width: `${preview.lastRefWidth}px`,
        height: `${preview.lastRefHeight}px`,
      };
    }
  }

  return (
    <div
      style={styles}
      ref={elRef}
      className={classcat([c('markdown-preview-wrapper'), className])}
      {...divProps}
    />
  );
});

export const MarkdownClonedPreviewRenderer = memo(function MarkdownClonedPreviewRenderer({
  entityId,
  className,
  ...divProps
}: MarkdownRendererProps) {
  const { view } = useContext(KanbanContext);
  const elRef = useRef<HTMLDivElement>();
  const preview = view.previewCache.get(entityId);

  let styles: CSSProperties | undefined = undefined;
  if (preview && preview.lastRefHeight > 0) {
    styles = {
      width: `${preview.lastRefWidth}px`,
      height: `${preview.lastRefHeight}px`,
    };
  }

  return (
    <div
      style={styles}
      ref={(el) => {
        elRef.current = el;
        if (el && preview && el.childElementCount === 0) {
          el.append(preview.containerEl.cloneNode(true));
        }
      }}
      className={classcat([c('markdown-preview-wrapper'), className])}
      {...divProps}
    />
  );
});

import Preact from 'preact/compat';

import { ScrollStateManager } from '../managers/ScrollStateManager';
import { WithChildren } from '../types';
import { rafThrottle } from '../util/animation';
import { ScopeIdContext, ScrollStateContext } from './context';

export function DndScrollState({ children }: WithChildren) {
  const manager = Preact.useMemo(() => {
    return new ScrollStateManager();
  }, []);

  return <ScrollStateContext.Provider value={manager}>{children}</ScrollStateContext.Provider>;
}

export function useStoredScrollState(id: string) {
  const scopeId = Preact.useContext(ScopeIdContext);
  const scrollRef = Preact.useRef<HTMLDivElement>(null);
  const scrollStateManager = Preact.useContext(ScrollStateContext);

  const setRef = Preact.useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;

      if (el) {
        el.win.requestAnimationFrame(() => {
          if (scrollRef.current !== el) return;

          const state = scrollStateManager.getScrollState(id);

          if (state && (state.x !== 0 || state.y !== 0)) {
            if (el.scrollLeft !== state.x) el.scrollLeft = state.x;
            if (el.scrollTop !== state.y) el.scrollTop = state.y;
          }
        });
      }
    },
    [id, scrollStateManager]
  );

  Preact.useEffect(() => {
    const el = scrollRef.current;

    if (!el) return;

    const onScroll = rafThrottle(el.win, (e: Event) => {
      const target = e.target as HTMLElement;

      scrollStateManager.setScrollState(scopeId, id, {
        x: target.scrollLeft,
        y: target.scrollTop,
      });
    });

    el.addEventListener('scroll', onScroll);

    return () => {
      el.removeEventListener('scroll', onScroll);
      onScroll.cancel();
    };
  }, [scrollStateManager, scopeId, id]);

  return { setRef, scrollRef };
}

import classcat from 'classcat';
import { ComponentChildren } from 'preact';
import { c } from 'src/components/helpers';

import { useStoredScrollState } from './ScrollStateContext';
import { Scrollable } from './Scrollable';

interface ScrollContainerProps {
  children?: ComponentChildren;
  className?: string;
  triggerTypes: string[];
  isStatic?: boolean;
  id: string;
  index?: number;
  onWheel?: (event: WheelEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
}

export function ScrollContainer({
  className,
  children,
  triggerTypes,
  isStatic,
  id,
  onWheel,
  onPointerDown,
}: ScrollContainerProps) {
  const { setRef, scrollRef } = useStoredScrollState(id);

  return (
    <div
      ref={setRef}
      className={classcat([className, c('scroll-container')])}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
    >
      {isStatic ? (
        children
      ) : (
        <Scrollable scrollRef={scrollRef} triggerTypes={triggerTypes}>
          {children}
        </Scrollable>
      )}
    </div>
  );
}

import React, { Children, cloneElement, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowLayout } from '../../context/WorkflowLayoutContext.jsx';

export function WorkflowSlide({ id, children }) {
  return (
    <section data-workflow-slide={id} className="workflow-slide">
      <div className="workflow-slide-content">{children}</div>
    </section>
  );
}

export default function WorkflowDeck({ children, activeId, onActiveChange }) {
  const { layout } = useWorkflowLayout();
  const slides = useMemo(() => Children.toArray(children).filter(Boolean), [children]);
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef(null);
  const slideRefs = useRef([]);
  const settleRef = useRef(null);
  const dragRef = useRef(null);
  const wheelRef = useRef({ total: 0, timeout: null });

  const goTo = (index, behavior = 'smooth') => {
    const safe = Math.max(0, Math.min(slides.length - 1, index));
    setActiveIndex(safe);
    const track = trackRef.current;
    const slide = slideRefs.current[safe];
    if (track && slide) {
      const left = slide.offsetLeft - (track.clientWidth - slide.clientWidth) / 2;
      track.scrollTo({ left, behavior });
    }
    onActiveChange?.(slides[safe]?.props?.id);
  };

  useEffect(() => {
    if (layout !== 'slider' || !activeId) return;
    const index = slides.findIndex(slide => slide.props?.id === activeId);
    if (index >= 0) requestAnimationFrame(() => goTo(index));
  }, [activeId, layout, slides.length]);

  useEffect(() => {
    if (layout !== 'slider') return;
    requestAnimationFrame(() => goTo(activeIndex, 'auto'));
  }, [layout]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('workflow-slider-mode', layout === 'slider');
    return () => root.classList.remove('workflow-slider-mode');
  }, [layout]);

  useEffect(() => {
    if (layout !== 'slider') return undefined;
    const track = trackRef.current;
    if (!track) return undefined;

    const handleWheel = (event) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !event.shiftKey) return;
      event.preventDefault();

      const delta = horizontal ? event.deltaX : event.deltaY;
      wheelRef.current.total += delta;
      clearTimeout(wheelRef.current.timeout);
      wheelRef.current.timeout = setTimeout(() => {
        const direction = Math.sign(wheelRef.current.total);
        if (Math.abs(wheelRef.current.total) >= 24 && direction) {
          goTo(activeIndex + direction);
        }
        wheelRef.current.total = 0;
      }, 70);
    };

    track.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      track.removeEventListener('wheel', handleWheel);
      clearTimeout(wheelRef.current.timeout);
      wheelRef.current.total = 0;
    };
  }, [layout, activeIndex, slides.length]);

  const updateFromScroll = () => {
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track) return;
      const center = track.getBoundingClientRect().left + track.clientWidth / 2;
      let best = 0;
      let distance = Infinity;
      slideRefs.current.forEach((node, index) => {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const nextDistance = Math.abs(rect.left + rect.width / 2 - center);
        if (nextDistance < distance) {
          distance = nextDistance;
          best = index;
        }
      });
      setActiveIndex(best);
      onActiveChange?.(slides[best]?.props?.id);
    }, 90);
  };

  useEffect(() => () => clearTimeout(settleRef.current), []);

  if (layout === 'scroll') {
    return <div className="space-y-4">{slides.map(slide => cloneElement(slide, { key: slide.props.id }))}</div>;
  }

  return (
    <div
      className="workflow-slider"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') goTo(activeIndex - 1);
        if (event.key === 'ArrowRight') goTo(activeIndex + 1);
      }}
    >
      <div
        ref={trackRef}
        className="workflow-slider-track"
        onScroll={updateFromScroll}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.target.closest('button,input,textarea,select,a,label,[role="button"]')) return;
          dragRef.current = {
            x: event.clientX,
            left: trackRef.current.scrollLeft,
            moved: false,
          };
          trackRef.current.setPointerCapture?.(event.pointerId);
          trackRef.current.classList.add('is-dragging');
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const distance = event.clientX - dragRef.current.x;
          if (Math.abs(distance) > 4) dragRef.current.moved = true;
          trackRef.current.scrollLeft = dragRef.current.left - distance;
        }}
        onPointerUp={(event) => {
          if (!dragRef.current) return;
          const distance = event.clientX - dragRef.current.x;
          const moved = dragRef.current.moved;
          dragRef.current = null;
          trackRef.current.releasePointerCapture?.(event.pointerId);
          trackRef.current.classList.remove('is-dragging');
          if (moved && Math.abs(distance) >= 45) {
            goTo(activeIndex + (distance < 0 ? 1 : -1));
          } else {
            goTo(activeIndex);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          trackRef.current?.classList.remove('is-dragging');
        }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.props.id}
            ref={node => { slideRefs.current[index] = node; }}
            className={`workflow-slider-item ${index === activeIndex ? 'is-active' : ''}`}
          >
            {cloneElement(slide)}
          </div>
        ))}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useCallback } from 'react';

/**
 * Accessible modal dialog (WCAG 2.4.3 / 4.1.2 / 2.1.2):
 *   - role="dialog" aria-modal, labelled by its title
 *   - ESC closes; backdrop click closes
 *   - focus moves into the dialog on open and is restored to the previously
 *     focused element on close
 *   - a lightweight focus trap keeps Tab inside while open
 *
 * Replaces the native confirm()/prompt()/alert() calls, which are
 * inaccessible to many AT setups and block the JS thread.
 */
export default function Dialog({ title, onClose, children, labelId = 'dialog-title' }) {
  const panelRef = useRef(null);
  const lastFocusedRef = useRef(null);

  // Remember what had focus, move focus into the dialog, restore on unmount.
  useEffect(() => {
    lastFocusedRef.current = document.activeElement;
    const panel = panelRef.current;
    const focusable = panel?.querySelector(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
    );
    (focusable || panel)?.focus();
    return () => {
      const el = lastFocusedRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, []);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose?.();
      return;
    }
    if (e.key !== 'Tab') return;
    // Focus trap: wrap Tab / Shift+Tab at the edges.
    const panel = panelRef.current;
    if (!panel) return;
    const items = panel.querySelectorAll(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onClose]);

  return (
    // Backdrop click-to-dismiss is a redundant mouse affordance; keyboard
    // users close via ESC (handled below) or the dialog's Cancel/OK buttons.
    <div className="save-modal-backdrop" onClick={onClose} role="presentation">
      {/* role="dialog" with a focus-trap keydown + stopPropagation is the
          intended modal pattern; the lint rule doesn't recognize the role. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="save-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {title && <h3 id={labelId}>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

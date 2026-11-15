import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

export function PhoneHeader({
  title,
  back,
  action,
}: {
  title: string;
  back?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="phone-header">
      {back ? (
        <button className="icon-button" aria-label="뒤로" onClick={back}>
          <ArrowLeft />
        </button>
      ) : (
        <a className="phone-brand" href="?mode=phone" aria-label="carmeleon 홈">
          carmeleon
        </a>
      )}
      {back && <span className="phone-header-title">{title}</span>}
      <div className="header-actions">{action}</div>
    </header>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="phone-empty">
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PhoneDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className="phone-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}

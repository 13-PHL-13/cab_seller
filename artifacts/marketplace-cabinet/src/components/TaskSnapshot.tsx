import { useRef, useState } from "react";
import { X, Plus, Minus, RotateCcw } from "lucide-react";
import { createPortal } from "react-dom";
import type { BlockContext } from "@/lib/dashboard-model";
export default function TaskSnapshot({
  image,
  title,
}: {
  image: NonNullable<BlockContext["image"]>;
  title: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [open, setOpen] = useState(false),
    [zoom, setZoom] = useState(1);
  function close() {
    ref.current?.close();
    setOpen(false);
  }
  return (
    <>
      <button
        type="button"
        className="task-image-button"
        onClick={() => {
          setOpen(true);
          setZoom(Math.min(1, (window.innerWidth - 70) / image.width));
        }}
        aria-label={"Увеличить снимок: " + title}
      >
        <img
          className="task-block-image"
          src={image.dataUrl}
          alt={"Снимок блока: " + title}
        />
      </button>
      <span className="task-image-hint">
        Нажмите на изображение, чтобы увеличить
      </span>
      {open &&
        createPortal(
          <dialog
            id="task-snapshot-viewer"
            ref={(e) => {
              ref.current = e;
              if (e && !e.open) e.showModal();
            }}
            aria-label={"Снимок блока: " + title}
            onCancel={(e) => {
              e.preventDefault();
              close();
            }}
          >
            <header className="snapshot-viewer-head">
              <h2>{title}</h2>
              <button
                type="button"
                className="task-close"
                onClick={close}
                aria-label="Закрыть снимок"
              >
                <X size={20} />
              </button>
            </header>
            <div className="snapshot-viewer-tools">
              <button
                className="task-secondary"
                type="button"
                onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
                aria-label="Уменьшить снимок"
              >
                <Minus size={16} />
              </button>
              <output>{Math.round(zoom * 100)}%</output>
              <button
                className="task-secondary"
                type="button"
                onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
                aria-label="Увеличить снимок"
              >
                <Plus size={16} />
              </button>
              <button
                className="task-secondary"
                type="button"
                onClick={() =>
                  setZoom(Math.min(1, (window.innerWidth - 70) / image.width))
                }
              >
                <RotateCcw size={16} />
                По ширине
              </button>
            </div>
            <div className="snapshot-viewer-stage">
              <img
                src={image.dataUrl}
                style={{ width: image.width * zoom }}
                alt={title}
              />
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}

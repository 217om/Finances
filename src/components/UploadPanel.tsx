import { useCallback, useRef, useState } from 'react';

interface Props {
  onFiles: (files: FileList | File[]) => void;
  compact: boolean;
}

export default function UploadPanel({ onFiles, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
    },
    [onFiles],
  );

  return (
    <section
      className={`dropzone ${dragging ? 'dropzone-active' : ''} ${compact ? 'dropzone-compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.xlsm,.json,text/csv,application/json"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="dropzone-icon" aria-hidden>
        ⬆
      </div>
      <div className="dropzone-text">
        <strong>{compact ? 'Add more data' : 'Drop your bank statement here'}</strong>
        <span>CSV or Excel · click to browse · your file stays on your device</span>
      </div>
    </section>
  );
}

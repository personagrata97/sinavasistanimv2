import { Modal } from "../shared"
import { AlertTriangle, ShieldCheck } from "lucide-react"

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmModal({
  isOpen,
  onClose,
  title,
  message,
  confirmText = "Evet, Eminim",
  cancelText = "Vazgeç",
  isDestructive = true,
  onConfirm
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <Modal
      onClose={onClose}
      title={title}
      icon={
        isDestructive 
          ? <AlertTriangle className="w-5 h-5 text-rose-500" /> 
          : <ShieldCheck className="w-5 h-5 text-indigo-500" />
      }
      maxWidth="sm"
      zIndex={999999}
    >
      <div className="py-4">
        <div className="text-sm text-slate-300 leading-relaxed mb-6">
          {message}
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-5 py-2 text-sm font-bold rounded-lg transition-all shadow-lg border ${
              isDestructive
                ? "bg-rose-600 text-white hover:bg-rose-500 hover:shadow-rose-500/25 border-rose-500"
                : "bg-indigo-600 text-white hover:bg-indigo-500 hover:shadow-indigo-500/25 border-indigo-500"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}

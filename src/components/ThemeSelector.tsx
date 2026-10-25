import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Check, X, ArrowLeft, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppTheme, THEME_OPTIONS, AppThemeId } from '../lib/theme';

interface ThemeSelectorProps {
  variant?: 'dark' | 'light' | 'sidebar' | 'compact-dark' | 'compact-light';
  className?: string;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  variant = 'light',
  className = '',
}) => {
  const { theme, setTheme, currentThemeOption } = useAppTheme();
  const [isOpen, setIsOpen] = useState(false);

  const handleSelectTheme = (id: AppThemeId) => {
    setTheme(id);
  };

  const getButtonClasses = () => {
    switch (variant) {
      case 'dark':
        return 'px-2.5 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-100 border border-slate-700/80 rounded-xl text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer shrink-0';
      case 'compact-dark':
        return 'h-8 sm:h-9 px-2 sm:px-2.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700/70 rounded-xl text-[11px] font-bold flex items-center gap-1 shadow-sm transition-all active:scale-95 cursor-pointer shrink-0';
      case 'compact-light':
        return 'h-9 px-2.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200/90 rounded-xl text-[11px] font-bold flex items-center gap-1 shadow-xs transition-all active:scale-95 cursor-pointer shrink-0';
      case 'sidebar':
        return 'w-full flex items-center justify-between px-3 py-2 rounded-xl border bg-violet-50/80 hover:bg-violet-100/80 border-violet-200/80 text-violet-800 text-xs font-semibold transition-all cursor-pointer';
      case 'light':
      default:
        return 'h-9 sm:h-10 px-2.5 sm:px-3.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 hover:border-violet-300 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all duration-200 active:scale-[0.97] cursor-pointer shrink-0';
    }
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setIsOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 14 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 14 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white text-slate-900 rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92dvh] flex flex-col"
          >
            {/* Header */}
            <div className="p-3.5 sm:p-4 bg-slate-900 text-white flex items-center justify-between gap-2 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-all active:scale-95 cursor-pointer border border-slate-700 shrink-0"
                  title="Voltar"
                  aria-label="Voltar"
                >
                  <ArrowLeft size={15} />
                </button>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-tight text-white flex items-center gap-1.5 truncate">
                    <Palette size={15} className="text-cyan-400 shrink-0" />
                    <span>Escolha o Tema do Sistema</span>
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium truncate">
                    Personalize as cores em todos os 3 acessos
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                title="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            {/* Theme Options List */}
            <div className="p-3.5 sm:p-4 space-y-2.5 overflow-y-auto custom-scrollbar flex-1 bg-slate-50">
              {THEME_OPTIONS.map((opt) => {
                const isSelected = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectTheme(opt.id)}
                    className={`w-full text-left p-3 sm:p-3.5 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                      isSelected
                        ? 'bg-white border-blue-600 shadow-md ring-2 ring-blue-500/15'
                        : 'bg-white/90 hover:bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    {/* Color Swatch Preview */}
                    <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200/80 shrink-0 grid grid-cols-2 grid-rows-2 shadow-inner">
                      <div style={{ backgroundColor: opt.previewColors[0] }} />
                      <div style={{ backgroundColor: opt.previewColors[1] }} />
                      <div style={{ backgroundColor: opt.previewColors[2] }} />
                      <div style={{ backgroundColor: opt.previewColors[3] }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold text-xs sm:text-sm text-slate-900 truncate">
                          {opt.name}
                        </span>
                        <span
                          className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0 ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium leading-snug mt-1">
                        {opt.description}
                      </p>
                    </div>

                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-transparent border border-slate-200'
                      }`}
                    >
                      <Check size={13} className="stroke-[3]" />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-3 sm:p-3.5 bg-white border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 truncate">
                <Sparkles size={13} className="text-blue-600 shrink-0" />
                <span className="truncate">
                  Ativo: <strong className="text-slate-900">{currentThemeOption.name}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-all active:scale-95 cursor-pointer shrink-0 shadow-sm"
              >
                Concluir
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`${getButtonClasses()} ${className}`}
        title="Escolher Tema de Cores"
      >
        {variant === 'sidebar' ? (
          <>
            <span className="flex items-center gap-2 text-xs">
              <Palette size={15} className="text-violet-600 shrink-0" />
              <span>Temas</span>
            </span>
            <span className="px-2 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold truncate max-w-[110px]">
              {currentThemeOption.name}
            </span>
          </>
        ) : (
          <>
            <Palette size={14} className="shrink-0" />
            <span className="truncate">Temas</span>
          </>
        )}
      </button>

      {typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null}
    </>
  );
};

export default ThemeSelector;

import React, { createContext, useContext, useState, useEffect } from 'react';

export type AppThemeId = 'padrao' | 'alegre' | 'classico' | 'profissional';

export interface ThemeOption {
  id: AppThemeId;
  name: string;
  badge: string;
  description: string;
  previewColors: [string, string, string, string];
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'padrao',
    name: 'Padrão Atual',
    badge: 'Original',
    description: 'Mantém exatamente as cores e o visual original do sistema Operação Pipa.',
    previewColors: ['#0f172a', '#2563eb', '#06b6d4', '#f8fafc'],
  },
  {
    id: 'alegre',
    name: 'Alegre & Vibrante',
    badge: 'Cores Alegres',
    description: 'Cores vivas, solares e acolhedoras com turquesa tropical, azul-céu, coral e amarelo-sol.',
    previewColors: ['#065f46', '#0ea5e9', '#f59e0b', '#f0fdfa'],
  },
  {
    id: 'classico',
    name: 'Clássico Institucional',
    badge: 'Mais Clássico',
    description: 'Visual tradicional, sóbrio e elegante em azul-marinho imperial, marfim e dourado nobre.',
    previewColors: ['#172554', '#1e40af', '#d97706', '#faf8f5'],
  },
  {
    id: 'profissional',
    name: 'Executivo de Alto Impacto',
    badge: 'Chamativo & Profissional',
    description: 'Design moderno, marcante e corporativo em índigo elétrico, ciano neon e alto contraste.',
    previewColors: ['#090d16', '#4f46e5', '#06b6d4', '#eef2ff'],
  },
];

interface ThemeContextValue {
  theme: AppThemeId;
  setTheme: (theme: AppThemeId) => void;
  currentThemeOption: ThemeOption;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'padrao',
  setTheme: () => {},
  currentThemeOption: THEME_OPTIONS[0],
});

const STORAGE_KEY = 'pipa_app_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<AppThemeId>(() => {
    if (typeof window === 'undefined') return 'padrao';
    const saved = localStorage.getItem(STORAGE_KEY) as AppThemeId | null;
    if (saved && THEME_OPTIONS.some((t) => t.id === saved)) {
      return saved;
    }
    return 'padrao';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'padrao') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (newTheme: AppThemeId) => {
    setThemeState(newTheme);
  };

  const currentThemeOption = THEME_OPTIONS.find((t) => t.id === theme) || THEME_OPTIONS[0];

  return (
    <ThemeContext.Provider value={{ theme, setTheme, currentThemeOption }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useAppTheme = () => useContext(ThemeContext);

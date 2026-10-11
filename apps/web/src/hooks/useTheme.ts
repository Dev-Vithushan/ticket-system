import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function read(): Theme {
  try {
    const t = localStorage.getItem('tms-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('tms-theme', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return { theme, toggle };
}

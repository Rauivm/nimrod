import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { DEFAULT_ELEMENT, ELEMENT_THEMES, elementStorageKey, normalizeElement, readElementPreference, saveElementPreference } from '../config/elementThemes.js';

const ElementThemeContext = createContext(null);

export function ElementThemeProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;
  const key = elementStorageKey(userId);
  const [choices, setChoices] = useState({});
  const [saved, setSaved] = useState({});
  const theme = useMemo(() => {
    let stored = DEFAULT_ELEMENT;
    try { stored = readElementPreference(window.localStorage, userId); } catch { /* Browser storage may be unavailable. */ }
    const id = choices[key] ?? stored;
    return ELEMENT_THEMES.find(item => item.id === id) || ELEMENT_THEMES[0];
  }, [choices, key, userId]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-element');
    root.setAttribute('data-element', theme.id);
    return () => {
      if (previous === null) root.removeAttribute('data-element');
      else root.setAttribute('data-element', previous);
    };
  }, [theme.id]);

  useEffect(() => {
    const synchronize = event => {
      if (event.key === key || event.key === null) {
        setChoices(previous => ({ ...previous, [key]: normalizeElement(event.newValue) }));
        setSaved(previous => ({ ...previous, [key]: true }));
      }
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, [key]);

  const chooseTheme = useCallback(value => {
    if (normalizeElement(value) !== value) return;
    setChoices(previous => ({ ...previous, [key]: value }));
    let persisted = false;
    try { persisted = saveElementPreference(window.localStorage, userId, value); } catch { /* Keep the choice for this session. */ }
    setSaved(previous => ({ ...previous, [key]: persisted }));
  }, [key, userId]);

  return <ElementThemeContext.Provider value={{ theme, chooseTheme, persisted: saved[key] !== false }}>{children}</ElementThemeContext.Provider>;
}

export function useElementTheme() {
  return useContext(ElementThemeContext);
}

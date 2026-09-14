const THEME_STORAGE_KEY = 'kulisa-theme';

/**
 * Applies the saved/system theme to <html> before first paint (blocking
 * inline script in <head>) so switching pages or reloading never flashes
 * the wrong theme. Mirrors the storage key read by `useTheme()`.
 */
export function ThemeScript() {
  const code = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var t=s==='light'||s==='dark'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

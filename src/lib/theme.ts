// Sync system dark/light to the <html> class once on app boot.
export function initSystemTheme() {
  if (typeof window === "undefined") return;
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (dark: boolean) => {
    document.documentElement.classList.toggle("dark", dark);
  };
  apply(mql.matches);
  mql.addEventListener("change", (e) => apply(e.matches));
}

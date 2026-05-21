// FlashLocum app is light-mode only.
// (The splash screen renders dark via its own --splash token.)
export function initLightMode() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "light";
}

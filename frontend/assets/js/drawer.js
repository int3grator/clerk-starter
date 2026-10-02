let lastFocus = null;

const drawerElement = () => document.getElementById("drawer");
const scrimElement = () => document.getElementById("scrim");

export function isDrawerOpen() {
  return drawerElement().classList.contains("on");
}

export function openDrawer(html, onReady) {
  const drawer = drawerElement();
  if (!isDrawerOpen()) lastFocus = document.activeElement;
  drawer.innerHTML = `<button class="dclose" type="button" data-close-drawer>Închide</button>${html}`;
  drawer.classList.add("on");
  scrimElement().classList.add("on");
  drawer.setAttribute("aria-hidden", "false");
  drawer.scrollTop = 0;
  if (onReady) onReady(drawer);
  const focusTarget = drawer.querySelector("[autofocus]") ?? drawer.querySelector("[data-close-drawer]");
  focusTarget?.focus();
}

export function closeDrawer() {
  const drawer = drawerElement();
  if (!isDrawerOpen()) return;
  drawer.classList.remove("on");
  scrimElement().classList.remove("on");
  drawer.setAttribute("aria-hidden", "true");
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

export function initDrawer() {
  scrimElement().addEventListener("click", closeDrawer);
  drawerElement().addEventListener("click", (event) => {
    if (event.target.closest("[data-close-drawer]")) closeDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isDrawerOpen()) closeDrawer();
  });
}

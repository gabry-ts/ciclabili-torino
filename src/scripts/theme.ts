// @ts-nocheck
// Theme toggle handler. The pre-paint setting happens in <ThemeBootstrap />.
(() => {
  const root = document.documentElement;
  const button = document.querySelector(".theme-toggle");
  if (!button) return;

  const sync = () => {
    const t = root.getAttribute("data-theme") || "dark";
    button.dataset.theme = t;
    button.setAttribute("aria-label", t === "dark" ? "Passa a tema chiaro" : "Passa a tema scuro");
    button.setAttribute("title", t === "dark" ? "Tema chiaro" : "Tema scuro");
  };

  button.addEventListener("click", () => {
    const next = (root.getAttribute("data-theme") || "dark") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch {}
    sync();
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
  });

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
      if (localStorage.getItem("theme")) return;
      const next = e.matches ? "light" : "dark";
      root.setAttribute("data-theme", next);
      sync();
      window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
    });
  }

  sync();
})();

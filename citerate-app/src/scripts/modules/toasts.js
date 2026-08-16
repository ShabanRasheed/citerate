/** One toast helper, so nothing in the app builds its own notification. */
export function toast(message, tone = "ok") {
  const host = document.querySelector("[data-toast-host]");
  const template = document.getElementById("toast-template");
  if (!host || !template) return;

  const node = template.content.cloneNode(true).firstElementChild;
  node.querySelector("[data-toast-message]").textContent = message;
  if (tone === "error") node.style.background = "var(--gap-ink)";
  host.appendChild(node);

  const instance = new window.bootstrap.Toast(node, { delay: tone === "error" ? 6000 : 3500 });
  instance.show();
  node.addEventListener("hidden.bs.toast", () => node.remove());
}

export default function toasts() {
  // Flash messages arrive as a data attribute on <body> after a redirect.
  const flash = document.body.dataset.flash;
  if (flash) toast(flash);
}

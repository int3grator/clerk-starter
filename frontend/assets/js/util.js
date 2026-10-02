export const ROLE_LABELS = { owner: "Owner", editor: "Editor", approver: "Approver", viewer: "Viewer" };

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

// Removes diacritics so that searches match with or without them.
export function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function lines(value) {
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

export function uid() {
  return crypto.randomUUID();
}

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

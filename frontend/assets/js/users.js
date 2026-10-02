import { esc, formatDate, ROLE_LABELS } from "./util.js";

const ROLES = ["owner", "editor", "approver", "viewer"];

function roleSelect(name, selected, attributes = "") {
  const options = ROLES.map((role) => `<option value="${role}"${role === selected ? " selected" : ""}>${ROLE_LABELS[role]}</option>`).join("");
  return `<select name="${name}" ${attributes}>${options}</select>`;
}

async function loadUsers(ctx, container) {
  try {
    const { users } = await ctx.api("/users");
    const rows = users
      .map((user) => {
        const attributes = `data-user="${esc(user.id)}" data-current="${esc(user.accessRole)}" aria-label="Rol de acces pentru ${esc(user.username)}"`;
        return `<tr><td class="t-name">${esc(user.username)}</td><td>${user.active ? "Activ" : "Inactiv"}</td><td class="small">${esc(formatDate(user.createdAt))}</td><td>${roleSelect("accessRole", user.accessRole, attributes)}</td></tr>`;
      })
      .join("");
    container.innerHTML = `<div class="tbl-wrap"><table class="data"><thead><tr><th>Utilizator</th><th>Stare</th><th>Creat</th><th>Rol de acces</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    container.querySelectorAll("select[data-user]").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          await ctx.api(`/users/${select.dataset.user}/role`, { method: "PATCH", body: { accessRole: select.value } });
          select.dataset.current = select.value;
          ctx.notify("Rolul de acces a fost schimbat. Noile permisiuni se aplică la următoarea cerere a utilizatorului.");
        } catch (error) {
          select.value = select.dataset.current;
          ctx.handleError(error);
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<p class="error">${esc(ctx.errorMessage(error))}</p>`;
  }
}

function renderUsers(ctx, section) {
  section.innerHTML = `<div class="prose wide"><h2>Utilizatori locali</h2>
<p>Doar un Owner creează conturi și schimbă rolurile de acces.</p>
<form class="form" id="create-user-form" autocomplete="off">
<div class="row2"><label class="field">Nume de utilizator<input name="username" required maxlength="80"></label><label class="field">Parolă temporară<input name="password" type="password" minlength="12" required autocomplete="new-password"></label></div>
<label class="field">Rol de acces${roleSelect("accessRole", "viewer")}</label>
<div class="inline"><button class="btn primary" type="submit">Creează utilizatorul</button></div>
</form>
<h3>Conturi</h3><div id="users-list"><p class="small">Se încarcă…</p></div></div>`;
  const list = section.querySelector("#users-list");
  section.querySelector("#create-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    try {
      await ctx.api("/users", {
        method: "POST",
        body: {
          username: String(data.get("username") ?? ""),
          password: String(data.get("password") ?? ""),
          accessRole: String(data.get("accessRole") ?? "viewer"),
        },
      });
      form.reset();
      ctx.notify("Utilizatorul a fost creat și se poate autentifica.");
      await loadUsers(ctx, list);
    } catch (error) {
      ctx.handleError(error);
    }
  });
  loadUsers(ctx, list);
}

export const usersView = {
  id: "users",
  label: "Utilizatori",
  usesFilters: false,
  needsChart: false,
  visible: (ctx) => ctx.hasRole("owner"),
  render: renderUsers,
};

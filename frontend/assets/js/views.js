import { orgView, tableView } from "./chart-views.js";
import { actions as editorActions } from "./role-editor.js";
import { usersView } from "./users.js";

// Views appear in the toolbar in this order.
export const views = [orgView, tableView, usersView];

export const actions = { ...editorActions };

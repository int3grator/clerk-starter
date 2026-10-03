import { orgView, tableView } from "./chart-views.js";
import { actions as governanceActions, governanceView, phasesView } from "./governance.js";
import { actions as editorActions } from "./role-editor.js";
import { usersView } from "./users.js";

// Views appear in the toolbar in this order.
export const views = [orgView, tableView, governanceView, phasesView, usersView];

export const actions = { ...editorActions, ...governanceActions };

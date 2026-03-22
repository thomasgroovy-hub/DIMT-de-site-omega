const GRID_SIZE = 24;
const state = {
  session: null,
  widgets: [],
  maintenance: null,
  reports: [],
  users: [],
  serviceActive: false,
  serviceInfo: null,
  currentTab: "information",
  editMode: false,
  modal: null,
  selectedReportType: null,
  validatedSignature: "",
  signatureDirty: false,
  widgetMenuOpenId: null,
  widgetSaveTimers: new Map(),
  maintenanceSaveTimer: null,
  maintenanceStatus: "Enregistre",
  serviceTimer: null,
};

const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authError = document.getElementById("authError");
const authHelp = document.getElementById("authHelp");
const machineInfo = document.getElementById("machineInfo");
const tabTitle = document.getElementById("tabTitle");
const informationTab = document.getElementById("informationTab");
const maintenanceTab = document.getElementById("maintenanceTab");
const serviceTab = document.getElementById("serviceTab");
const headerNameRp = document.getElementById("headerNameRp");
const headerIdentifiant = document.getElementById("headerIdentifiant");
const headerStatus = document.getElementById("headerStatus");
const toastContainer = document.getElementById("toastContainer");
const modalRoot = document.getElementById("modalRoot");

let signatureCanvas;
let signatureContext;
let signatureDrawing = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function canEdit() {
  return ["administrateur", "moderateur"].includes(state.session?.user?.role);
}

function isAdmin() {
  return state.session?.user?.role === "administrateur";
}

function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function getMachineId() {
  const key = "pole_maintenance_machine_id";
  let machineId = window.localStorage.getItem(key);
  if (!machineId) {
    machineId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `machine-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(key, machineId);
  }
  return machineId;
}

function showToast(title, message = "", kind = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    ${message ? `<div class="toast-copy">${escapeHtml(message)}</div>` : ""}
  `;
  toastContainer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Erreur reseau");
  }
  return data;
}

async function boot() {
  bindAuthTabs();
  bindAuthForms();
  bindNavigation();
  bindLogout();
  document.addEventListener("click", handleDocumentClick);
  machineInfo.textContent = `ID machine : ${getMachineId()}`;
  if (await maybeBootResetPasswordFlow()) return;
  await loadSession();
}

function setAuthMode(mode) {
  document.getElementById("loginForm").classList.toggle("hidden", mode !== "login");
  document.getElementById("registerForm").classList.toggle("hidden", mode !== "register");
  document.getElementById("forgotForm").classList.toggle("hidden", mode !== "forgot");
  document.querySelectorAll("[data-auth-tab]").forEach((item) => {
    item.classList.toggle("active", item.dataset.authTab === mode);
  });
}

async function loadSession() {
  const session = await api("/api/session");
  state.session = session.authenticated ? session : null;
  state.serviceActive = Boolean(session.serviceActive);
  state.editMode = canEdit();

  if (!session.authenticated) {
    authView.classList.remove("hidden");
    appView.classList.add("hidden");
    stopServiceTimer();
    return;
  }

  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  await Promise.all([loadWidgets(), loadMaintenance(), loadReports(), loadService(), loadUsers()]);
  renderShell();
  switchTab("information");
}

async function maybeBootResetPasswordFlow() {
  const isResetPath = window.location.pathname === "/reset-password";
  if (!isResetPath) {
    return false;
  }

  authView.classList.remove("hidden");
  appView.classList.add("hidden");
  setAuthMode("login");
  document.getElementById("loginForm").classList.add("hidden");
  document.getElementById("registerForm").classList.add("hidden");
  document.getElementById("forgotForm").classList.add("hidden");

  renderResetPasswordScreen();
  return true;
}

function renderResetPasswordScreen() {
  const params = new URLSearchParams(window.location.search);
  const presetIdentifiant = params.get("identifiant") || "";
  authView.innerHTML = `
    <div class="auth-shell">
      <div class="auth-hero card">
        <p class="eyebrow">Reinitialisation</p>
        <h1>Nouveau mot de passe</h1>
        <p class="auth-copy">Saisis ton identifiant, le code recu via Discord et ton nouveau mot de passe.</p>
        <div class="chip">Contactez Ui3349 sur Discord si necessaire.</div>
      </div>
      <div class="auth-card card">
        <form id="resetPasswordForm" class="auth-form">
          <div class="field">
            <label for="resetIdentifiant">Identifiant</label>
            <input id="resetIdentifiant" name="identifiant" value="${escapeHtml(presetIdentifiant)}" required />
          </div>
          <div class="field">
            <label for="resetCodeInput">Code de validation</label>
            <input id="resetCodeInput" name="code" inputmode="numeric" required />
          </div>
          <div class="field">
            <label for="resetPasswordInput">Nouveau mot de passe</label>
            <input id="resetPasswordInput" name="password" type="password" minlength="8" required />
          </div>
          <div class="field">
            <label for="resetPasswordConfirm">Confirmation</label>
            <input id="resetPasswordConfirm" name="password_confirm" type="password" minlength="8" required />
          </div>
          <button type="submit" class="btn btn-primary btn-block">Reinitialiser le mot de passe</button>
        </form>
        <p id="resetError" class="error-text"></p>
      </div>
    </div>
  `;

  const form = document.getElementById("resetPasswordForm");
  form.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => validateField(input));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const identifiant = document.getElementById("resetIdentifiant").value.trim();
    const code = document.getElementById("resetCodeInput").value.trim();
    const password = document.getElementById("resetPasswordInput").value;
    const confirm = document.getElementById("resetPasswordConfirm").value;
    const errorNode = document.getElementById("resetError");
    if (password !== confirm) {
      errorNode.textContent = "La confirmation ne correspond pas.";
      return;
    }
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ identifiant, code, password }),
      });
      showToast("Mot de passe modifie", "La reinitialisation est terminee.");
      window.location.href = "/";
    } catch (error) {
      errorNode.textContent = error.message;
      showToast("Erreur", error.message, "error");
    }
  });
}

function bindAuthTabs() {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.authTab);
      authError.textContent = "";
      authHelp.textContent = "";
    });
  });
}

function bindAuthForms() {
  for (const formId of ["loginForm", "registerForm", "forgotForm"]) {
    const form = document.getElementById(formId);
    form.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => validateField(input));
    });
  }

  document.getElementById("forgotPasswordBtn").addEventListener("click", () => {
    setAuthMode("forgot");
    authError.textContent = "";
    authHelp.textContent = "Pour toute assistance, contactez Ui3349 sur Discord.";
  });
  document.getElementById("backToLoginBtn").addEventListener("click", () => {
    setAuthMode("login");
    authError.textContent = "";
    authHelp.textContent = "";
  });

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      formElement.reset();
      authError.textContent = "";
      showToast("Connexion reussie", "Bienvenue sur le dashboard.");
      await loadSession();
    } catch (error) {
      authError.textContent = error.message;
      showToast("Erreur", error.message, "error");
    }
  });

  document.getElementById("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.append("machine_id", getMachineId());
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      formElement.reset();
      authError.textContent = "";
      showToast("Compte cree", "Le compte a bien ete initialise.");
      await loadSession();
    } catch (error) {
      authError.textContent = error.message;
      showToast("Erreur", error.message, "error");
    }
  });

  document.getElementById("forgotForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      formElement.reset();
      authError.textContent = "";
      authHelp.textContent = result.message || "Demande envoyee.";
      showToast("Demande envoyee", "Une validation manuelle a ete notifiee.");
      window.location.href = `/reset-password?identifiant=${encodeURIComponent(form.get("identifiant"))}`;
    } catch (error) {
      authError.textContent = error.message;
      showToast("Erreur", error.message, "error");
    }
  });
}

function validateField(input) {
  const isInvalid =
    input.validity.valueMissing ||
    input.validity.tooShort ||
    (input.name === "password" && input.value && input.value.length < 8);
  input.classList.toggle("is-invalid", isInvalid);
}

function bindNavigation() {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

function bindLogout() {
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.session = null;
    showToast("Deconnexion", "La session a ete fermee.");
    await loadSession();
  });
}

function handleDocumentClick(event) {
  if (state.widgetMenuOpenId !== null && !event.target.closest("[data-widget-menu]")) {
    state.widgetMenuOpenId = null;
    if (state.currentTab === "information") renderInformation();
  }
  if (event.target.dataset.closeModal !== undefined) {
    closeModal();
  }
}

function renderShell() {
  const { user } = state.session;
  headerNameRp.textContent = user.name_rp;
  headerIdentifiant.textContent = user.identifiant;
  updateHeaderStatus();
}

function updateHeaderStatus() {
  const active = state.serviceActive;
  headerStatus.textContent = active ? "En service" : "Hors service";
  headerStatus.className = `status-badge ${active ? "status-online" : "status-offline"}`;
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));

  const panels = {
    information: informationTab,
    maintenance: maintenanceTab,
    service: serviceTab,
  };
  panels[tab].classList.remove("hidden");
  tabTitle.textContent = tab[0].toUpperCase() + tab.slice(1);
  renderCurrentTab();
}

function renderCurrentTab() {
  if (state.currentTab === "information") renderInformation();
  if (state.currentTab === "maintenance") renderMaintenance();
  if (state.currentTab === "service") renderService();
}

async function loadWidgets() {
  const data = await api("/api/widgets");
  state.widgets = data.widgets;
}

async function loadMaintenance() {
  const data = await api("/api/maintenance");
  state.maintenance = data.state;
}

async function loadReports() {
  const data = await api("/api/reports");
  state.reports = data.reports;
}

async function loadService() {
  const data = await api("/api/service");
  state.serviceInfo = data.active;
  state.serviceActive = Boolean(data.active);
  updateHeaderStatus();
}

async function loadUsers() {
  if (!isAdmin()) {
    state.users = [];
    return;
  }
  const data = await api("/api/users");
  state.users = data.users;
}

function renderInformation() {
  const editable = canEdit() && state.editMode;
  informationTab.innerHTML = `
    <div class="page-grid">
      <section class="card section-card">
        <div class="section-header">
          <div>
            <p class="section-label">Information</p>
            <h4 class="section-title">Widgets dynamiques</h4>
            <p class="section-copy">Cards modulaires, lisibles et repositionnables avec une grille de snap.</p>
          </div>
          ${canEdit() ? `
            <div class="toolbar-group">
              <button id="toggleEditMode" class="btn ${state.editMode ? "btn-primary" : "btn-ghost"}">
                Mode edition ${state.editMode ? "ON" : "OFF"}
              </button>
              <button id="resetLayoutBtn" class="btn btn-ghost">Reset layout</button>
            </div>
          ` : ""}
        </div>

        ${canEdit() ? `
          <div class="widget-toolbar">
            <div class="button-row">
              <button id="addTextWidget" class="btn btn-primary" ${!editable ? "disabled" : ""}>Ajouter widget texte</button>
              <label class="btn btn-secondary">
                Ajouter widget image
                <input id="imageInput" type="file" accept="image/*" class="sr-only" ${!editable ? "disabled" : ""} />
              </label>
            </div>
          </div>
        ` : ""}

        <div id="infoCanvas" class="layout-canvas"></div>
      </section>

      ${isAdmin() ? `
        <section class="card section-card">
          <div class="section-header">
            <div>
              <p class="section-label">Administration</p>
              <h4 class="section-title">Comptes utilisateurs</h4>
            </div>
          </div>
          <div id="adminUsers" class="users-grid"></div>
        </section>
      ` : ""}
    </div>
  `;

  if (canEdit()) {
    document.getElementById("toggleEditMode").addEventListener("click", () => {
      state.editMode = !state.editMode;
      renderInformation();
    });
    document.getElementById("resetLayoutBtn").addEventListener("click", resetWidgetLayout);
    document.getElementById("addTextWidget")?.addEventListener("click", createTextWidget);
    document.getElementById("imageInput")?.addEventListener("change", createImageWidget);
  }

  const canvas = document.getElementById("infoCanvas");
  if (!state.widgets.length) {
    canvas.innerHTML = `<div class="empty-state">Aucun widget pour le moment.</div>`;
  } else {
    state.widgets.forEach((widget) => canvas.appendChild(createWidgetNode(widget, editable, canvas)));
  }

  if (isAdmin()) renderUsersManagement();
}

function createWidgetNode(widget, editable, canvas) {
  const node = document.createElement("article");
  node.className = "widget-card";
  node.style.left = `${widget.position_x}px`;
  node.style.top = `${widget.position_y}px`;
  node.style.width = `${widget.width}px`;
  node.style.height = `${widget.height}px`;
  node.dataset.id = widget.id;

  node.innerHTML = `
    <div class="widget-header">
      <div class="widget-handle">
        <div class="widget-title">${widget.type === "text" ? "Widget texte" : "Widget image"}</div>
      </div>
      ${canEdit() ? `
        <div class="widget-menu" data-widget-menu>
          <button class="btn btn-linkish" data-action="menu-toggle">⋮</button>
          ${state.widgetMenuOpenId === widget.id ? `
            <div class="widget-menu-panel">
              <button data-action="modify">Modifier</button>
              <button data-action="duplicate">Dupliquer</button>
              <button data-action="delete">Supprimer</button>
            </div>
          ` : ""}
        </div>
      ` : ""}
    </div>
    <div class="widget-body">${widget.type === "text" ? renderTextWidget(widget, editable) : renderImageWidget(widget)}</div>
    ${editable ? `<div class="resize-handle"></div>` : ""}
  `;

  if (canEdit()) bindWidgetMenu(node, widget);
  if (editable) bindWidgetInteractions(node, widget, canvas);
  return node;
}

function bindWidgetMenu(node, widget) {
  node.querySelector('[data-action="menu-toggle"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    state.widgetMenuOpenId = state.widgetMenuOpenId === widget.id ? null : widget.id;
    renderInformation();
  });

  node.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
    await api(`/api/widgets/${widget.id}`, { method: "DELETE" });
    state.widgetMenuOpenId = null;
    showToast("Widget supprime");
    await refreshInformation();
  });

  node.querySelector('[data-action="duplicate"]')?.addEventListener("click", async () => {
    await api("/api/widgets", {
      method: "POST",
      body: JSON.stringify({
        type: widget.type,
        contenu: widget.contenu,
        image_url: widget.image_url,
        description: widget.description,
        position_x: widget.position_x + GRID_SIZE,
        position_y: widget.position_y + GRID_SIZE,
        width: widget.width,
        height: widget.height,
      }),
    });
    state.widgetMenuOpenId = null;
    showToast("Widget duplique");
    await refreshInformation();
  });

  node.querySelector('[data-action="modify"]')?.addEventListener("click", async () => {
    state.widgetMenuOpenId = null;
    if (widget.type === "image") {
      const description = window.prompt("Description du widget", widget.description || "");
      if (description === null) return;
      await api(`/api/widgets/${widget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description }),
      });
      showToast("Widget mis a jour");
      await refreshInformation();
      return;
    }
    node.querySelector(".widget-text")?.focus();
  });
}

function renderTextWidget(widget, editable) {
  return `
    ${editable ? `
      <div class="editor-tools">
        <button data-command="bold">Gras</button>
        <button data-command="italic">Italique</button>
        <button data-command="insertUnorderedList">Liste</button>
      </div>
    ` : ""}
    <div class="widget-text" contenteditable="${editable}" spellcheck="false">${widget.contenu || "<p>Sans contenu</p>"}</div>
  `;
}

function renderImageWidget(widget) {
  return `
    <div class="widget-description">${escapeHtml(widget.description || "Aucune description")}</div>
    <img class="widget-image" src="${encodeURI(widget.image_url)}" alt="${escapeHtml(widget.description || "Widget image")}" />
  `;
}

function bindWidgetInteractions(node, widget, canvas) {
  node.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      document.execCommand(button.dataset.command, false);
      const editor = node.querySelector(".widget-text");
      scheduleWidgetSave(widget.id, { contenu: editor.innerHTML });
    });
  });

  node.querySelector(".widget-text")?.addEventListener("input", () => {
    const editor = node.querySelector(".widget-text");
    scheduleWidgetSave(widget.id, { contenu: editor.innerHTML });
  });

  const handle = node.querySelector(".widget-handle");
  let dragState = null;
  handle.addEventListener("pointerdown", (event) => {
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      left: parseInt(node.style.left, 10),
      top: parseInt(node.style.top, 10),
    };
    node.classList.add("is-dragging");
    canvas.classList.add("is-drop-target");
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragState) return;
    node.style.left = `${snap(Math.max(0, dragState.left + event.clientX - dragState.startX))}px`;
    node.style.top = `${snap(Math.max(0, dragState.top + event.clientY - dragState.startY))}px`;
  });
  handle.addEventListener("pointerup", () => {
    if (!dragState) return;
    node.classList.remove("is-dragging");
    canvas.classList.remove("is-drop-target");
    scheduleWidgetSave(widget.id, {
      position_x: parseInt(node.style.left, 10),
      position_y: parseInt(node.style.top, 10),
    });
    dragState = null;
  });

  const resizeHandle = node.querySelector(".resize-handle");
  let resizeState = null;
  resizeHandle?.addEventListener("pointerdown", (event) => {
    resizeState = {
      startX: event.clientX,
      startY: event.clientY,
      width: parseInt(node.style.width, 10),
      height: parseInt(node.style.height, 10),
    };
    node.classList.add("is-dragging");
    resizeHandle.setPointerCapture(event.pointerId);
  });
  resizeHandle?.addEventListener("pointermove", (event) => {
    if (!resizeState) return;
    node.style.width = `${snap(Math.max(240, resizeState.width + event.clientX - resizeState.startX))}px`;
    node.style.height = `${snap(Math.max(180, resizeState.height + event.clientY - resizeState.startY))}px`;
  });
  resizeHandle?.addEventListener("pointerup", () => {
    if (!resizeState) return;
    node.classList.remove("is-dragging");
    scheduleWidgetSave(widget.id, {
      width: parseInt(node.style.width, 10),
      height: parseInt(node.style.height, 10),
    });
    resizeState = null;
  });
}

async function refreshInformation() {
  await Promise.all([loadWidgets(), loadUsers()]);
  if (state.currentTab === "information") renderInformation();
}

async function createTextWidget() {
  await api("/api/widgets", {
    method: "POST",
    body: JSON.stringify({
      type: "text",
      contenu: "<p>Nouveau bloc d'information</p>",
      position_x: GRID_SIZE,
      position_y: GRID_SIZE,
      width: 336,
      height: 240,
    }),
  });
  showToast("Widget ajoute", "Le widget texte est pret.");
  await refreshInformation();
}

async function createImageWidget(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("image", file);
  const uploaded = await api("/api/uploads/image", { method: "POST", body: formData });
  const description = window.prompt("Description de l'image", "Illustration maintenance");
  if (description === null) {
    event.target.value = "";
    return;
  }
  await api("/api/widgets", {
    method: "POST",
    body: JSON.stringify({
      type: "image",
      image_url: uploaded.url,
      description,
      position_x: GRID_SIZE,
      position_y: GRID_SIZE,
      width: 360,
      height: 288,
    }),
  });
  event.target.value = "";
  showToast("Widget image ajoute");
  await refreshInformation();
}

async function resetWidgetLayout() {
  await Promise.all(
    state.widgets.map((widget, index) =>
      api(`/api/widgets/${widget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          position_x: GRID_SIZE + (index % 3) * 288,
          position_y: GRID_SIZE + Math.floor(index / 3) * 240,
          width: widget.type === "image" ? 360 : 336,
          height: widget.type === "image" ? 288 : 240,
        }),
      })
    )
  );
  showToast("Layout reinitialise");
  await refreshInformation();
}

function scheduleWidgetSave(id, patch) {
  const cached = state.widgetSaveTimers.get(id);
  const merged = { ...(cached?.patch || {}), ...patch };
  window.clearTimeout(cached?.timer);
  const timer = window.setTimeout(async () => {
    try {
      await api(`/api/widgets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(merged),
      });
      showToast("Widget enregistre", "La mise en page est synchronisee.");
      await loadWidgets();
      if (state.currentTab === "information") renderInformation();
    } catch (error) {
      showToast("Erreur", error.message, "error");
    }
  }, 500);
  state.widgetSaveTimers.set(id, { timer, patch: merged });
}

function renderUsersManagement() {
  const host = document.getElementById("adminUsers");
  host.innerHTML = state.users
    .map(
      (user) => `
        <article class="user-tile">
          <strong>${escapeHtml(user.name_rp)}</strong>
          <span class="muted">Identifiant : ${escapeHtml(user.identifiant)}</span>
          <div class="button-row">
            <select data-user-role="${user.id}">
              <option value="administrateur" ${user.role === "administrateur" ? "selected" : ""}>Administrateur</option>
              <option value="moderateur" ${user.role === "moderateur" ? "selected" : ""}>Moderateur</option>
              <option value="spectateur" ${user.role === "spectateur" ? "selected" : ""}>Spectateur</option>
            </select>
            <button class="btn btn-secondary" data-user-save="${user.id}">Mettre a jour</button>
            <button class="btn btn-danger" data-user-delete="${user.id}" ${user.identifiant === "1" ? "disabled" : ""}>Supprimer</button>
          </div>
        </article>
      `
    )
    .join("");

  host.querySelectorAll("[data-user-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.userSave;
      const role = host.querySelector(`[data-user-role="${id}"]`).value;
      await api(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      showToast("Role mis a jour");
      await loadUsers();
      renderUsersManagement();
    });
  });

  host.querySelectorAll("[data-user-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Supprimer ce compte ?")) return;
      await api(`/api/users/${button.dataset.userDelete}`, { method: "DELETE" });
      showToast("Compte supprime");
      await loadUsers();
      renderUsersManagement();
    });
  });
}

function renderMaintenance() {
  const editable = canEdit();
  maintenanceTab.innerHTML = `
    <section class="card section-card sheet-card">
      <div class="sheet-toolbar">
        <div>
          <p class="section-label">Maintenance</p>
          <h4 class="section-title">Tableau de suivi</h4>
        </div>
        <div class="button-row">
          <span id="maintenanceStatus" class="save-indicator ${state.maintenanceStatus === "Enregistre" ? "is-saved" : ""}">
            ${escapeHtml(state.maintenanceStatus)}
          </span>
          ${editable ? `
            <button id="addColumnBtn" class="btn btn-secondary">Ajouter colonne</button>
            <button id="addRowBtn" class="btn btn-primary">Ajouter ligne</button>
          ` : ""}
        </div>
      </div>
      <div class="maintenance-table-wrap">
        <table class="maintenance-table" id="maintenanceTable"></table>
      </div>
    </section>
  `;

  renderMaintenanceTable();

  if (editable) {
    document.getElementById("addColumnBtn").addEventListener("click", () => {
      state.maintenance.columns.push(`Colonne ${state.maintenance.columns.length + 1}`);
      state.maintenance.rows = state.maintenance.rows.map((row) => [...row, ""]);
      renderMaintenance();
      queueMaintenanceSave();
    });
    document.getElementById("addRowBtn").addEventListener("click", () => {
      state.maintenance.rows.push(new Array(state.maintenance.columns.length).fill(""));
      renderMaintenance();
      queueMaintenanceSave();
    });
  }
}

function renderMaintenanceTable() {
  const table = document.getElementById("maintenanceTable");
  const editable = canEdit();
  table.innerHTML = `
    <thead>
      <tr>
        ${state.maintenance.columns
          .map(
            (column, index) => `
              <th>
                <div class="table-cell" data-maintenance-type="column" data-index="${index}">
                  ${escapeHtml(column)}
                </div>
              </th>
            `
          )
          .join("")}
        ${editable ? `<th class="cell-actions"><div class="table-cell">Action</div></th>` : ""}
      </tr>
    </thead>
    <tbody>
      ${state.maintenance.rows
        .map(
          (row, rowIndex) => `
            <tr>
              ${row
                .map(
                  (cell, colIndex) => `
                    <td>
                      <div class="table-cell" data-maintenance-type="cell" data-row="${rowIndex}" data-col="${colIndex}">
                        ${escapeHtml(cell)}
                      </div>
                    </td>
                  `
                )
                .join("")}
              ${editable ? `
                <td class="cell-actions">
                  <div class="table-cell">
                    <button class="btn btn-linkish" data-delete-row="${rowIndex}">Suppr.</button>
                  </div>
                </td>
              ` : ""}
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  table.querySelectorAll(".table-cell[data-maintenance-type]").forEach((cell) => {
    if (!editable) return;
    cell.addEventListener("dblclick", () => startTableCellEdit(cell));
  });
  table.querySelectorAll("[data-delete-row]").forEach((button) => {
    button.addEventListener("click", () => {
      state.maintenance.rows.splice(Number(button.dataset.deleteRow), 1);
      renderMaintenance();
      queueMaintenanceSave();
    });
  });
}

function startTableCellEdit(cell) {
  cell.contentEditable = "true";
  cell.classList.add("is-editing");
  cell.focus();
  const finish = () => {
    cell.contentEditable = "false";
    cell.classList.remove("is-editing");
    persistTableCell(cell);
  };
  cell.addEventListener("blur", finish, { once: true });
  cell.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish();
      }
    },
    { once: true }
  );
}

function persistTableCell(cell) {
  const text = cell.textContent.trim();
  if (cell.dataset.maintenanceType === "column") {
    state.maintenance.columns[Number(cell.dataset.index)] = text;
  } else {
    state.maintenance.rows[Number(cell.dataset.row)][Number(cell.dataset.col)] = text;
  }
  queueMaintenanceSave();
}

function queueMaintenanceSave() {
  state.maintenanceStatus = "Enregistrement...";
  updateMaintenanceStatus();
  window.clearTimeout(state.maintenanceSaveTimer);
  state.maintenanceSaveTimer = window.setTimeout(saveMaintenance, 600);
}

function updateMaintenanceStatus() {
  const node = document.getElementById("maintenanceStatus");
  if (!node) return;
  node.textContent = state.maintenanceStatus;
  node.classList.toggle("is-saved", state.maintenanceStatus === "Enregistre");
}

async function saveMaintenance() {
  try {
    await api("/api/maintenance", {
      method: "PUT",
      body: JSON.stringify(state.maintenance),
    });
    state.maintenanceStatus = "Enregistre";
    updateMaintenanceStatus();
  } catch (error) {
    state.maintenanceStatus = "Erreur de sauvegarde";
    updateMaintenanceStatus();
    showToast("Erreur", error.message, "error");
  }
}

function renderService() {
  stopServiceTimer();
  const startTime = state.serviceInfo?.start_time;
  serviceTab.innerHTML = `
    <div class="service-grid">
      <section class="card section-card service-hero">
        <div class="section-header">
          <div>
            <p class="section-label">Service</p>
            <h4 class="section-title">Etat actuel</h4>
            <p class="section-copy">Une carte centrale, un statut clair et des actions immediates.</p>
          </div>
          <div class="service-status">
            <span class="status-badge ${state.serviceActive ? "status-online" : "status-offline"}">
              ${state.serviceActive ? "En service" : "Hors service"}
            </span>
          </div>
        </div>

        <div class="status-row">
          <div class="timer-box">
            <span class="meta-label">Debut</span>
            <strong id="serviceStartLabel">${startTime ? formatDateTime(startTime) : "--:--"}</strong>
          </div>
          <div class="timer-box">
            <span class="meta-label">Timer</span>
            <strong id="serviceTimerLabel">${state.serviceActive ? formatDuration(startTime) : "00:00:00"}</strong>
          </div>
          <div class="timer-box">
            <span class="meta-label">Etat</span>
            <strong>${state.serviceActive ? "Actif" : "Inactif"}</strong>
          </div>
        </div>

        <div class="service-actions">
          <button id="startServiceBtn" class="btn btn-success">Prendre service</button>
          <button id="endServiceBtn" class="btn btn-danger">Fin de service</button>
          <button id="openReportModalBtn" class="btn btn-primary">Rapport</button>
        </div>
      </section>

      <section class="card section-card">
        <div class="section-header">
          <div>
            <p class="section-label">Historique</p>
            <h4 class="section-title">Derniers rapports</h4>
          </div>
        </div>
        <div id="reportList" class="report-history"></div>
      </section>
    </div>
  `;

  document.getElementById("startServiceBtn").disabled = state.serviceActive;
  document.getElementById("endServiceBtn").disabled = !state.serviceActive;
  document.getElementById("startServiceBtn").addEventListener("click", startService);
  document.getElementById("endServiceBtn").addEventListener("click", endService);
  document.getElementById("openReportModalBtn").addEventListener("click", openReportTypeModal);

  if (state.serviceActive && startTime) startServiceTimer(startTime);
  renderReportList();
}

async function startService() {
  try {
    await api("/api/service/start", { method: "POST" });
    await loadService();
    renderShell();
    renderService();
    showToast("Service pris", "La prise de service a ete envoyee.");
  } catch (error) {
    showToast("Erreur", error.message, "error");
  }
}

async function endService() {
  try {
    await api("/api/service/end", { method: "POST" });
    await loadService();
    renderShell();
    renderService();
    showToast("Service termine", "La fin de service a ete envoyee.");
  } catch (error) {
    showToast("Erreur", error.message, "error");
  }
}

function startServiceTimer(startIso) {
  stopServiceTimer();
  const tick = () => {
    const label = document.getElementById("serviceTimerLabel");
    if (label) label.textContent = formatDuration(startIso);
  };
  tick();
  state.serviceTimer = window.setInterval(tick, 1000);
}

function stopServiceTimer() {
  if (state.serviceTimer) {
    window.clearInterval(state.serviceTimer);
    state.serviceTimer = null;
  }
}

function formatDuration(startIso) {
  if (!startIso) return "00:00:00";
  const diff = Math.max(0, Date.now() - new Date(startIso).getTime());
  const hours = String(Math.floor(diff / 3600000)).padStart(2, "0");
  const minutes = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function renderReportList() {
  const host = document.getElementById("reportList");
  host.innerHTML = state.reports.length
    ? state.reports
        .map(
          (report) => `
            <article class="history-item">
              <div class="status-row">
                <strong>${report.type === "incident" ? "Incident" : "Rapport de service"}</strong>
                <span class="muted">${new Date(report.report_date).toLocaleString("fr-FR")}</span>
              </div>
              <p>${escapeHtml(report.description)}</p>
              <div class="muted">${escapeHtml(report.nom_grade)} · ${escapeHtml(report.name_rp)} (${escapeHtml(report.identifiant)})</div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">Aucun rapport disponible.</div>`;
}

function openModal(content) {
  state.modal = content;
  modalRoot.innerHTML = content;
}

function closeModal() {
  state.modal = null;
  state.selectedReportType = null;
  state.validatedSignature = "";
  state.signatureDirty = false;
  modalRoot.innerHTML = "";
}

function openReportTypeModal() {
  openModal(`
    <div class="modal-backdrop" data-close-modal>
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="section-label">Rapport</p>
            <h4 class="modal-title">Choisir un type de rapport</h4>
          </div>
          <button class="btn btn-linkish" data-close-modal>Fermer</button>
        </div>
        <div class="modal-body">
          <div class="choice-grid">
            <button class="choice-card" data-report-choice="incident">
              <strong>Incident</strong>
              <span class="muted">Declaration rapide avec date automatique.</span>
            </button>
            <button class="choice-card" data-report-choice="service">
              <strong>Rapport de service</strong>
              <span class="muted">Compte rendu structure avec date manuelle.</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `);

  modalRoot.querySelectorAll("[data-report-choice]").forEach((button) => {
    button.addEventListener("click", () => openReportFormModal(button.dataset.reportChoice));
  });
}

function openReportFormModal(type) {
  state.selectedReportType = type;
  state.validatedSignature = "";
  state.signatureDirty = false;
  openModal(`
    <div class="modal-backdrop" data-close-modal>
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div>
            <p class="section-label">Rapport</p>
            <h4 class="modal-title">${type === "incident" ? "Rapport d'incident" : "Rapport de service"}</h4>
          </div>
          <button class="btn btn-linkish" data-close-modal>Fermer</button>
        </div>
        <div class="modal-body">
          <form id="reportForm" class="stack">
            <input type="hidden" name="type" value="${type}" />
            <div class="field">
              <label for="nomGrade">Nom & Grade</label>
              <input id="nomGrade" name="nom_grade" required />
            </div>
            <div class="field">
              <label for="reportDescription">Description</label>
              <textarea id="reportDescription" name="description" required></textarea>
            </div>
            ${
              type === "service"
                ? `
                  <div class="field">
                    <label for="reportDate">Date & heure</label>
                    <input id="reportDate" type="datetime-local" name="date" required />
                  </div>
                `
                : `<div class="chip">La date et l'heure seront ajoutees automatiquement.</div>`
            }

            <div class="signature-grid">
              <div class="stack">
                <div class="signature-box">
                  <canvas id="signatureCanvas"></canvas>
                </div>
                <div class="validation-row">
                  <button type="button" id="clearSignatureBtn" class="btn btn-ghost">Effacer</button>
                  <button type="button" id="validateSignatureBtn" class="btn btn-secondary">Valider</button>
                </div>
              </div>

              <div class="signature-preview">
                <span class="meta-label">Preview</span>
                <img id="signaturePreview" alt="Apercu signature" />
                <span id="signatureStatus" class="muted">Signature non validee.</span>
              </div>
            </div>

            <div class="modal-actions">
              <button type="submit" class="btn btn-primary">Envoyer le rapport</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `);

  bindReportFormModal();
}

function bindReportFormModal() {
  const form = document.getElementById("reportForm");
  form.querySelectorAll("input, textarea").forEach((field) => {
    field.addEventListener("input", () => validateField(field));
  });

  setupSignaturePad();
  document.getElementById("clearSignatureBtn").addEventListener("click", resetSignature);
  document.getElementById("validateSignatureBtn").addEventListener("click", validateSignature);
  form.addEventListener("submit", submitReport);
}

function setupSignaturePad() {
  signatureCanvas = document.getElementById("signatureCanvas");
  const preview = document.getElementById("signaturePreview");
  signatureCanvas.width = signatureCanvas.offsetWidth * window.devicePixelRatio;
  signatureCanvas.height = 220 * window.devicePixelRatio;
  signatureContext = signatureCanvas.getContext("2d");
  signatureContext.scale(window.devicePixelRatio, window.devicePixelRatio);
  signatureContext.lineWidth = 2;
  signatureContext.lineCap = "round";
  signatureContext.strokeStyle = "#e2e8f0";
  fillSignatureBackground();
  preview.src = "";

  const getPoint = (event) => {
    const rect = signatureCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  signatureCanvas.onpointerdown = (event) => {
    signatureDrawing = true;
    const { x, y } = getPoint(event);
    signatureContext.beginPath();
    signatureContext.moveTo(x, y);
    state.signatureDirty = true;
  };
  signatureCanvas.onpointermove = (event) => {
    if (!signatureDrawing) return;
    const { x, y } = getPoint(event);
    signatureContext.lineTo(x, y);
    signatureContext.stroke();
    updateSignaturePreview(false);
  };
  signatureCanvas.onpointerup = () => {
    signatureDrawing = false;
    updateSignaturePreview(false);
  };
  signatureCanvas.onpointerleave = () => {
    signatureDrawing = false;
  };
}

function fillSignatureBackground() {
  signatureContext.fillStyle = "#0f172a";
  signatureContext.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
}

function updateSignaturePreview(validated) {
  const preview = document.getElementById("signaturePreview");
  const status = document.getElementById("signatureStatus");
  if (!preview || !status) return;
  preview.src = signatureCanvas.toDataURL("image/png");
  status.textContent = validated ? "Signature validee." : "Signature en attente de validation.";
}

function validateSignature() {
  if (!state.signatureDirty) {
    showToast("Signature requise", "Dessine une signature avant de valider.", "error");
    return;
  }
  state.validatedSignature = signatureCanvas.toDataURL("image/png");
  updateSignaturePreview(true);
  showToast("Signature validee");
}

function resetSignature() {
  if (!signatureCanvas || !signatureContext) return;
  signatureContext.setTransform(1, 0, 0, 1, 0, 0);
  fillSignatureBackground();
  signatureContext.scale(window.devicePixelRatio, window.devicePixelRatio);
  signatureContext.lineWidth = 2;
  signatureContext.lineCap = "round";
  signatureContext.strokeStyle = "#e2e8f0";
  state.signatureDirty = false;
  state.validatedSignature = "";
  updateSignaturePreview(false);
  const status = document.getElementById("signatureStatus");
  if (status) status.textContent = "Signature non validee.";
}

async function submitReport(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  if (!state.validatedSignature) {
    showToast("Signature requise", "Valide la signature avant l'envoi.", "error");
    return;
  }
  form.append("signature", state.validatedSignature);
  try {
    await api("/api/reports", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    showToast("Rapport envoye", "Le rapport a ete transmis.");
    closeModal();
    await loadReports();
    if (state.currentTab === "service") renderService();
  } catch (error) {
    showToast("Erreur", error.message, "error");
  }
}

boot().catch((error) => {
  authError.textContent = error.message;
  showToast("Erreur", error.message, "error");
});

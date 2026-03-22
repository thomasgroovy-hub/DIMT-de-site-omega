const state = {
  session: null,
  widgets: [],
  maintenance: null,
  reports: [],
  users: [],
  serviceActive: false,
  currentTab: "information",
};

const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authError = document.getElementById("authError");
const flash = document.getElementById("flash");
const userCard = document.getElementById("userCard");
const tabTitle = document.getElementById("tabTitle");
const informationTab = document.getElementById("informationTab");
const maintenanceTab = document.getElementById("maintenanceTab");
const serviceTab = document.getElementById("serviceTab");

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

function setFlash(message, isError = false) {
  flash.textContent = message || "";
  flash.style.color = isError ? "#fda4af" : "#86efac";
  if (message) {
    window.clearTimeout(setFlash.timer);
    setFlash.timer = window.setTimeout(() => {
      flash.textContent = "";
    }, 3000);
  }
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
  await loadSession();
}

async function loadSession() {
  const session = await api("/api/session");
  state.session = session.authenticated ? session : null;
  state.serviceActive = Boolean(session.serviceActive);

  if (!session.authenticated) {
    authView.classList.remove("hidden");
    appView.classList.add("hidden");
    return;
  }

  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  renderShell();
  await Promise.all([loadWidgets(), loadMaintenance(), loadReports(), loadService(), loadUsers()]);
  switchTab("information");
}

function bindAuthTabs() {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const showRegister = button.dataset.authTab === "register";
      document.getElementById("loginForm").classList.toggle("hidden", showRegister);
      document.getElementById("registerForm").classList.toggle("hidden", !showRegister);
      authError.textContent = "";
    });
  });
}

function bindAuthForms() {
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      event.currentTarget.reset();
      await loadSession();
    } catch (error) {
      authError.textContent = error.message;
    }
  });

  document.getElementById("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      event.currentTarget.reset();
      await loadSession();
    } catch (error) {
      authError.textContent = error.message;
    }
  });
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
    await loadSession();
  });
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab").forEach((panel) => panel.classList.add("hidden"));

  const map = {
    information: informationTab,
    maintenance: maintenanceTab,
    service: serviceTab,
  };
  map[tab].classList.remove("hidden");
  tabTitle.textContent = tab[0].toUpperCase() + tab.slice(1);
  renderCurrentTab();
}

function renderShell() {
  const { user } = state.session;
  userCard.innerHTML = `
    <strong>${escapeHtml(user.name_rp)}</strong>
    <div class="muted">Identifiant: ${escapeHtml(user.identifiant)}</div>
    <div class="muted">Role: ${escapeHtml(user.role)}</div>
  `;
}

function renderCurrentTab() {
  if (state.currentTab === "information") renderInformation();
  if (state.currentTab === "maintenance") renderMaintenance();
  if (state.currentTab === "service") renderService();
}

async function loadWidgets() {
  const data = await api("/api/widgets");
  state.widgets = data.widgets;
  if (state.currentTab === "information") renderInformation();
}

async function loadMaintenance() {
  const data = await api("/api/maintenance");
  state.maintenance = data.state;
  if (state.currentTab === "maintenance") renderMaintenance();
}

async function loadReports() {
  const data = await api("/api/reports");
  state.reports = data.reports;
  if (state.currentTab === "service") renderService();
}

async function loadService() {
  const data = await api("/api/service");
  state.serviceActive = Boolean(data.active);
  if (state.currentTab === "service") renderService();
}

async function loadUsers() {
  if (!isAdmin()) {
    state.users = [];
    return;
  }
  const data = await api("/api/users");
  state.users = data.users;
  if (state.currentTab === "information") renderInformation();
}

function renderInformation() {
  informationTab.innerHTML = `
    ${canEdit() ? `
      <div class="widget-toolbar">
        <button id="addTextWidget" class="primary-btn">Ajouter un widget texte</button>
        <label class="secondary-btn" style="text-align:center">
          Ajouter un widget image
          <input id="imageInput" type="file" accept="image/*" class="hidden" />
        </label>
      </div>
    ` : ""}
    <div id="infoCanvas" class="info-canvas"></div>
    ${isAdmin() ? `<div id="adminUsers" class="maintenance-controls" style="margin-top:18px"></div>` : ""}
  `;

  const canvas = document.getElementById("infoCanvas");
  if (canEdit()) {
    document.getElementById("addTextWidget").addEventListener("click", createTextWidget);
    document.getElementById("imageInput").addEventListener("change", createImageWidget);
  }

  state.widgets.forEach((widget) => {
    const node = document.createElement("article");
    node.className = "widget";
    node.style.left = `${widget.position_x}px`;
    node.style.top = `${widget.position_y}px`;
    node.style.width = `${widget.width}px`;
    node.style.height = `${widget.height}px`;
    node.dataset.id = widget.id;

    node.innerHTML = `
      <div class="widget-header">
        <strong>${widget.type === "text" ? "Texte" : "Image"}</strong>
        <div class="widget-actions">
          ${canEdit() ? `<button class="tool-btn" data-action="delete">Supprimer</button>` : ""}
        </div>
      </div>
      <div class="widget-body">${widget.type === "text" ? renderTextWidget(widget) : renderImageWidget(widget)}</div>
      ${canEdit() ? `<div class="resize-handle"></div>` : ""}
    `;

    if (canEdit()) {
      bindWidgetInteractions(node, widget);
    }

    canvas.appendChild(node);
  });

  if (isAdmin()) {
    renderUsersManagement();
  }
}

function renderUsersManagement() {
  const host = document.getElementById("adminUsers");
  if (!host) return;
  host.innerHTML = `
    <p class="eyebrow">Gestion des comptes</p>
    <div class="report-list">
      ${state.users
        .map(
          (user) => `
            <div class="report-item">
              <strong>${escapeHtml(user.name_rp)}</strong>
              <div class="muted">Identifiant: ${escapeHtml(user.identifiant)}</div>
              <div class="service-actions">
                <select data-user-role="${user.id}">
                  <option value="administrateur" ${user.role === "administrateur" ? "selected" : ""}>Administrateur</option>
                  <option value="moderateur" ${user.role === "moderateur" ? "selected" : ""}>Moderateur</option>
                  <option value="spectateur" ${user.role === "spectateur" ? "selected" : ""}>Spectateur</option>
                </select>
                <button class="primary-btn" data-user-save="${user.id}">Mettre a jour</button>
                <button class="danger-btn" data-user-delete="${user.id}" ${user.identifiant === "1" ? "disabled" : ""}>Supprimer</button>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;

  host.querySelectorAll("[data-user-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.userSave;
      const role = host.querySelector(`[data-user-role="${id}"]`).value;
      await api(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setFlash("Role mis a jour");
      await loadUsers();
    });
  });

  host.querySelectorAll("[data-user-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Supprimer ce compte ?")) return;
      await api(`/api/users/${button.dataset.userDelete}`, { method: "DELETE" });
      setFlash("Compte supprime");
      await loadUsers();
    });
  });
}

function renderTextWidget(widget) {
  return `
    <div class="editor-bar">
      ${canEdit() ? `
        <button class="tool-btn" data-command="bold">Gras</button>
        <button class="tool-btn" data-command="italic">Italique</button>
        <button class="tool-btn" data-command="insertUnorderedList">Liste</button>
      ` : ""}
    </div>
    <div class="widget-text" contenteditable="${canEdit()}" spellcheck="false">${widget.contenu || "<p>Sans contenu</p>"}</div>
  `;
}

function renderImageWidget(widget) {
  return `
    <div class="widget-desc">${escapeHtml(widget.description || "Aucune description")}</div>
    <img src="${encodeURI(widget.image_url)}" alt="${escapeHtml(widget.description || "Widget image")}" />
  `;
}

async function createTextWidget() {
  await api("/api/widgets", {
    method: "POST",
    body: JSON.stringify({ type: "text", contenu: "<p>Nouveau widget</p>" }),
  });
  setFlash("Widget texte ajoute");
  await loadWidgets();
}

async function createImageWidget(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("image", file);
  const uploaded = await api("/api/uploads/image", { method: "POST", body: formData });
  const description = window.prompt("Description de l'image", "Illustration maintenance") || "";
  await api("/api/widgets", {
    method: "POST",
    body: JSON.stringify({
      type: "image",
      image_url: uploaded.url,
      description,
      width: 360,
      height: 280,
    }),
  });
  event.target.value = "";
  setFlash("Widget image ajoute");
  await loadWidgets();
}

function bindWidgetInteractions(node, widget) {
  node.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      document.execCommand(button.dataset.command, false);
      const editor = node.querySelector(".widget-text");
      scheduleWidgetSave(widget.id, { contenu: editor.innerHTML });
    });
  });

  const editor = node.querySelector(".widget-text");
  if (editor) {
    editor.addEventListener("input", () => {
      scheduleWidgetSave(widget.id, { contenu: editor.innerHTML });
    });
  }

  const deleteBtn = node.querySelector('[data-action="delete"]');
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      await api(`/api/widgets/${widget.id}`, { method: "DELETE" });
      await loadWidgets();
    });
  }

  const header = node.querySelector(".widget-header");
  let dragState = null;
  header.addEventListener("pointerdown", (event) => {
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      left: parseInt(node.style.left, 10),
      top: parseInt(node.style.top, 10),
    };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", (event) => {
    if (!dragState) return;
    const left = Math.max(0, dragState.left + event.clientX - dragState.startX);
    const top = Math.max(0, dragState.top + event.clientY - dragState.startY);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  });
  header.addEventListener("pointerup", () => {
    if (!dragState) return;
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
    resizeHandle.setPointerCapture(event.pointerId);
  });
  resizeHandle?.addEventListener("pointermove", (event) => {
    if (!resizeState) return;
    node.style.width = `${Math.max(220, resizeState.width + event.clientX - resizeState.startX)}px`;
    node.style.height = `${Math.max(160, resizeState.height + event.clientY - resizeState.startY)}px`;
  });
  resizeHandle?.addEventListener("pointerup", () => {
    if (!resizeState) return;
    scheduleWidgetSave(widget.id, {
      width: parseInt(node.style.width, 10),
      height: parseInt(node.style.height, 10),
    });
    resizeState = null;
  });
}

const widgetSaveTimers = new Map();
function scheduleWidgetSave(id, patch) {
  const merged = { ...(widgetSaveTimers.get(id)?.patch || {}), ...patch };
  window.clearTimeout(widgetSaveTimers.get(id)?.timer);
  const timer = window.setTimeout(async () => {
    try {
      await api(`/api/widgets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(merged),
      });
      setFlash("Sauvegarde automatique effectuee");
      await loadWidgets();
    } catch (error) {
      setFlash(error.message, true);
    }
  }, 500);
  widgetSaveTimers.set(id, { timer, patch: merged });
}

function renderMaintenance() {
  const locked = !canEdit();
  const columns = state.maintenance?.columns || [];
  const rows = state.maintenance?.rows || [];

  maintenanceTab.innerHTML = `
    <div class="maintenance-controls">
      ${canEdit() ? `
        <div class="service-actions">
          <button id="addColumnBtn" class="primary-btn">Ajouter une colonne</button>
          <button id="removeColumnBtn" class="danger-btn">Supprimer la derniere colonne</button>
          <button id="addRowBtn" class="secondary-btn">Ajouter une ligne</button>
          <button id="saveMaintenanceBtn" class="primary-btn">Sauvegarder</button>
        </div>
      ` : `<div class="muted">Mode lecture seule</div>`}
      <div class="maintenance-table-wrap">
        <table id="maintenanceTable">
          <thead>
            <tr>
              ${columns.map((column) => `<th contenteditable="${!locked}">${column}</th>`).join("")}
              ${canEdit() ? `<th>Actions</th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${row.map((cell) => `<td contenteditable="${!locked}">${cell}</td>`).join("")}
                ${canEdit() ? `<td><button class="danger-btn row-delete">Supprimer</button></td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!canEdit()) return;
  document.getElementById("addColumnBtn").addEventListener("click", () => {
    state.maintenance.columns.push(`Colonne ${state.maintenance.columns.length + 1}`);
    state.maintenance.rows = state.maintenance.rows.map((row) => [...row, ""]);
    renderMaintenance();
  });
  document.getElementById("removeColumnBtn").addEventListener("click", () => {
    if (state.maintenance.columns.length <= 1) return;
    state.maintenance.columns.pop();
    state.maintenance.rows = state.maintenance.rows.map((row) => row.slice(0, -1));
    renderMaintenance();
  });
  document.getElementById("addRowBtn").addEventListener("click", () => {
    state.maintenance.rows.push(new Array(state.maintenance.columns.length).fill(""));
    renderMaintenance();
  });
  document.querySelectorAll(".row-delete").forEach((button, index) => {
    button.addEventListener("click", () => {
      state.maintenance.rows.splice(index, 1);
      renderMaintenance();
    });
  });
  document.getElementById("saveMaintenanceBtn").addEventListener("click", saveMaintenance);
}

async function saveMaintenance() {
  const table = document.getElementById("maintenanceTable");
  const columns = Array.from(table.querySelectorAll("thead th"))
    .slice(0, state.maintenance.columns.length)
    .map((cell) => cell.textContent.trim());
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td"))
      .slice(0, columns.length)
      .map((cell) => cell.textContent.trim())
  );
  state.maintenance = { columns, rows };
  await api("/api/maintenance", {
    method: "PUT",
    body: JSON.stringify(state.maintenance),
  });
  setFlash("Tableau de maintenance sauvegarde");
}

function renderService() {
  serviceTab.innerHTML = `
    <div class="service-grid">
      <div class="service-banner">
        <p class="eyebrow">Statut du service</p>
        <div class="status-pill ${state.serviceActive ? "active" : ""}">
          ${state.serviceActive ? "En service" : "Hors service"}
        </div>
        <div class="service-actions">
          <button id="startServiceBtn" class="primary-btn">Prendre son service</button>
          <button id="endServiceBtn" class="danger-btn">Fin de service</button>
        </div>
      </div>

      <div class="service-banner">
        <p class="eyebrow">Rapports</p>
        <div class="service-actions">
          <button class="secondary-btn" data-report-type="incident">Incident</button>
          <button class="secondary-btn" data-report-type="service">Rapport de service</button>
        </div>
      </div>
    </div>

    <div class="report-layout">
      <div id="reportFormHost"></div>
      <div class="report-list" id="reportList"></div>
    </div>
  `;

  document.getElementById("startServiceBtn").disabled = state.serviceActive;
  document.getElementById("endServiceBtn").disabled = !state.serviceActive;
  document.getElementById("startServiceBtn").addEventListener("click", startService);
  document.getElementById("endServiceBtn").addEventListener("click", endService);
  document.querySelectorAll("[data-report-type]").forEach((button) => {
    button.addEventListener("click", () => renderReportForm(button.dataset.reportType));
  });
  renderReportForm("incident");
  renderReportList();
}

async function startService() {
  await api("/api/service/start", { method: "POST" });
  setFlash("Prise de service envoyee");
  await loadService();
}

async function endService() {
  await api("/api/service/end", { method: "POST" });
  setFlash("Fin de service envoyee");
  await loadService();
}

function renderReportForm(type = "incident") {
  const host = document.getElementById("reportFormHost");
  host.innerHTML = `
    <div class="service-banner">
      <p class="eyebrow">${type === "incident" ? "Rapport d'incident" : "Rapport de service"}</p>
      <form id="reportForm" class="report-form">
        <input type="hidden" name="type" value="${type}" />
        <label>
          <span>Nom & Grade</span>
          <input name="nom_grade" required />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" required></textarea>
        </label>
        ${type === "service" ? `
          <label>
            <span>Date & heure</span>
            <input type="datetime-local" name="date" required />
          </label>
        ` : `<div class="muted">La date et l'heure sont remplies automatiquement.</div>`}
        <div class="signature-box">
          <canvas id="signatureCanvas"></canvas>
        </div>
        <div class="service-actions">
          <button type="button" id="resetSignatureBtn" class="ghost-btn">Reinitialiser la signature</button>
          <button type="submit" class="primary-btn">Envoyer le rapport</button>
        </div>
      </form>
    </div>
  `;

  setupSignaturePad();
  document.getElementById("resetSignatureBtn").addEventListener("click", resetSignature);
  document.getElementById("reportForm").addEventListener("submit", submitReport);
}

let signatureContext;
let signatureCanvas;
let signatureDrawing = false;

function setupSignaturePad() {
  signatureCanvas = document.getElementById("signatureCanvas");
  signatureCanvas.width = signatureCanvas.offsetWidth * window.devicePixelRatio;
  signatureCanvas.height = 220 * window.devicePixelRatio;
  signatureContext = signatureCanvas.getContext("2d");
  signatureContext.scale(window.devicePixelRatio, window.devicePixelRatio);
  signatureContext.lineWidth = 2;
  signatureContext.lineCap = "round";
  signatureContext.strokeStyle = "#e5eefc";
  signatureContext.fillStyle = "#091523";
  signatureContext.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);

  const point = (event) => {
    const rect = signatureCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  signatureCanvas.onpointerdown = (event) => {
    signatureDrawing = true;
    const { x, y } = point(event);
    signatureContext.beginPath();
    signatureContext.moveTo(x, y);
  };
  signatureCanvas.onpointermove = (event) => {
    if (!signatureDrawing) return;
    const { x, y } = point(event);
    signatureContext.lineTo(x, y);
    signatureContext.stroke();
  };
  signatureCanvas.onpointerup = () => {
    signatureDrawing = false;
  };
  signatureCanvas.onpointerleave = () => {
    signatureDrawing = false;
  };
}

function resetSignature() {
  if (!signatureContext || !signatureCanvas) return;
  signatureContext.setTransform(1, 0, 0, 1, 0, 0);
  signatureContext.fillStyle = "#091523";
  signatureContext.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  signatureContext.scale(window.devicePixelRatio, window.devicePixelRatio);
  signatureContext.lineWidth = 2;
  signatureContext.lineCap = "round";
  signatureContext.strokeStyle = "#e5eefc";
}

async function submitReport(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  form.append("signature", signatureCanvas.toDataURL("image/png"));
  await api("/api/reports", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form.entries())),
  });
  setFlash("Rapport envoye");
  event.currentTarget.reset();
  resetSignature();
  await loadReports();
}

function renderReportList() {
  const host = document.getElementById("reportList");
  if (!host) return;
  host.innerHTML = state.reports.length
    ? state.reports
        .map(
          (report) => `
        <article class="report-item">
          <strong>${report.type === "incident" ? "Incident" : "Rapport de service"}</strong>
          <div>${escapeHtml(report.nom_grade)}</div>
          <div class="muted">${new Date(report.report_date).toLocaleString("fr-FR")}</div>
          <p>${escapeHtml(report.description)}</p>
          <div class="muted">${escapeHtml(report.name_rp)} (${escapeHtml(report.identifiant)})</div>
        </article>
      `
        )
        .join("")
    : `<p class="muted">Aucun rapport pour le moment.</p>`;
}

boot().catch((error) => {
  authError.textContent = error.message;
});

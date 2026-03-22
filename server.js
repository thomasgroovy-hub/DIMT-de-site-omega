const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
app.disable("x-powered-by");
app.set("trust proxy", 1);

const ROOT = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : ROOT;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");
const IMAGE_DIR = path.join(UPLOAD_DIR, "images");
const SIGNATURE_DIR = path.join(UPLOAD_DIR, "signatures");
const DB_PATH = path.join(DATA_DIR, "pole-maintenance.db");
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL =
  process.env.DISCORD_WEBHOOK_URL ||
  "https://discordapp.com/api/webhooks/1485369745371824282/TYhWQvnUrykW4cmP52zKdYJg9_rOq5KfyZaDFlMv5BZsvaajmzIa9ojDHOt9Mc3meEis";

for (const dir of [DATA_DIR, UPLOAD_DIR, IMAGE_DIR, SIGNATURE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifiant TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('administrateur', 'moderateur', 'spectateur')),
    name_rp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('text', 'image')),
    contenu TEXT,
    image_url TEXT,
    description TEXT,
    position_x INTEGER NOT NULL DEFAULT 32,
    position_y INTEGER NOT NULL DEFAULT 32,
    width INTEGER NOT NULL DEFAULT 320,
    height INTEGER NOT NULL DEFAULT 220,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS maintenance_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER,
    FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('incident', 'service')),
    user_id INTEGER NOT NULL,
    nom_grade TEXT NOT NULL,
    description TEXT NOT NULL,
    report_date TEXT NOT NULL,
    signature_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reset_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    identifiant TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'refused', 'completed')),
    admin_token_hash TEXT NOT NULL,
    reset_token_hash TEXT,
    reset_expires_at TEXT,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

const existingMaintenance = db
  .prepare("SELECT id FROM maintenance_state WHERE id = 1")
  .get();
if (!existingMaintenance) {
  db.prepare(
    "INSERT INTO maintenance_state (id, data, updated_by) VALUES (1, ?, NULL)"
  ).run(
    JSON.stringify({
      columns: ["Service", "Etat", "Derniere mise a jour"],
      rows: [["", "", ""]],
    })
  );
}

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMAGE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage: imageStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Seules les images sont autorisees"));
      return;
    }
    cb(null, true);
  },
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: DATA_DIR,
    }),
    secret:
      process.env.SESSION_SECRET ||
      "pole-maintenance-changez-ce-secret-en-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12,
      secure: "auto",
    },
  })
);

app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/public", express.static(path.join(ROOT, "public")));

function htmlPage() {
  return fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
}

function normalizeRole(role) {
  return role === "admin"
    ? "administrateur"
    : role === "moderator"
      ? "moderateur"
      : role;
}

function formatFrenchDate(isoValue) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(isoValue))
    .replace(",", " a");
}

function sanitizeText(input, fallback = "") {
  return String(input || fallback).trim();
}

function sanitizeRichText(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function logAction(action, userId = null) {
  db.prepare("INSERT INTO logs (user_id, action) VALUES (?, ?)").run(userId, action);
}

function getBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function renderInfoPage(title, message, extra = "") {
  return `<!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        body{margin:0;font-family:Inter,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;padding:24px}
        .card{max-width:680px;background:#1e293b;border:1px solid rgba(148,163,184,.16);border-radius:24px;padding:32px;box-shadow:0 24px 48px rgba(2,6,23,.35)}
        a{color:#93c5fd}
        p{line-height:1.7;color:#cbd5e1}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
        ${extra}
      </div>
    </body>
  </html>`;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.status(401).json({ error: "Authentification requise" });
    return;
  }
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      res.status(403).json({ error: "Acces refuse" });
      return;
    }
    next();
  };
}

function getCurrentUser(req) {
  if (!req.session.user) return null;
  return db
    .prepare("SELECT id, identifiant, role, name_rp FROM users WHERE id = ?")
    .get(req.session.user.id);
}

function activeServiceForUser(userId) {
  return db
    .prepare(
      "SELECT id, start_time, end_time FROM services WHERE user_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1"
    )
    .get(userId);
}

async function sendDiscordEmbed({ title, fields, color = 0x2f855a, attachment, components }) {
  const embed = {
    title,
    color,
    fields: fields.map((field) => ({
      name: field.name,
      value: String(field.value || "-").slice(0, 1024),
      inline: Boolean(field.inline),
    })),
    timestamp: new Date().toISOString(),
  };

  const payload = { embeds: [embed] };
  if (components) {
    payload.components = components;
  }

  if (attachment) {
    embed.image = { url: `attachment://${attachment.filename}` };
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append(
      "files[0]",
      new Blob([attachment.buffer], { type: attachment.mimeType }),
      attachment.filename
    );
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Echec webhook Discord: ${response.status}`);
    }
    return;
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Echec webhook Discord: ${response.status}`);
  }
}

app.get("/", (_req, res) => {
  res.type("html").send(htmlPage());
});

app.get("/reset-password", (_req, res) => {
  res.type("html").send(htmlPage());
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    res.json({
      authenticated: false,
      usersExist: db.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0,
    });
    return;
  }
  res.json({
    authenticated: true,
    user,
    serviceActive: Boolean(activeServiceForUser(user.id)),
  });
});

app.post("/api/auth/register", async (req, res) => {
  const identifiant = sanitizeText(req.body.identifiant);
  const password = String(req.body.password || "");
  const nameRp = sanitizeText(req.body.name_rp);

  if (!identifiant || !password || !nameRp) {
    res.status(400).json({ error: "Tous les champs sont obligatoires" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres" });
    return;
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE identifiant = ?")
    .get(identifiant);
  if (existing) {
    res.status(409).json({ error: "Cet identifiant existe deja" });
    return;
  }

  const role = "spectateur";
  const passwordHash = await bcrypt.hash(password, 12);
  const result = db
    .prepare(
      "INSERT INTO users (identifiant, password_hash, role, name_rp) VALUES (?, ?, ?, ?)"
    )
    .run(identifiant, passwordHash, role, nameRp);

  req.session.user = { id: result.lastInsertRowid, role };
  logAction("register", result.lastInsertRowid);
  res.status(201).json({
    ok: true,
    user: getCurrentUser(req),
    serviceActive: false,
  });
});

app.post("/api/auth/login", async (req, res) => {
  const identifiant = sanitizeText(req.body.identifiant);
  const password = String(req.body.password || "");
  const user = db
    .prepare("SELECT id, identifiant, password_hash, role, name_rp FROM users WHERE identifiant = ?")
    .get(identifiant);

  if (!user) {
    logAction(`login_failed:${identifiant}`);
    res.status(401).json({ error: "Identifiants invalides" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    logAction(`login_failed:${identifiant}`, user.id);
    res.status(401).json({ error: "Identifiants invalides" });
    return;
  }

  req.session.user = { id: user.id, role: user.role };
  logAction("login_success", user.id);
  res.json({
    ok: true,
    user: {
      id: user.id,
      identifiant: user.identifiant,
      role: user.role,
      name_rp: user.name_rp,
    },
    serviceActive: Boolean(activeServiceForUser(user.id)),
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  logAction("logout", req.session.user.id);
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const identifiant = sanitizeText(req.body.identifiant);
  if (!identifiant) {
    res.status(400).json({ error: "Identifiant requis" });
    return;
  }

  const user = db
    .prepare("SELECT id, identifiant FROM users WHERE identifiant = ?")
    .get(identifiant);

  logAction(`reset_requested:${identifiant}`, user?.id || null);

  if (!user) {
    res.json({
      ok: true,
      message: "Si un compte existe, une demande de reinitialisation a ete enregistree.",
    });
    return;
  }

  const adminToken = crypto.randomBytes(32).toString("hex");
  const requestInfo = db
    .prepare(
      `INSERT INTO reset_requests (user_id, identifiant, admin_token_hash)
       VALUES (?, ?, ?)`
    )
    .run(user.id, identifiant, hashToken(adminToken));

  const baseUrl = getBaseUrl(req);
  const approveUrl = `${baseUrl}/reset-requests/${requestInfo.lastInsertRowid}/approve?token=${adminToken}`;
  const refuseUrl = `${baseUrl}/reset-requests/${requestInfo.lastInsertRowid}/refuse?token=${adminToken}`;

  try {
    await sendDiscordEmbed({
      title: "Demande de reinitialisation",
      color: 0xf59e0b,
      fields: [
        { name: "Identifiant", value: identifiant },
        { name: "Date", value: formatFrenchDate(new Date().toISOString()) },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "Accepter", url: approveUrl },
            { type: 2, style: 5, label: "Refuser", url: refuseUrl },
          ],
        },
      ],
    });
  } catch (error) {
    logAction(`error:reset_webhook_failed:${identifiant}`, user.id);
    console.error(error);
  }

  res.json({
    ok: true,
    message: "Si un compte existe, une demande de reinitialisation a ete enregistree.",
  });
});

app.get("/reset-requests/:id/approve", async (req, res) => {
  const requestId = Number(req.params.id);
  const token = sanitizeText(req.query.token);
  const requestRecord = db
    .prepare("SELECT * FROM reset_requests WHERE id = ?")
    .get(requestId);

  if (!requestRecord || requestRecord.status !== "pending" || hashToken(token) !== requestRecord.admin_token_hash) {
    res.status(400).type("html").send(
      renderInfoPage("Lien invalide", "Cette demande ne peut plus etre approuvee.")
    );
    return;
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetExpiresAt = addMinutes(new Date(), 10);
  db.prepare(
    `UPDATE reset_requests
     SET status = 'approved', reset_token_hash = ?, reset_expires_at = ?, decided_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(hashToken(resetToken), resetExpiresAt, requestId);
  logAction("reset_approved", requestRecord.user_id);

  const resetUrl = `${getBaseUrl(req)}/reset-password?token=${encodeURIComponent(resetToken)}`;

  try {
    await sendDiscordEmbed({
      title: "Reinitialisation approuvee",
      color: 0x22c55e,
      fields: [
        { name: "Identifiant", value: requestRecord.identifiant },
        { name: "Lien valable 10 minutes", value: resetUrl },
      ],
    });
  } catch (error) {
    logAction(`error:reset_approved_webhook_failed:${requestRecord.identifiant}`, requestRecord.user_id);
    console.error(error);
  }

  res.type("html").send(
    renderInfoPage(
      "Demande approuvee",
      "La demande a ete validee. Le lien ci-dessous permet de reinitialiser le mot de passe pendant 10 minutes.",
      `<p><a href="${resetUrl}">${resetUrl}</a></p><p>Pour toute assistance, contactez Ui3349 sur Discord.</p>`
    )
  );
});

app.get("/reset-requests/:id/refuse", (req, res) => {
  const requestId = Number(req.params.id);
  const token = sanitizeText(req.query.token);
  const requestRecord = db
    .prepare("SELECT * FROM reset_requests WHERE id = ?")
    .get(requestId);

  if (!requestRecord || requestRecord.status !== "pending" || hashToken(token) !== requestRecord.admin_token_hash) {
    res.status(400).type("html").send(
      renderInfoPage("Lien invalide", "Cette demande ne peut plus etre refusee.")
    );
    return;
  }

  db.prepare(
    "UPDATE reset_requests SET status = 'refused', decided_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(requestId);
  logAction("reset_refused", requestRecord.user_id);

  res.type("html").send(
    renderInfoPage(
      "Demande refusee",
      "La demande de reinitialisation a ete refusee.",
      "<p>Pour toute assistance, contactez Ui3349 sur Discord.</p>"
    )
  );
});

app.get("/api/auth/reset-password/validate", (req, res) => {
  const token = sanitizeText(req.query.token);
  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }
  const requestRecord = db
    .prepare(
      `SELECT rr.id, rr.identifiant, rr.reset_expires_at
       FROM reset_requests rr
       WHERE rr.reset_token_hash = ? AND rr.status = 'approved'
       LIMIT 1`
    )
    .get(hashToken(token));

  if (!requestRecord || new Date(requestRecord.reset_expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: "Ce lien de reinitialisation est invalide ou expire." });
    return;
  }

  res.json({
    ok: true,
    identifiant: requestRecord.identifiant,
    assistance: "Pour toute assistance, contactez Ui3349 sur Discord.",
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const token = sanitizeText(req.body.token);
  const password = String(req.body.password || "");
  if (!token || password.length < 8) {
    res.status(400).json({ error: "Token invalide ou mot de passe trop court." });
    return;
  }

  const requestRecord = db
    .prepare(
      `SELECT * FROM reset_requests
       WHERE reset_token_hash = ? AND status = 'approved'
       LIMIT 1`
    )
    .get(hashToken(token));

  if (!requestRecord || new Date(requestRecord.reset_expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: "Ce lien de reinitialisation est invalide ou expire." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, requestRecord.user_id);
  db.prepare(
    `UPDATE reset_requests
     SET status = 'completed', completed_at = CURRENT_TIMESTAMP, reset_token_hash = NULL
     WHERE id = ?`
  ).run(requestRecord.id);
  logAction("reset_completed", requestRecord.user_id);

  res.json({ ok: true });
});

app.get("/api/users", requireRole(["administrateur"]), (_req, res) => {
  const users = db
    .prepare(
      "SELECT id, identifiant, role, name_rp, created_at FROM users ORDER BY id ASC"
    )
    .all();
  res.json({ users });
});

app.patch("/api/users/:id", requireRole(["administrateur"]), (req, res) => {
  const userId = Number(req.params.id);
  const target = db
    .prepare("SELECT id, identifiant, role FROM users WHERE id = ?")
    .get(userId);
  if (!target) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  const role = normalizeRole(req.body.role);
  if (!["administrateur", "moderateur", "spectateur"].includes(role)) {
    res.status(400).json({ error: "Role invalide" });
    return;
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  res.json({ ok: true });
});

app.delete("/api/users/:id", requireRole(["administrateur"]), (req, res) => {
  const userId = Number(req.params.id);
  const target = db
    .prepare("SELECT id, identifiant FROM users WHERE id = ?")
    .get(userId);
  if (!target) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  res.json({ ok: true });
});

app.get("/api/widgets", requireAuth, (_req, res) => {
  const widgets = db
    .prepare(
      "SELECT id, type, contenu, image_url, description, position_x, position_y, width, height FROM widgets ORDER BY sort_order ASC, id ASC"
    )
    .all();
  res.json({ widgets });
});

app.post(
  "/api/uploads/image",
  requireRole(["administrateur", "moderateur"]),
  upload.single("image"),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Image manquante" });
      return;
    }
    res.status(201).json({
      url: `/uploads/images/${req.file.filename}`,
      filename: req.file.filename,
    });
  }
);

app.post("/api/widgets", requireRole(["administrateur", "moderateur"]), (req, res) => {
  const type = sanitizeText(req.body.type);
  if (!["text", "image"].includes(type)) {
    res.status(400).json({ error: "Type de widget invalide" });
    return;
  }
  if (type === "image" && !sanitizeText(req.body.image_url)) {
    res.status(400).json({ error: "L'image du widget est obligatoire" });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO widgets
      (type, contenu, image_url, description, position_x, position_y, width, height, sort_order, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      type,
      type === "text" ? sanitizeRichText(req.body.contenu || "<p>Nouveau widget</p>") : "",
      type === "image" ? sanitizeText(req.body.image_url) : null,
      sanitizeText(req.body.description),
      Number(req.body.position_x || 32),
      Number(req.body.position_y || 32),
      Number(req.body.width || 320),
      Number(req.body.height || 220),
      Number(req.body.sort_order || Date.now()),
      req.session.user.id
    );
  const widget = db
    .prepare(
      "SELECT id, type, contenu, image_url, description, position_x, position_y, width, height FROM widgets WHERE id = ?"
    )
    .get(info.lastInsertRowid);
  res.status(201).json({ widget });
});

app.patch("/api/widgets/:id", requireRole(["administrateur", "moderateur"]), (req, res) => {
  const id = Number(req.params.id);
  const widget = db.prepare("SELECT id FROM widgets WHERE id = ?").get(id);
  if (!widget) {
    res.status(404).json({ error: "Widget introuvable" });
    return;
  }

  db.prepare(
    `UPDATE widgets SET
      contenu = COALESCE(?, contenu),
      image_url = COALESCE(?, image_url),
      description = COALESCE(?, description),
      position_x = COALESCE(?, position_x),
      position_y = COALESCE(?, position_y),
      width = COALESCE(?, width),
      height = COALESCE(?, height),
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`
  ).run(
    req.body.contenu === undefined ? null : sanitizeRichText(req.body.contenu),
    req.body.image_url === undefined ? null : sanitizeText(req.body.image_url),
    req.body.description === undefined ? null : sanitizeText(req.body.description),
    req.body.position_x === undefined ? null : Number(req.body.position_x),
    req.body.position_y === undefined ? null : Number(req.body.position_y),
    req.body.width === undefined ? null : Number(req.body.width),
    req.body.height === undefined ? null : Number(req.body.height),
    req.session.user.id,
    id
  );
  res.json({ ok: true });
});

app.delete("/api/widgets/:id", requireRole(["administrateur", "moderateur"]), (req, res) => {
  db.prepare("DELETE FROM widgets WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/maintenance", requireAuth, (_req, res) => {
  const record = db.prepare("SELECT data, updated_at FROM maintenance_state WHERE id = 1").get();
  res.json({
    state: JSON.parse(record.data),
    updatedAt: record.updated_at,
  });
});

app.put("/api/maintenance", requireRole(["administrateur", "moderateur"]), (req, res) => {
  const state = req.body;
  if (!Array.isArray(state.columns) || !Array.isArray(state.rows)) {
    res.status(400).json({ error: "Structure du tableau invalide" });
    return;
  }
  if (!state.columns.length) {
    res.status(400).json({ error: "Le tableau doit contenir au moins une colonne" });
    return;
  }
  if (!state.rows.every((row) => Array.isArray(row) && row.length === state.columns.length)) {
    res.status(400).json({ error: "Les lignes ne correspondent pas aux colonnes" });
    return;
  }
  db.prepare(
    "UPDATE maintenance_state SET data = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1"
  ).run(JSON.stringify(state), req.session.user.id);
  res.json({ ok: true });
});

app.get("/api/service", requireAuth, (req, res) => {
  const active = activeServiceForUser(req.session.user.id);
  res.json({ active });
});

app.post("/api/service/start", requireAuth, async (req, res) => {
  const user = getCurrentUser(req);
  if (activeServiceForUser(user.id)) {
    res.status(400).json({ error: "Un service est deja en cours" });
    return;
  }
  const now = new Date().toISOString();
  db.prepare("INSERT INTO services (user_id, start_time) VALUES (?, ?)").run(user.id, now);

  try {
    await sendDiscordEmbed({
      title: "Prise de service",
      color: 0x2563eb,
      fields: [
        { name: "Name RolePlay", value: user.name_rp },
        { name: "Identifiant", value: user.identifiant },
        { name: "Date & Heure", value: formatFrenchDate(now) },
      ],
    });
  } catch (error) {
    console.error(error);
  }

  res.status(201).json({ ok: true, active: activeServiceForUser(user.id) });
});

app.post("/api/service/end", requireAuth, async (req, res) => {
  const user = getCurrentUser(req);
  const active = activeServiceForUser(user.id);
  if (!active) {
    res.status(400).json({ error: "Aucun service actif a terminer" });
    return;
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE services SET end_time = ? WHERE id = ?").run(now, active.id);

  try {
    await sendDiscordEmbed({
      title: "Fin de service",
      color: 0xdc2626,
      fields: [
        { name: "Name RolePlay", value: user.name_rp },
        { name: "Identifiant", value: user.identifiant },
        { name: "Date & Heure", value: formatFrenchDate(now) },
      ],
    });
  } catch (error) {
    console.error(error);
  }

  res.json({ ok: true });
});

app.post("/api/reports", requireAuth, async (req, res) => {
  const user = getCurrentUser(req);
  const type = sanitizeText(req.body.type);
  const nomGrade = sanitizeText(req.body.nom_grade);
  const description = sanitizeText(req.body.description);
  const manualDate = sanitizeText(req.body.date);
  const signature = String(req.body.signature || "");

  if (!["incident", "service"].includes(type)) {
    res.status(400).json({ error: "Type de rapport invalide" });
    return;
  }
  if (!nomGrade || !description || !signature.startsWith("data:image/png;base64,")) {
    res.status(400).json({ error: "Champs du rapport incomplets" });
    return;
  }

  const reportDateObject = type === "incident" ? new Date() : new Date(manualDate);
  if (Number.isNaN(reportDateObject.getTime())) {
    res.status(400).json({ error: "Date de rapport invalide" });
    return;
  }
  const reportDate = reportDateObject.toISOString();

  const base64Content = signature.split(",")[1];
  const signatureBuffer = Buffer.from(base64Content, "base64");
  const signatureFilename = `${Date.now()}-${crypto.randomUUID()}.png`;
  const signaturePath = path.join(SIGNATURE_DIR, signatureFilename);
  fs.writeFileSync(signaturePath, signatureBuffer);
  const signatureUrl = `/uploads/signatures/${signatureFilename}`;

  const result = db
    .prepare(
      "INSERT INTO reports (type, user_id, nom_grade, description, report_date, signature_url) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(type, user.id, nomGrade, description, reportDate, signatureUrl);

  try {
    await sendDiscordEmbed({
      title: type === "incident" ? "Rapport d'incident" : "Rapport de service",
      color: type === "incident" ? 0xf59e0b : 0x16a34a,
      fields: [
        { name: "Nom & Grade", value: nomGrade },
        { name: "Description", value: description },
        { name: "Date & Heure", value: formatFrenchDate(reportDate) },
        { name: "Identifiant", value: user.identifiant, inline: true },
        { name: "Name RP", value: user.name_rp, inline: true },
      ],
      attachment: {
        filename: `signature-${result.lastInsertRowid}.png`,
        buffer: signatureBuffer,
        mimeType: "image/png",
      },
    });
  } catch (error) {
    console.error(error);
  }

  res.status(201).json({ ok: true, signatureUrl });
});

app.get("/api/reports", requireAuth, (_req, res) => {
  const reports = db
    .prepare(
      `SELECT reports.id, reports.type, reports.nom_grade, reports.description, reports.report_date,
        reports.signature_url, users.identifiant, users.name_rp
      FROM reports
      JOIN users ON users.id = reports.user_id
      ORDER BY reports.created_at DESC`
    )
    .all();
  res.json({ reports });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  logAction(`error:${sanitizeText(error.message || "unknown")}`);
  res.status(500).json({ error: error.message || "Erreur interne" });
});

app.listen(PORT, () => {
  console.log(`Pole de maintenance disponible sur http://localhost:${PORT}`);
});

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
  "https://discord.com/api/webhooks/1480952932517281963/Mr-PxwQjFveFVK6Lm-klSF_GVg77uz6DBeCt487CTMkRBnDmzEKOJtJxd9FP685lhisG";

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

async function sendDiscordEmbed({ title, fields, color = 0x2f855a, attachment }) {
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
    res.status(401).json({ error: "Identifiants invalides" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "Identifiants invalides" });
    return;
  }

  req.session.user = { id: user.id, role: user.role };
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
  req.session.destroy(() => {
    res.json({ ok: true });
  });
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
  res.status(500).json({ error: error.message || "Erreur interne" });
});

app.listen(PORT, () => {
  console.log(`Pole de maintenance disponible sur http://localhost:${PORT}`);
});

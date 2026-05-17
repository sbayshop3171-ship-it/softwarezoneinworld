const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const firebaseAdmin = require('firebase-admin');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_BOOT_TIME = new Date().toISOString();
const SERVER_FILE_PATH = path.resolve(__filename);
const SERVER_FILE_MTIME = (() => {
  try {
    return fs.statSync(SERVER_FILE_PATH).mtime.toISOString();
  } catch (error) {
    return null;
  }
})();
const SERVER_RELEASE_ID = String(
  process.env.SERVER_RELEASE_ID || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || ''
).trim() || null;

// Middleware
// Increase body size limit to handle base64 file uploads (APK/base64 can be large)
app.use(bodyParser.json({ limit: '200mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '200mb' }));
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
});

// Database setup
const db = new sqlite3.Database('./database.db');
const SERVICE_VOICE_KEYS = [
  'phone-service',
  'social-media-service',
  'email-service',
  'information-service',
  'instagram-service',
  'social-media-service-one',
  'premium-apps-service'
];
const PUSH_PLATFORM_ANDROID = 'android';
const PUSH_BATCH_SIZE = 500;
const REPORT_TYPE_BKASH = 'bkash';
const REPORT_TYPE_PAGE = 'page';
const REPORT_TYPES = new Set([REPORT_TYPE_BKASH, REPORT_TYPE_PAGE]);
const REPORT_FIELD_TYPE_TEXT = 'text';
const REPORT_FIELD_TYPE_IMAGE = 'image';
const REPORT_FIELD_TYPES = new Set([REPORT_FIELD_TYPE_TEXT, REPORT_FIELD_TYPE_IMAGE]);
const ADMIN_SESSION_HEADER = 'x-admin-session';
const ADMIN_SESSION_TTL_MS = Math.max(
  5 * 60 * 1000,
  parseInt(process.env.ADMIN_SESSION_TTL_MS || String(24 * 60 * 60 * 1000), 10) || (24 * 60 * 60 * 1000)
);
const ADMIN_STATIC_SESSION = String(process.env.ADMIN_API_SESSION || '').trim();
const adminSessions = new Map();
const INVALID_PUSH_TOKEN_ERRORS = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);

let firebaseMessaging = null;
let firebaseInitError = null;

function parseFirebaseServiceAccount(rawConfig) {
  const configValue = String(rawConfig || '').trim();
  if (!configValue) return null;

  let serviceAccount = null;
  try {
    serviceAccount = JSON.parse(configValue);
  } catch (jsonErr) {
    if (!fs.existsSync(configValue)) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON string or a valid file path');
    }
    const fileData = fs.readFileSync(configValue, 'utf8');
    serviceAccount = JSON.parse(fileData);
  }

  if (serviceAccount && typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  return serviceAccount;
}

function initFirebaseMessaging() {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawServiceAccount) {
    return;
  }

  try {
    const serviceAccount = parseFirebaseServiceAccount(rawServiceAccount);
    if (!serviceAccount || !serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error('Invalid Firebase service account JSON');
    }
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount)
      });
    }
    firebaseMessaging = firebaseAdmin.messaging();
    firebaseInitError = null;
    console.log('Firebase Admin initialized successfully');
  } catch (err) {
    firebaseInitError = err;
    firebaseMessaging = null;
    console.error('Firebase Admin initialization failed:', err.message);
  }
}

function getDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getApiRouteSignatures() {
  if (!app._router || !Array.isArray(app._router.stack)) {
    return [];
  }

  const signatures = [];
  app._router.stack.forEach((layer) => {
    if (!layer || !layer.route || !layer.route.path || !layer.route.methods) {
      return;
    }

    const methods = Object.keys(layer.route.methods)
      .filter((methodKey) => layer.route.methods[methodKey])
      .map((methodKey) => methodKey.toUpperCase())
      .sort();

    methods.forEach((methodName) => {
      signatures.push(`${methodName}:${String(layer.route.path)}`);
    });
  });

  return signatures.sort();
}

function chunkArray(items, chunkSize) {
  const result = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize));
  }
  return result;
}

function normalizeSinceForSqlite(input) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace('T', ' ').slice(0, 19);
}

function normalizeOptionalUrl(input, options = {}) {
  const value = String(input || '').trim();
  if (!value) return '';

  const { allowRelative = false, allowDataImage = false } = options;

  if (allowDataImage && /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)) {
    return value;
  }

  if (allowRelative && value.startsWith('/')) {
    return value;
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`;
  try {
    const parsedUrl = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return '';
    }
    return parsedUrl.toString();
  } catch (err) {
    return '';
  }
}

function normalizeReportType(input) {
  const normalized = String(input || '').trim().toLowerCase();
  if (!REPORT_TYPES.has(normalized)) return '';
  return normalized;
}

function normalizeReportFieldType(input) {
  const normalized = String(input || '').trim().toLowerCase();
  if (!REPORT_FIELD_TYPES.has(normalized)) return REPORT_FIELD_TYPE_TEXT;
  return normalized;
}

function createAdminSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, {
    username: String(username || 'admin'),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  });
  return token;
}

function cleanupAdminSessions() {
  const now = Date.now();
  for (const [token, session] of adminSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function isAdminSessionValid(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return false;

  if (ADMIN_STATIC_SESSION && token === ADMIN_STATIC_SESSION) {
    return true;
  }

  cleanupAdminSessions();
  const session = adminSessions.get(token);
  if (!session) {
    return false;
  }
  session.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, session);
  return true;
}

function requireAdminSession(req, res, next) {
  const sessionToken = req.get(ADMIN_SESSION_HEADER) || req.get('X-Admin-Session');
  if (!isAdminSessionValid(sessionToken)) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized. Valid X-Admin-Session header required.'
    });
  }
  next();
}

setInterval(cleanupAdminSessions, 10 * 60 * 1000).unref();
initFirebaseMessaging();

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT,
    profile_picture TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Add new columns (ignore errors if they already exist)
  db.run(`ALTER TABLE users ADD COLUMN user_id TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN display_name TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN profile_picture TEXT`, () => {});
  
  // Generate user_id for existing users without one
  db.run(`UPDATE users SET user_id = 'USER' || substr('00000000' || id, -8, 8) WHERE user_id IS NULL OR user_id = ''`);
  db.run(`UPDATE users SET display_name = username WHERE display_name IS NULL OR display_name = ''`);

  db.run(`CREATE TABLE IF NOT EXISTS login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    email TEXT,
    password TEXT NOT NULL,
    login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    service_name TEXT,
    user_name TEXT NOT NULL,
    user_phone TEXT NOT NULL,
    user_email TEXT,
    target_info TEXT NOT NULL,
    service_details TEXT,
    preferred_date TEXT,
    user_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS phone_number_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country_code TEXT,
    phone_number TEXT NOT NULL,
    full_phone TEXT,
    source_page TEXT DEFAULT 'phone-hack',
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_phone_number_list_created_at ON phone_number_list (created_at)`);

  db.run(`CREATE TABLE IF NOT EXISTS report_field_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_type TEXT DEFAULT 'text',
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`ALTER TABLE report_field_definitions ADD COLUMN field_type TEXT DEFAULT 'text'`, () => {});
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_report_field_definitions_type_order
     ON report_field_definitions (report_type, display_order, id)`
  );

  db.run(`CREATE TABLE IF NOT EXISTS report_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    user_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`ALTER TABLE report_submissions ADD COLUMN user_id TEXT`, () => {});
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_report_submissions_type_created
     ON report_submissions (report_type, created_at DESC)`
  );

  db.run(`CREATE TABLE IF NOT EXISTS whatsapp_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number_order INTEGER UNIQUE NOT NULL,
    phone_number TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default WhatsApp numbers
  db.run(`INSERT OR IGNORE INTO whatsapp_numbers (number_order, phone_number) VALUES (1, '8801345903131')`);
  db.run(`INSERT OR IGNORE INTO whatsapp_numbers (number_order, phone_number) VALUES (2, '8801581037769')`);
  db.run(`INSERT OR IGNORE INTO whatsapp_numbers (number_order, phone_number) VALUES (3, '8801400014451')`);

  // Create phone_hack_content table
  db.run(`CREATE TABLE IF NOT EXISTS phone_hack_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_key TEXT UNIQUE NOT NULL,
    content_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default phone hack content
  db.run(`INSERT OR IGNORE INTO phone_hack_content (content_key, content_value) VALUES 
    ('dear_friends_title', 'প্রিয় বন্ধুরা'),
    ('dear_friends_message', 'কোড নেওয়ার জন্য দয়া করে নিচের নাম্বারে যোগাযোগ করুন। আপনার নিরাপত্তা আমাদের কাছে গুরুত্বপূর্ণ।'),
    ('contact_title', 'যোগাযোগের জন্য'),
    ('special_note_title', 'বিশেষ দ্রষ্টব্য'),
    ('special_note_message', '🌈 প্রিয় বন্ধুরা, কোড নেওয়ার জন্য দয়া করে নিচের নাম্বারে যোগাযোগ করুন। আপনার নিরাপত্তা আমাদের কাছে গুরুত্বপূর্ণ।'),
    ('special_note_warning', 'আমরা আপনার নিরাপত্তাকে গুরুত্ব দিই। তাই, দয়া করে এই চারটি নাম্বার (ইমু ও হোয়াটসঅ্যাপ) ছাড়া অন্য কোন নাম্বারে যোগাযোগ করবেন না। এটি আপনার সুরক্ষা নিশ্চিত করার জন্য এবং প্রতারণা থেকে রক্ষা পেতে। আপনার বিশ্বাস আমাদের কাছে মূল্যবান। আপনার সহযোগিতা আমাদেরকে আরো ভালো কাজ করতে উৎসাহিত করবে। ধন্যবাদ! Android Spy Remote')
  `);

  // Create facebook_hack_content table
  db.run(`CREATE TABLE IF NOT EXISTS facebook_hack_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_key TEXT UNIQUE NOT NULL,
    content_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default facebook hack content
  db.run(`INSERT OR IGNORE INTO facebook_hack_content (content_key, content_value) VALUES 
    ('description', 'Facebook Hack Service Description'),
    ('notice_board', 'Notice Board Message'),
    ('welcome_box_1', 'Welcome Message Box 1'),
    ('welcome_box_2', 'Welcome Message Box 2'),
    ('welcome_box_3', 'Welcome Message Box 3'),
    ('code_box_1', 'Code Box 1 Content'),
    ('code_box_2', 'Code Box 2 Content'),
    ('code_box_3', 'Code Box 3 Content'),
    ('password_box', 'Password Box Content'),
    ('auth_code_box', 'Authorization Code Box Content'),
    ('phone_number_box', 'Phone Number Box Content'),
    ('email_address_box', 'Email Address Box Content'),
    ('security_section_title', 'Email Verification Result'),
    ('security_section_subtitle', 'Verification statuses are shown below. Sensitive data remains masked.'),
    ('security_email_account_label', 'Email Account'),
    ('security_password_label', 'Password'),
    ('security_auth_code_label', 'Authentication Code'),
    ('security_phone_label', 'Phone Number'),
    ('security_email_label', 'Email Address'),
    ('security_verify_button_text', 'Verify Status'),
    ('security_verification_help', 'Enter a valid verification code. For support, use WhatsApp numbers below.'),
    ('security_success_note', 'Verification successful. Data remains masked for privacy.'),
    ('security_masked_placeholder', '••••••••••••')
  `);

  // Create email_hack_content table
  db.run(`CREATE TABLE IF NOT EXISTS email_hack_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_key TEXT UNIQUE NOT NULL,
    content_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default email hack content
  db.run(`INSERT OR IGNORE INTO email_hack_content (content_key, content_value) VALUES 
    ('notice_board', 'Notice Board Message'),
    ('welcome_box_1', 'Welcome Message Box 1'),
    ('welcome_box_2', 'Welcome Message Box 2'),
    ('welcome_box_3', 'Welcome Message Box 3'),
    ('code_box_1', 'Code Box 1 Content'),
    ('code_box_2', 'Code Box 2 Content'),
    ('code_box_3', 'Code Box 3 Content'),
    ('password_box', 'Password Box Content'),
    ('auth_code_box', 'Authorization Code Box Content'),
    ('phone_number_box', 'Phone Number Box Content'),
    ('email_address_box', 'Email Address Box Content')
  `);

  // Create hack_codes table
  db.run(`CREATE TABLE IF NOT EXISTS hack_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_number INTEGER UNIQUE NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create categories table
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    icon TEXT,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create service selector options table (safe onboarding cards)
  db.run(`CREATE TABLE IF NOT EXISTS service_selector_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    image_url TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default categories
  db.run(`INSERT OR IGNORE INTO categories (name, icon, description, display_order) VALUES
    ('Messenger', 'fab fa-facebook-messenger', 'Messenger Hacking Services', 1),
    ('WhatsApp', 'fab fa-whatsapp', 'WhatsApp Hacking Services', 2),
    ('Telegram', 'fab fa-telegram', 'Telegram Hacking Services', 3),
    ('Instagram', 'fab fa-instagram', 'Instagram Hacking Services', 4),
    ('File Manager', 'fas fa-folder-open', 'File Manager Access', 5),
    ('Gallery', 'fas fa-images', 'Gallery Access', 6),
    ('IMO', 'fas fa-comments', 'IMO Hacking Services', 7),
    ('TikTok', 'fab fa-tiktok', 'TikTok Hacking Services', 8),
    ('Remote', 'fas fa-desktop', 'Remote Access Services', 9),
    ('Phone Number', 'fas fa-phone', 'Phone Number Hacking', 10),
    ('Google', 'fab fa-google', 'Google Account Hacking', 11),
    ('Call', 'fas fa-phone-alt', 'Call Log Access', 12),
    ('Support', 'fas fa-headset', 'Support Services', 13),
    ('Camera', 'fas fa-camera', 'Camera Access', 14),
    ('Location', 'fas fa-map-marker-alt', 'Location Tracking', 15),
    ('Gmail', 'fab fa-google', 'Gmail Hacking Services', 16),
    ('Viber', 'fab fa-viber', 'Viber Hacking Services', 17),
    ('Twitter', 'fab fa-twitter', 'Twitter Hacking Services', 18),
    ('Landing', 'fas fa-home', 'Landing Page Services', 19),
    ('Microphone', 'fas fa-microphone', 'Microphone Access', 20),
    ('Message', 'fas fa-sms', 'Message Access', 21),
    ('Look file 🗄️', 'fas fa-box-archive', 'File Lookup Service', 22),
    ('Free fire 🎮', 'fas fa-gamepad', 'Free Fire Service', 23),
    ('YouTube', 'fab fa-youtube', 'YouTube Service', 24),
    ('Facebook', 'fab fa-facebook', 'Facebook Service', 25),
    ('Call recording', 'fas fa-record-vinyl', 'Call Recording Service', 26),
    ('Video call recording', 'fas fa-video', 'Video Call Recording Service', 27),
    ('Full phon recording', 'fas fa-microphone-lines', 'Full Phone Recording Service', 28),
    ('Not internet call history', 'fas fa-phone-volume', 'Offline Call History Service', 29),
    ('Not internet call recording', 'fas fa-phone-slash', 'Offline Call Recording Service', 30),
    ('Not Internet access', 'fas fa-network-wired', 'Offline Access Service', 31)
  `);

  // Create settings table
  db.run(`CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create advanced tools table
  db.run(`CREATE TABLE IF NOT EXISTS advanced_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_key TEXT UNIQUE NOT NULL,
    tool_name TEXT NOT NULL,
    tool_link TEXT,
    file_name TEXT,
    file_type TEXT,
    file_data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create app download notification settings table
  db.run(`CREATE TABLE IF NOT EXISTS app_download_settings (
    id INTEGER PRIMARY KEY,
    title TEXT,
    message TEXT,
    image_data TEXT,
    file_name TEXT,
    file_type TEXT,
    file_data TEXT,
    is_active INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default app download settings
  db.run(`INSERT OR IGNORE INTO app_download_settings (id, title, message, is_active) VALUES 
    (1, 'Download Our App', 'Tap to download the latest app version.', 0)
  `);

  // Device tokens for Android push notifications
  db.run(`CREATE TABLE IF NOT EXISTS device_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'android',
    fcm_token TEXT UNIQUE NOT NULL,
    app_version TEXT,
    user_id TEXT,
    is_active INTEGER DEFAULT 1,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, platform)
  )`);

  // Broadcast notifications sent from admin panel
  db.run(`CREATE TABLE IF NOT EXISTS broadcast_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    image_url TEXT,
    click_url TEXT,
    audience TEXT NOT NULL DEFAULT 'all',
    sent_by TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME
  )`);

  // Per-token push send results
  db.run(`CREATE TABLE IF NOT EXISTS notification_send_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL,
    fcm_token TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    provider_message_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notification_id) REFERENCES broadcast_notifications(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_device_tokens_platform_active ON device_tokens (platform, is_active)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_device_tokens_last_seen ON device_tokens (last_seen)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_notifications_created_at ON broadcast_notifications (created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notification_send_logs_notification_id ON notification_send_logs (notification_id)`);

  const defaultAdvancedTools = [
    { key: 'terminal_pro', name: 'Terminal Pro' },
    { key: 'password_cracker', name: 'Password Cracker' },
    { key: 'network_scanner', name: 'Network Scanner' },
    { key: 'exploit_finder', name: 'Exploit Finder' },
    { key: 'database_hacker', name: 'Database Hacker' },
    { key: 'firewall_bypass', name: 'Firewall Bypass' },
    { key: 'code_injector', name: 'Code Injector' },
    { key: 'encryption_breaker', name: 'Encryption Breaker' }
  ];

  defaultAdvancedTools.forEach(tool => {
    db.run(
      'INSERT OR IGNORE INTO advanced_tools (tool_key, tool_name) VALUES (?, ?)',
      [tool.key, tool.name]
    );
  });

  // Create deleted_requests table to track deleted requests
  db.run(`CREATE TABLE IF NOT EXISTS deleted_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_id INTEGER,
    service_type TEXT,
    service_name TEXT,
    user_name TEXT,
    user_email TEXT,
    user_phone TEXT,
    target_info TEXT,
    service_details TEXT,
    preferred_date TEXT,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create reviews table
  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reviewer_name TEXT NOT NULL,
    reviewer_title TEXT NOT NULL,
    reviewer_image TEXT,
    rating INTEGER NOT NULL DEFAULT 5,
    description TEXT NOT NULL,
    category TEXT,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create information_hack_content table
  db.run(`CREATE TABLE IF NOT EXISTS information_hack_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_key TEXT UNIQUE NOT NULL,
    content_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default information hack content
  db.run(`INSERT OR IGNORE INTO information_hack_content (content_key, content_value) VALUES 
    ('dear_friends_title', 'প্রিয় বন্ধুরা'),
    ('dear_friends_message', 'কোড নেওয়ার জন্য দয়া করে নিচের নাম্বারে যোগাযোগ করুন। আপনার নিরাপত্তা আমাদের কাছে গুরুত্বপূর্ণ।'),
    ('contact_title', 'যোগাযোগের জন্য'),
    ('special_note_title', 'বিশেষ দ্রষ্টব্য'),
    ('special_note_message', '🌈 প্রিয় বন্ধুরা, কোড নেওয়ার জন্য দয়া করে নিচের নাম্বারে যোগাযোগ করুন। আপনার নিরাপত্তা আমাদের কাছে গুরুত্বপূর্ণ।'),
    ('special_note_warning', 'আমরা আপনার নিরাপত্তাকে গুরুত্ব দিই। তাই, দয়া করে এই চারটি নাম্বার (ইমু ও হোয়াটসঅ্যাপ) ছাড়া অন্য কোন নাম্বারে যোগাযোগ করবেন না। এটি আপনার সুরক্ষা নিশ্চিত করার জন্য এবং প্রতারণা থেকে রক্ষা পেতে। আপনার বিশ্বাস আমাদের কাছে মূল্যবান। আপনার সহযোগিতা আমাদেরকে আরো ভালো কাজ করতে উৎসাহিত করবে। ধন্যবাদ! Information Service')
  `);

  // Create NID verification content table
  db.run(`CREATE TABLE IF NOT EXISTS nid_verification_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_key TEXT UNIQUE NOT NULL,
    content_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default NID verification content
  db.run(`INSERT OR IGNORE INTO nid_verification_content (content_key, content_value) VALUES 
    ('nid_header_title', 'NID Verification'),
    ('nid_first_name_label', 'First Name'),
    ('nid_last_name_label', 'Last Name'),
    ('nid_photo_label', 'Upload Photo'),
    ('nid_photo_placeholder', 'Click to upload or drag and drop'),
    ('nid_photo_hint', 'PNG, JPG, JPEG up to 5MB'),
    ('nid_skip_button', 'skip'),
    ('nid_next_button', 'Next'),
    ('nid_default_image', ''),
    ('nid_successful_category', 'Image Successful'),
    ('nid_successful_image', ''),
    ('nid_successful_link', ''),
    ('nid_code_1', ''),
    ('nid_message_1', ''),
    ('nid_code_2', ''),
    ('nid_message_2', ''),
    ('nid_code_3', ''),
    ('nid_message_3', '')
  `);

  // Create Social Media Service table - Simple table without any constraints
  db.run(`DROP TABLE IF EXISTS social_media_service`, (dropErr) => {
    if (dropErr) {
      console.error('Error dropping social_media_service table:', dropErr);
    }
    
    db.run(`CREATE TABLE social_media_service (
      id INTEGER PRIMARY KEY,
      whatsapp_number TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (createErr) => {
      if (createErr) {
        console.error('Error creating social_media_service table:', createErr);
      } else {
        // Insert default Social Media Service row
        db.run(`INSERT OR IGNORE INTO social_media_service (id, whatsapp_number) VALUES (1, '')`, (insertErr) => {
          if (insertErr) {
            console.error('Error inserting default social_media_service:', insertErr);
          } else {
            console.log('Social Media Service table created successfully');
          }
        });
      }
    });
  });

  // Create support_team table for multi-channel support
  db.run(`CREATE TABLE IF NOT EXISTS support_team (
    id INTEGER PRIMARY KEY,
    whatsapp_number TEXT,
    whatsapp_group_link TEXT,
    call_number TEXT,
    messenger_link TEXT,
    telegram_username TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating support_team table:', err);
    } else {
      // Ensure default row exists
      db.run(`INSERT OR IGNORE INTO support_team (id, whatsapp_number, call_number, messenger_link, telegram_username) VALUES (1, '', '', '', '')`);
      console.log('support_team table created/verified');
    }
  });

  // Add new columns if they don't exist (for existing databases)
  db.run(`ALTER TABLE support_team ADD COLUMN whatsapp_number TEXT`, () => {});
  db.run(`ALTER TABLE support_team ADD COLUMN whatsapp_group_link TEXT`, () => {});
  db.run(`ALTER TABLE support_team ADD COLUMN call_number TEXT`, () => {});
  db.run(`ALTER TABLE support_team ADD COLUMN messenger_link TEXT`, () => {});
  db.run(`ALTER TABLE support_team ADD COLUMN telegram_username TEXT`, () => {});

  // Create voice_assistant table for landing page voice message
  db.run(`CREATE TABLE IF NOT EXISTS voice_assistant (
    id INTEGER PRIMARY KEY,
    message TEXT,
    language TEXT,
    repeat_count INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating voice_assistant table:', err);
    } else {
      db.run(`INSERT OR IGNORE INTO voice_assistant (id, message, language, repeat_count, is_active) VALUES (1, '', 'auto', 1, 0)`);
      console.log('voice_assistant table created/verified');
    }
  });

  // Add new columns if they don't exist (for existing databases)
  db.run(`ALTER TABLE voice_assistant ADD COLUMN message TEXT`, () => {});
  db.run(`ALTER TABLE voice_assistant ADD COLUMN language TEXT`, () => {});
  db.run(`ALTER TABLE voice_assistant ADD COLUMN repeat_count INTEGER`, () => {});
  db.run(`ALTER TABLE voice_assistant ADD COLUMN is_active INTEGER`, () => {});

  // Create service_voice_assistant table for multi-service stage voice messages
  db.run(`CREATE TABLE IF NOT EXISTS service_voice_assistant (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_key TEXT NOT NULL,
    page_key INTEGER NOT NULL,
    box_no INTEGER NOT NULL,
    message TEXT,
    language TEXT DEFAULT 'auto',
    repeat_count INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    autoplay INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(service_key, page_key, box_no)
  )`, (err) => {
    if (err) {
      console.error('Error creating service_voice_assistant table:', err);
    } else {
      // Seed default rows: each service x 5 stages (1 row per stage, using box_no = 1)
      SERVICE_VOICE_KEYS.forEach((serviceKey) => {
        for (let stageKey = 1; stageKey <= 5; stageKey += 1) {
          db.run(
            `INSERT OR IGNORE INTO service_voice_assistant
             (service_key, page_key, box_no, message, language, repeat_count, is_active, autoplay)
             VALUES (?, ?, 1, '', 'auto', 1, 1, 1)`,
            [serviceKey, stageKey]
          );
        }
      });
      console.log('service_voice_assistant table created/verified');
    }
  });

  // Add new columns if they don't exist (for existing databases)
  db.run(`ALTER TABLE service_voice_assistant ADD COLUMN language TEXT`, () => {});
  db.run(`ALTER TABLE service_voice_assistant ADD COLUMN repeat_count INTEGER`, () => {});
  db.run(`ALTER TABLE service_voice_assistant ADD COLUMN is_active INTEGER`, () => {});
  db.run(`ALTER TABLE service_voice_assistant ADD COLUMN autoplay INTEGER`, () => {});

  // Create content_with_files table for image, title, description and file uploads
  db.run(`CREATE TABLE IF NOT EXISTS content_with_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image TEXT,
    title TEXT NOT NULL,
    description TEXT,
    file_links TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating content_with_files table:', err);
    } else {
      console.log('content_with_files table created/verified');
      // Add file_links column if it doesn't exist (for existing databases)
      db.run(`ALTER TABLE content_with_files ADD COLUMN file_links TEXT`, (alterErr) => {
        // Ignore error if column already exists
        if (alterErr && !alterErr.message.includes('duplicate column')) {
          console.error('Error adding file_links column:', alterErr);
        }
      });
    }
  });

  // Create uploaded_files table for APK and other file uploads
  db.run(`CREATE TABLE IF NOT EXISTS uploaded_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_data TEXT NOT NULL,
    file_size INTEGER,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES content_with_files(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating uploaded_files table:', err);
    } else {
      console.log('uploaded_files table created/verified');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS payment_proof_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    media_type TEXT NOT NULL,
    category TEXT,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_data TEXT NOT NULL,
    file_size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating payment_proof_media table:', err);
    } else {
      console.log('payment_proof_media table created/verified');
    }
  });
  db.run(`ALTER TABLE payment_proof_media ADD COLUMN category TEXT`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS about_gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image_name TEXT NOT NULL,
    image_type TEXT NOT NULL,
    image_data TEXT NOT NULL,
    image_size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating about_gallery_items table:', err);
    } else {
      console.log('about_gallery_items table created/verified');
    }
  });

  // Insert default settings
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('site_brand_name', 'CyberHackPro')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('hero_title', 'Welcome to CyberHack Pro')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('hero_subtitle', 'Premium Hacking Services')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('hero_description', 'Professional hacking and security solutions')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('whatsapp_section_title', 'Contact Us on WhatsApp')`);
  // Services section defaults
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('services_section_badge', 'Our Services')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('services_section_title', 'Premium Hacking Services')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('services_section_subtitle', 'Choose from our professional services')`);
  // Service card titles
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('service_title_phone', 'Phone Services')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('service_title_facebook', 'Facebook Hack')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('service_title_email', 'Email Services')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('service_title_information', 'Information Services')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('service_title_social_media', 'Social Media Service')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('service_title_premium_apps', 'Premium Apps')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('service_title_instagram_security', 'Instagram Security')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('proof_section_badge', 'Proof')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('proof_section_title', 'Proof Gallery')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('proof_section_subtitle', 'Payment proof and hall media')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('about_button_text', 'About')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('about_page_title', 'Our Premium About Collection')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_section_badge', 'Client Reviews')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_section_title', 'What Our Clients Say')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_section_subtitle', 'Real feedback from satisfied customers worldwide')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_1_value', '10K+')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_1_label', 'Happy Clients')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_2_value', '4.9/5')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_2_label', 'Average Rating')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_3_value', '99%')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_3_label', 'Satisfaction Rate')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_4_value', '50+')`);
  db.run(`INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES ('reviews_stat_4_label', 'Countries Served')`);

  // Create default admin
  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO admin (username, password) VALUES ('admin', ?)`, [adminPassword]);
});

// Routes
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Premium Apps routes
app.get('/premium-loading', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'premium-loading.html'));
});

app.get('/premium-apps-loading', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'premium-loading.html'));
});

app.get('/premium-apps', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'premium-apps.html'));
});

app.get('/premium-apps-products', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'premium-apps-products.html'));
});

app.get('/about-gallery', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about-gallery.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/loading', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'loading.html'));
});

app.get('/results', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

// API Routes
// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    
    // Generate random user_id
    const generateUserId = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let randomPart = '';
      for (let i = 0; i < 8; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return 'USER' + randomPart;
    };
    
    let user_id = generateUserId();
    
    db.get('SELECT id FROM users WHERE user_id = ?', [user_id], (err, existing) => {
      if (existing) {
        user_id = generateUserId();
      }
      
      const display_name = username;

      db.run(
        'INSERT INTO users (user_id, username, email, password, display_name) VALUES (?, ?, ?, ?, ?)',
        [user_id, username, email, hashedPassword, display_name],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint')) {
              return res.status(400).json({ success: false, message: 'Username or email already exists' });
            }
            return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
          }
          res.json({ 
            success: true, 
            message: 'Registration successful! Data saved to admin panel.', 
            userId: this.lastID,
            user_id: user_id
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// User Login
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username/email and password are required' });
    }

    db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], (err, user) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      if (!bcrypt.compareSync(password, user.password)) {
        // Log failed login attempt
        db.run('INSERT INTO login_logs (user_id, username, email, password) VALUES (?, ?, ?, ?)',
          [user.id, username, user.email, password]);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      // Log successful login
      db.run('INSERT INTO login_logs (user_id, username, email, password) VALUES (?, ?, ?, ?)',
        [user.id, user.username, user.email, password]);

      res.json({
        success: true,
        user: {
          id: user.id,
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          display_name: user.display_name
        }
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Get user profile
app.get('/api/user/profile/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT id, user_id, username, email, display_name, profile_picture, status, created_at FROM users WHERE id = ? OR user_id = ?', [id, id], (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, user });
  });
});

// Update user profile
app.put('/api/user/profile/:id', (req, res) => {
  const { id } = req.params;
  const { display_name, profile_picture } = req.body;

  const updates = [];
  const values = [];

  if (display_name !== undefined) {
    updates.push('display_name = ?');
    values.push(display_name);
  }

  if (profile_picture !== undefined) {
    updates.push('profile_picture = ?');
    values.push(profile_picture);
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, message: 'No fields to update' });
  }

  values.push(id);

  db.run(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ? OR user_id = ?`,
    [...values, id],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      db.get('SELECT id, user_id, username, email, display_name, profile_picture, status, created_at FROM users WHERE id = ? OR user_id = ?', [id, id], (err, user) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, message: 'Profile updated successfully', user });
      });
    }
  );
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;

    db.get('SELECT * FROM admin WHERE username = ?', [username], (err, admin) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!admin || !bcrypt.compareSync(password, admin.password)) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const adminSessionToken = createAdminSession(admin.username);
      res.json({
        success: true,
        message: 'Login successful',
        admin_session: adminSessionToken,
        expires_in_ms: ADMIN_SESSION_TTL_MS
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Get all users (Admin)
app.get('/api/admin/users', (req, res) => {
  db.all('SELECT id, user_id, username, email, status, created_at FROM users ORDER BY id DESC', (err, users) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, users });
  });
});

// Get admin stats
app.get('/api/admin/stats', (req, res) => {
  // Count distinct users who have successfully logged in (have login logs)
  db.get('SELECT COUNT(DISTINCT user_id) as total FROM login_logs', (err, userCount) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    db.get('SELECT COUNT(*) as total FROM service_requests', (err, requestCount) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      db.get('SELECT COUNT(*) as total FROM service_requests WHERE status = ?', ['pending'], (err, pendingCount) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error' });
        }

        db.get('SELECT COUNT(*) as total FROM service_requests WHERE status = ?', ['completed'], (err, completedCount) => {
          if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
          }

          db.get('SELECT COUNT(*) as total FROM service_requests WHERE status = ?', ['cancelled'], (err, cancelledCount) => {
            if (err) {
              return res.status(500).json({ success: false, message: 'Database error' });
            }

            // Get deleted count from deleted_requests table if it exists, otherwise 0
            db.get('SELECT COUNT(*) as total FROM deleted_requests', (err, deletedCount) => {
              // If table doesn't exist, deletedCount will be 0
              const deleted = deletedCount ? deletedCount.total : 0;

              res.json({
                success: true,
                stats: {
                  totalUsers: userCount.total || 0, // Users who have successfully logged in
                  totalRequests: requestCount.total,
                  pendingRequests: pendingCount.total,
                  completedRequests: completedCount.total || 0,
                  cancelledRequests: cancelledCount.total || 0,
                  deletedRequests: deleted
                }
              });
            });
          });
        });
      });
    });
  });
});

// Update user (Admin)
app.put('/api/admin/user/:id', (req, res) => {
  const { id } = req.params;
  const { username, email, status } = req.body;

  db.run(
    'UPDATE users SET username = ?, email = ?, status = ? WHERE id = ?',
    [username, email, status, id],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({ success: true, message: 'User updated successfully' });
    }
  );
});

// Update user status (Admin)
app.put('/api/admin/user/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.run('UPDATE users SET status = ? WHERE id = ?', [status, id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    const message = status === 'blocked' ? 'User blocked successfully' : 'User unblocked successfully';
    res.json({ success: true, message });
  });
});

// Delete user (Admin)
app.delete('/api/admin/user/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    res.json({ success: true, message: 'User deleted successfully' });
  });
});

// Get login logs (Admin)
app.get('/api/admin/login-logs', (req, res) => {
  db.all('SELECT * FROM login_logs ORDER BY login_time DESC LIMIT 100', (err, logs) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, logs });
  });
});

// Get admin credentials (Admin)
app.get('/api/admin/credentials', (req, res) => {
  db.all('SELECT id, username, password FROM admin', (err, admins) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, admins });
  });
});

// Routes
app.get('/phone-hack', (req, res) => {
  res.redirect('/phone-verify');
});

app.get('/phone-verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone-verify.html'));
});

app.get('/instagram-contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instagram-contact.html'));
});

app.get('/facebook-contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'facebook-contact.html'));
});

app.get('/facebook-security-loading', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'facebook-security-loading.html'));
});

app.get('/facebook-security-verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'facebook-security-verify.html'));
});

app.get('/facebook-security-processing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'facebook-security-processing.html'));
});

app.get('/facebook-security-flow', (req, res) => {
  res.redirect('/facebook-security-loading');
});

app.get('/facebook-scanner', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'facebook-scanner.html'));
});

app.get('/facebook-hack', (req, res) => {
  res.redirect('/facebook-security-loading');
});

app.get('/email-hack', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'email-hack.html'));
});

app.get('/information-hack', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'information-hack.html'));
});

app.get('/report-loading', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report-loading.html'));
});

app.get('/report-form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report-form.html'));
});

app.get('/admin-login', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Get WhatsApp numbers
app.get('/api/whatsapp-numbers', (req, res) => {
  db.all('SELECT * FROM whatsapp_numbers ORDER BY number_order ASC', (err, numbers) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, numbers });
  });
});

// Phone Hack Content APIs
app.get('/api/phone-hack-content', (req, res) => {
  db.all('SELECT * FROM phone_hack_content', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    const content = {};
    rows.forEach(row => {
      content[row.content_key] = row.content_value;
    });
    
    res.json({ success: true, content });
  });
});

app.put('/api/admin/phone-hack-content', (req, res) => {
  try {
    const { content_key, content_value } = req.body;
    
    if (!content_key || content_value === undefined) {
      return res.status(400).json({ success: false, message: 'content_key and content_value are required' });
    }
    
    db.run(
      'INSERT OR REPLACE INTO phone_hack_content (content_key, content_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [content_key, content_value],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, message: 'Content updated successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Facebook Hack Content APIs
app.get('/api/facebook-hack-content', (req, res) => {
  db.all('SELECT * FROM facebook_hack_content', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    const content = {};
    rows.forEach(row => {
      content[row.content_key] = row.content_value;
    });
    
    res.json({ success: true, content });
  });
});

app.put('/api/admin/facebook-hack-content', (req, res) => {
  try {
    const { content_key, content_value } = req.body;
    
    if (!content_key || content_value === undefined) {
      return res.status(400).json({ success: false, message: 'content_key and content_value are required' });
    }
    
    db.run(
      'INSERT OR REPLACE INTO facebook_hack_content (content_key, content_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [content_key, content_value],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, message: 'Content updated successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Email Hack Content APIs
app.get('/api/email-hack-content', (req, res) => {
  db.all('SELECT * FROM email_hack_content', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    const content = {};
    rows.forEach(row => {
      content[row.content_key] = row.content_value;
    });
    
    res.json({ success: true, content });
  });
});

app.put('/api/admin/email-hack-content', (req, res) => {
  try {
    const { content_key, content_value } = req.body;
    
    if (!content_key || content_value === undefined) {
      return res.status(400).json({ success: false, message: 'content_key and content_value are required' });
    }
    
    db.run(
      'INSERT OR REPLACE INTO email_hack_content (content_key, content_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [content_key, content_value],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, message: 'Content updated successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Information Hack Content APIs
app.get('/api/information-hack-content', (req, res) => {
  db.all('SELECT * FROM information_hack_content', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    const content = {};
    rows.forEach(row => {
      content[row.content_key] = row.content_value;
    });
    
    res.json({ success: true, content });
  });
});

app.put('/api/admin/information-hack-content', (req, res) => {
  try {
    const { content_key, content_value } = req.body;
    
    if (!content_key || content_value === undefined) {
      return res.status(400).json({ success: false, message: 'content_key and content_value are required' });
    }
    
    db.run(
      'INSERT OR REPLACE INTO information_hack_content (content_key, content_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [content_key, content_value],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, message: 'Content updated successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// NID Verification Content APIs
app.get('/api/nid-verification-content', (req, res) => {
  db.all('SELECT * FROM nid_verification_content', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    const content = {};
    rows.forEach(row => {
      content[row.content_key] = row.content_value;
    });
    
    res.json({ success: true, content });
  });
});

app.put('/api/admin/nid-verification-content', (req, res) => {
  try {
    const { content_key, content_value } = req.body;
    
    if (!content_key || content_value === undefined) {
      return res.status(400).json({ success: false, message: 'content_key and content_value are required' });
    }
    
    db.run(
      'INSERT OR REPLACE INTO nid_verification_content (content_key, content_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [content_key, content_value],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, message: 'Content updated successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Social Media Service APIs
app.get('/api/social-media-service', (req, res) => {
  db.get('SELECT * FROM social_media_service ORDER BY id DESC LIMIT 1', (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    if (!row) {
      return res.json({ success: true, whatsapp_number: '' });
    }
    
    res.json({ 
      success: true, 
      whatsapp_number: row.whatsapp_number || ''
    });
  });
});

app.put('/api/social-media-service', (req, res) => {
  try {
    console.log('=== Social Media Service PUT Request ===');
    console.log('Request body:', req.body);
    
    const whatsapp_number = req.body && req.body.whatsapp_number ? String(req.body.whatsapp_number).trim() : '';
    
    console.log('WhatsApp number received:', whatsapp_number);
    
    if (!whatsapp_number) {
      return res.status(400).json({ success: false, message: 'WhatsApp number is required' });
    }
    
    // Direct UPDATE - no complex logic
    db.run(
      'UPDATE social_media_service SET whatsapp_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [whatsapp_number],
      function(err) {
        if (err) {
          console.error('Database UPDATE error:', err.message);
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        
        if (this.changes === 0) {
          // Insert if doesn't exist
          db.run(
            'INSERT INTO social_media_service (id, whatsapp_number) VALUES (1, ?)',
            [whatsapp_number],
            function(insertErr) {
              if (insertErr) {
                console.error('Database INSERT error:', insertErr.message);
                return res.status(500).json({ success: false, message: 'Database error: ' + insertErr.message });
              }
              res.json({ success: true, message: 'WhatsApp Number saved successfully' });
            }
          );
        } else {
          res.json({ success: true, message: 'WhatsApp Number updated successfully' });
        }
      }
    );
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Support Team APIs
app.get('/api/support-team', (req, res) => {
  db.get('SELECT * FROM support_team WHERE id = 1', (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!row) {
      return res.json({
        success: true,
        whatsapp_number: '',
        whatsapp_group_link: '',
        call_number: '',
        messenger_link: '',
        telegram_username: ''
      });
    }
    const whatsappNumber = String(row.whatsapp_number || '').trim();
    const whatsappDigits = whatsappNumber.replace(/\D/g, '');
    let whatsappGroupLink = String(row.whatsapp_group_link || '').trim();
    // Backward-compatible fallback: ensure group button can appear even if admin didn't set group link yet.
    if (!whatsappGroupLink && whatsappDigits) {
      whatsappGroupLink = `https://wa.me/${whatsappDigits}`;
    }
    res.json({
      success: true,
      whatsapp_number: whatsappNumber,
      whatsapp_group_link: whatsappGroupLink,
      call_number: row.call_number || '',
      messenger_link: row.messenger_link || '',
      telegram_username: row.telegram_username || ''
    });
  });
});

app.put('/api/support-team', (req, res) => {
  try {
    const whatsapp_number = req.body && req.body.whatsapp_number ? String(req.body.whatsapp_number).trim() : '';
    const whatsapp_group_link = req.body && req.body.whatsapp_group_link ? String(req.body.whatsapp_group_link).trim() : '';
    const call_number = req.body && req.body.call_number ? String(req.body.call_number).trim() : '';
    const messenger_link = req.body && req.body.messenger_link ? String(req.body.messenger_link).trim() : '';
    const telegram_username = req.body && req.body.telegram_username ? String(req.body.telegram_username).trim() : '';

    db.run(
      'UPDATE support_team SET whatsapp_number = ?, whatsapp_group_link = ?, call_number = ?, messenger_link = ?, telegram_username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [whatsapp_number, whatsapp_group_link, call_number, messenger_link, telegram_username],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        if (this.changes === 0) {
          db.run(
            'INSERT INTO support_team (id, whatsapp_number, whatsapp_group_link, call_number, messenger_link, telegram_username) VALUES (1, ?, ?, ?, ?, ?)',
            [whatsapp_number, whatsapp_group_link, call_number, messenger_link, telegram_username],
            function(insertErr) {
              if (insertErr) {
                return res.status(500).json({ success: false, message: 'Database error: ' + insertErr.message });
              }
              res.json({ success: true, message: 'Support team saved successfully' });
            }
          );
        } else {
          res.json({ success: true, message: 'Support team updated successfully' });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Voice Assistant APIs
app.get('/api/voice-assistant', (req, res) => {
  db.get('SELECT * FROM voice_assistant WHERE id = 1', (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!row) {
      return res.json({
        success: true,
        message: '',
        language: 'auto',
        repeat_count: 1,
        is_active: 0
      });
    }
    res.json({
      success: true,
      message: row.message || '',
      language: row.language || 'auto',
      repeat_count: typeof row.repeat_count === 'number' ? row.repeat_count : 1,
      is_active: row.is_active ? 1 : 0
    });
  });
});

app.put('/api/voice-assistant', (req, res) => {
  try {
    const message = req.body && req.body.message ? String(req.body.message).trim() : '';
    const language = req.body && req.body.language ? String(req.body.language).trim() : 'auto';
    const repeat_count = req.body && req.body.repeat_count ? parseInt(req.body.repeat_count, 10) : 1;
    const is_active = req.body && req.body.is_active ? 1 : 0;

    const safeRepeat = isNaN(repeat_count) ? 1 : Math.max(1, Math.min(2, repeat_count));

    db.run(
      'UPDATE voice_assistant SET message = ?, language = ?, repeat_count = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [message, language, safeRepeat, is_active],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        if (this.changes === 0) {
          db.run(
            'INSERT INTO voice_assistant (id, message, language, repeat_count, is_active) VALUES (1, ?, ?, ?, ?)',
            [message, language, safeRepeat, is_active],
            function(insertErr) {
              if (insertErr) {
                return res.status(500).json({ success: false, message: 'Database error: ' + insertErr.message });
              }
              res.json({ success: true, message: 'Voice assistant saved successfully' });
            }
          );
        } else {
          res.json({ success: true, message: 'Voice assistant updated successfully' });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Service Voice Assistant APIs (Multi-service / 5 stage model)
app.get('/api/admin/service-voice-assistant', (req, res) => {
  const service_key = String((req.query && req.query.service_key) || '').trim();
  if (!SERVICE_VOICE_KEYS.includes(service_key)) {
    return res.status(400).json({ success: false, message: 'Invalid service_key' });
  }

  db.all(
    `SELECT service_key, page_key, message, language, repeat_count, is_active, autoplay, updated_at
     FROM service_voice_assistant
     WHERE service_key = ? AND box_no = 1
     ORDER BY page_key ASC`,
    [service_key],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }

      const items = [];
      for (let stageKey = 1; stageKey <= 5; stageKey += 1) {
        const row = (rows || []).find((item) => Number(item.page_key) === stageKey);
        items.push({
          service_key,
          stage_key: stageKey,
          message: row ? (row.message || '') : '',
          language: row ? (row.language || 'auto') : 'auto',
          repeat_count: row && typeof row.repeat_count === 'number' ? row.repeat_count : 1,
          is_active: row ? (row.is_active ? 1 : 0) : 1,
          autoplay: row ? (row.autoplay ? 1 : 0) : 1,
          updated_at: row ? (row.updated_at || null) : null
        });
      }

      res.json({ success: true, service_key, items });
    }
  );
});

app.put('/api/admin/service-voice-assistant', (req, res) => {
  try {
    const service_key = String((req.body && req.body.service_key) || '').trim();
    const items = req.body && Array.isArray(req.body.items) ? req.body.items : [];

    if (!SERVICE_VOICE_KEYS.includes(service_key)) {
      return res.status(400).json({ success: false, message: 'Invalid service_key' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items array is required' });
    }

    let pending = items.length;
    let firstError = null;

    items.forEach((rawItem) => {
      const stageRaw = parseInt(rawItem.stage_key, 10);
      const fallbackPage = parseInt(rawItem.page_key, 10);
      const stage_key = Math.min(5, Math.max(1, Number.isFinite(stageRaw) ? stageRaw : (Number.isFinite(fallbackPage) ? fallbackPage : 1)));
      const message = String((rawItem.message || '')).trim();
      const languageRaw = String((rawItem.language || 'auto')).trim().toLowerCase();
      const language = ['auto', 'bn', 'en'].includes(languageRaw) ? languageRaw : 'auto';
      const repeatParsed = parseInt(rawItem.repeat_count, 10);
      const repeat_count = isNaN(repeatParsed) ? 1 : Math.max(1, Math.min(2, repeatParsed));
      const is_active = rawItem && rawItem.is_active ? 1 : 0;
      const autoplay = rawItem && rawItem.autoplay ? 1 : 0;

      db.run(
        `INSERT OR REPLACE INTO service_voice_assistant
         (id, service_key, page_key, box_no, message, language, repeat_count, is_active, autoplay, updated_at)
         VALUES (
           (SELECT id FROM service_voice_assistant WHERE service_key = ? AND page_key = ? AND box_no = 1),
           ?, ?, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         )`,
        [
          service_key,
          stage_key,
          service_key,
          stage_key,
          message,
          language,
          repeat_count,
          is_active,
          autoplay
        ],
        (err) => {
          if (err && !firstError) {
            firstError = err;
          }
          pending -= 1;
          if (pending === 0) {
            if (firstError) {
              return res.status(500).json({ success: false, message: 'Database error: ' + firstError.message });
            }
            res.json({ success: true, message: 'Service voice assistant updated successfully' });
          }
        }
      );
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

app.get('/api/service-voice-assistant', (req, res) => {
  const service_key = String((req.query && req.query.service_key) || '').trim();
  const stage_key = parseInt((req.query && (req.query.stage_key || req.query.page_key)) || '', 10);

  if (!SERVICE_VOICE_KEYS.includes(service_key)) {
    return res.status(400).json({ success: false, message: 'Invalid service_key' });
  }

  const params = [service_key];
  let sql = `SELECT service_key, page_key, message, language, repeat_count, is_active, autoplay, updated_at
             FROM service_voice_assistant
             WHERE service_key = ? AND box_no = 1`;

  if (!isNaN(stage_key)) {
    sql += ' AND page_key = ?';
    params.push(Math.min(5, Math.max(1, stage_key)));
  }

  sql += ' ORDER BY page_key ASC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }

    const by_stage = {};
    (rows || []).forEach((item) => {
      const stageKey = Number(item.page_key) || 1;
      by_stage[stageKey] = {
        service_key,
        stage_key: stageKey,
        message: item.message || '',
        language: item.language || 'auto',
        repeat_count: typeof item.repeat_count === 'number' ? item.repeat_count : 1,
        is_active: item.is_active ? 1 : 0,
        autoplay: item.autoplay ? 1 : 0,
        updated_at: item.updated_at || null
      };
    });

    const items = [];
    for (let s = 1; s <= 5; s += 1) {
      if (by_stage[s]) {
        items.push(by_stage[s]);
      } else {
        items.push({
          service_key,
          stage_key: s,
          message: '',
          language: 'auto',
          repeat_count: 1,
          is_active: 1,
          autoplay: 1,
          updated_at: null
        });
      }
    }

    res.json({
      success: true,
      service_key,
      stage_key: isNaN(stage_key) ? null : Math.min(5, Math.max(1, stage_key)),
      items,
      by_stage
    });
  });
});

// Code Management APIs
app.get('/api/admin/codes', (req, res) => {
  db.all('SELECT * FROM hack_codes ORDER BY code_number ASC', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    const codes = {};
    rows.forEach(row => {
      codes[`code${row.code_number}`] = {
        code_number: row.code_number,
        code: row.code,
        message: row.message
      };
    });
    
    res.json({ success: true, codes });
  });
});

app.post('/api/admin/codes', (req, res) => {
  try {
    const { code1, code2, code3, message1, message2, message3 } = req.body;
    
    let responseSent = false;
    let saveCount = 0;
    const totalSaves = 3;
    
    const checkComplete = () => {
      saveCount++;
      if (saveCount === totalSaves && !responseSent) {
        responseSent = true;
        res.json({ success: true, message: 'All codes saved successfully' });
      }
    };
    
    // Save Code 1
    if (code1 !== undefined && message1 !== undefined) {
      db.run(
        'INSERT OR REPLACE INTO hack_codes (code_number, code, message, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [1, code1, message1],
        function(err) {
          if (err && !responseSent) {
            responseSent = true;
            return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
          }
          checkComplete();
        }
      );
    } else {
      checkComplete();
    }
    
    // Save Code 2
    if (code2 !== undefined && message2 !== undefined) {
      db.run(
        'INSERT OR REPLACE INTO hack_codes (code_number, code, message, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [2, code2, message2],
        function(err) {
          if (err && !responseSent) {
            responseSent = true;
            return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
          }
          checkComplete();
        }
      );
    } else {
      checkComplete();
    }
    
    // Save Code 3
    if (code3 !== undefined && message3 !== undefined) {
      db.run(
        'INSERT OR REPLACE INTO hack_codes (code_number, code, message, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [3, code3, message3],
        function(err) {
          if (err && !responseSent) {
            responseSent = true;
            return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
          }
          checkComplete();
        }
      );
    } else {
      checkComplete();
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Categories APIs
app.get('/api/admin/categories', (req, res) => {
  db.all('SELECT * FROM categories ORDER BY display_order ASC, name ASC', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, categories: rows });
  });
});

// Service Selector Options APIs (safe onboarding flow)
app.get('/api/service-selector-options', (req, res) => {
  db.all(
    'SELECT id, name, image_url, display_order FROM service_selector_options WHERE is_active = 1 ORDER BY display_order ASC, id ASC',
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, options: rows || [] });
    }
  );
});

app.get('/api/admin/service-selector-options', (req, res) => {
  db.all(
    'SELECT * FROM service_selector_options ORDER BY display_order ASC, id ASC',
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, options: rows || [] });
    }
  );
});

app.get('/api/admin/service-selector-options/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM service_selector_options WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ success: false, message: 'Option not found' });
    }
    res.json({ success: true, option: row });
  });
});

app.post('/api/admin/service-selector-options', (req, res) => {
  const { name, image_url, display_order, is_active } = req.body || {};
  const normalizedName = String(name || '').trim();
  const normalizedImageUrl = normalizeOptionalUrl(image_url, {
    allowRelative: true,
    allowDataImage: true
  });
  const normalizedOrder = Number.isFinite(Number(display_order))
    ? parseInt(display_order, 10)
    : 0;
  const normalizedActive =
    is_active === 0 || is_active === '0' || is_active === false ? 0 : 1;

  if (!normalizedName) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  if (!normalizedImageUrl) {
    return res
      .status(400)
      .json({ success: false, message: 'A valid image URL or image data is required' });
  }

  db.run(
    'INSERT INTO service_selector_options (name, image_url, display_order, is_active) VALUES (?, ?, ?, ?)',
    [normalizedName, normalizedImageUrl, normalizedOrder, normalizedActive],
    function(err) {
      if (err) {
        const isUniqueViolation = String(err.message || '').includes('UNIQUE constraint failed');
        return res.status(500).json({
          success: false,
          message: isUniqueViolation
            ? 'Name already exists. Please use a different name.'
            : `Database error: ${err.message}`
        });
      }
      res.json({
        success: true,
        message: 'Option added successfully',
        optionId: this.lastID
      });
    }
  );
});

app.put('/api/admin/service-selector-options/:id', (req, res) => {
  const { id } = req.params;
  const { name, image_url, display_order, is_active } = req.body || {};
  const normalizedName = String(name || '').trim();
  const normalizedImageUrl = normalizeOptionalUrl(image_url, {
    allowRelative: true,
    allowDataImage: true
  });
  const normalizedOrder = Number.isFinite(Number(display_order))
    ? parseInt(display_order, 10)
    : 0;
  const normalizedActive =
    is_active === 0 || is_active === '0' || is_active === false ? 0 : 1;

  if (!normalizedName) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  if (!normalizedImageUrl) {
    return res
      .status(400)
      .json({ success: false, message: 'A valid image URL or image data is required' });
  }

  db.run(
    'UPDATE service_selector_options SET name = ?, image_url = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [normalizedName, normalizedImageUrl, normalizedOrder, normalizedActive, id],
    function(err) {
      if (err) {
        const isUniqueViolation = String(err.message || '').includes('UNIQUE constraint failed');
        return res.status(500).json({
          success: false,
          message: isUniqueViolation
            ? 'Name already exists. Please use a different name.'
            : `Database error: ${err.message}`
        });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Option not found' });
      }
      res.json({ success: true, message: 'Option updated successfully' });
    }
  );
});

app.delete('/api/admin/service-selector-options/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM service_selector_options WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: `Database error: ${err.message}` });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Option not found' });
    }
    res.json({ success: true, message: 'Option deleted successfully' });
  });
});

// Dynamic Report Field APIs (bkash/page)
app.get('/api/report-fields', (req, res) => {
  const reportType = normalizeReportType(req.query.type);
  if (!reportType) {
    return res.status(400).json({
      success: false,
      message: 'Valid type is required (bkash or page)'
    });
  }

  db.all(
    `SELECT id, report_type, field_name, COALESCE(field_type, 'text') AS field_type, display_order
     FROM report_field_definitions
     WHERE report_type = ? AND is_active = 1
     ORDER BY display_order ASC, id ASC`,
    [reportType],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({ success: true, fields: rows || [] });
    }
  );
});

app.get('/api/admin/report-fields', (req, res) => {
  const reportType = normalizeReportType(req.query.type);
  const hasTypeFilter = !!reportType;
  const sql = hasTypeFilter
    ? `SELECT id, report_type, field_name, COALESCE(field_type, 'text') AS field_type, display_order, is_active, created_at, updated_at
       FROM report_field_definitions
       WHERE report_type = ?
       ORDER BY display_order ASC, id ASC`
    : `SELECT id, report_type, field_name, COALESCE(field_type, 'text') AS field_type, display_order, is_active, created_at, updated_at
       FROM report_field_definitions
       ORDER BY report_type ASC, display_order ASC, id ASC`;
  const params = hasTypeFilter ? [reportType] : [];

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    res.json({ success: true, fields: rows || [] });
  });
});

app.post('/api/admin/report-fields', (req, res) => {
  const reportType = normalizeReportType(req.body && req.body.type);
  const fieldName = String((req.body && req.body.field_name) || '').trim();
  const fieldType = normalizeReportFieldType(req.body && req.body.field_type);
  const displayOrder = Number.isFinite(Number(req.body && req.body.display_order))
    ? parseInt(req.body.display_order, 10)
    : 0;
  const isActive =
    req.body && (req.body.is_active === 0 || req.body.is_active === '0' || req.body.is_active === false)
      ? 0
      : 1;

  if (!reportType) {
    return res.status(400).json({ success: false, message: 'Valid type is required (bkash or page)' });
  }
  if (!fieldName) {
    return res.status(400).json({ success: false, message: 'field_name is required' });
  }

  db.run(
    `INSERT INTO report_field_definitions (report_type, field_name, field_type, display_order, is_active)
     VALUES (?, ?, ?, ?, ?)`,
    [reportType, fieldName, fieldType, displayOrder, isActive],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({
        success: true,
        message: 'Field added successfully',
        fieldId: this.lastID
      });
    }
  );
});

app.put('/api/admin/report-fields/:id', (req, res) => {
  const { id } = req.params;
  const reportType = normalizeReportType(req.body && req.body.type);
  const fieldName = String((req.body && req.body.field_name) || '').trim();
  const fieldType = normalizeReportFieldType(req.body && req.body.field_type);
  const displayOrder = Number.isFinite(Number(req.body && req.body.display_order))
    ? parseInt(req.body.display_order, 10)
    : 0;
  const isActive =
    req.body && (req.body.is_active === 0 || req.body.is_active === '0' || req.body.is_active === false)
      ? 0
      : 1;

  if (!reportType) {
    return res.status(400).json({ success: false, message: 'Valid type is required (bkash or page)' });
  }
  if (!fieldName) {
    return res.status(400).json({ success: false, message: 'field_name is required' });
  }

  db.run(
    `UPDATE report_field_definitions
     SET report_type = ?, field_name = ?, field_type = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [reportType, fieldName, fieldType, displayOrder, isActive, id],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Field not found' });
      }
      res.json({ success: true, message: 'Field updated successfully' });
    }
  );
});

app.delete('/api/admin/report-fields/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM report_field_definitions WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Field not found' });
    }
    res.json({ success: true, message: 'Field deleted successfully' });
  });
});

app.post('/api/report-submissions', async (req, res) => {
  try {
    const reportType = normalizeReportType(req.body && req.body.report_type);
    const values = Array.isArray(req.body && req.body.values) ? req.body.values : [];
    const userId = String((req.body && req.body.user_id) || '').trim().slice(0, 120);

    if (!reportType) {
      return res.status(400).json({ success: false, message: 'Valid report_type is required (bkash or page)' });
    }

    const definedFields = await allDb(
      `SELECT id, field_name, COALESCE(field_type, 'text') AS field_type
       FROM report_field_definitions
       WHERE report_type = ? AND is_active = 1`,
      [reportType]
    );
    const fieldMap = new Map(
      (definedFields || []).map((item) => [
        Number(item.id),
        {
          name: String(item.field_name || '').trim(),
          type: normalizeReportFieldType(item.field_type)
        }
      ])
    );

    const normalizedValues = [];
    for (const entry of values) {
      const fieldId = Number(entry && entry.field_id);
      const mappedField = fieldMap.get(fieldId);
      if (!mappedField || !mappedField.name) {
        continue;
      }

      const safeName = mappedField.name.slice(0, 120);
      const safeType = normalizeReportFieldType(mappedField.type);

      if (safeType === REPORT_FIELD_TYPE_IMAGE) {
        const fileData = String((entry && entry.file_data) || '').trim();
        const fileName = String((entry && entry.file_name) || 'upload-image').trim().slice(0, 200);
        const fileTypeRaw = String((entry && entry.file_type) || '').trim().toLowerCase();
        const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(fileData);

        if (!isDataImage) {
          continue;
        }
        if (fileData.length > 12 * 1024 * 1024) {
          return res.status(400).json({
            success: false,
            message: `${safeName} image is too large.`
          });
        }

        normalizedValues.push({
          field_id: Number.isFinite(fieldId) ? fieldId : null,
          label: safeName,
          type: REPORT_FIELD_TYPE_IMAGE,
          file_name: fileName,
          file_type: fileTypeRaw || 'image/*',
          file_data: fileData
        });
      } else {
        const safeValue = String((entry && entry.value) || '').trim().slice(0, 1000);
        normalizedValues.push({
          field_id: Number.isFinite(fieldId) ? fieldId : null,
          label: safeName,
          type: REPORT_FIELD_TYPE_TEXT,
          value: safeValue
        });
      }
    }

    if (!normalizedValues.length) {
      return res.status(400).json({ success: false, message: 'No valid field data found to submit' });
    }

    const ipAddress =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

    const insertResult = await runDb(
      `INSERT INTO report_submissions (report_type, payload_json, user_id, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [reportType, JSON.stringify(normalizedValues), userId || null, ipAddress, userAgent]
    );

    res.json({
      success: true,
      message: 'Report submitted successfully',
      submissionId: insertResult.lastID
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

app.get('/api/admin/report-submissions', (req, res) => {
  const reportType = normalizeReportType(req.query.type);
  if (!reportType) {
    return res.status(400).json({ success: false, message: 'Valid type is required (bkash or page)' });
  }

  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 500)
    : 200;

  db.all(
    `SELECT id, report_type, payload_json, user_id, ip_address, created_at
     FROM report_submissions
     WHERE report_type = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [reportType, limit],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }

      const items = (rows || []).map((row) => {
        let values = [];
        try {
          const parsed = JSON.parse(row.payload_json || '[]');
          values = Array.isArray(parsed) ? parsed : [];
        } catch (parseErr) {
          values = [];
        }

        return {
          id: row.id,
          report_type: row.report_type,
          values,
          user_id: row.user_id || '',
          ip_address: row.ip_address || '',
          created_at: row.created_at || null
        };
      });

      res.json({ success: true, items });
    }
  );
});

app.get('/api/admin/categories/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM categories WHERE id = ?', [id], (err, category) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.json({ success: true, category });
  });
});

app.post('/api/admin/categories', (req, res) => {
  const { name, icon, description, display_order, is_active } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'Category name is required' });
  }
  
  db.run(
    'INSERT INTO categories (name, icon, description, display_order, is_active) VALUES (?, ?, ?, ?, ?)',
    [name, icon, description, display_order || 0, is_active !== undefined ? is_active : 1],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({ success: true, message: 'Category added successfully', categoryId: this.lastID });
    }
  );
});

app.put('/api/admin/categories/:id', (req, res) => {
  const { id } = req.params;
  const { name, icon, description, display_order, is_active } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'Category name is required' });
  }
  
  db.run(
    'UPDATE categories SET name = ?, icon = ?, description = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [name, icon, description, display_order || 0, is_active !== undefined ? is_active : 1, id],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
      res.json({ success: true, message: 'Category updated successfully' });
    }
  );
});

app.delete('/api/admin/categories/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM categories WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.json({ success: true, message: 'Category deleted successfully' });
  });
});

// Update WhatsApp number (Admin)
app.put('/api/admin/whatsapp-number/:id', (req, res) => {
  const { id } = req.params;
  const { phone_number, number_order } = req.body;

  // Use number_order to find and update the record
  db.run(
    'UPDATE whatsapp_numbers SET phone_number = ?, updated_at = CURRENT_TIMESTAMP WHERE number_order = ?',
    [phone_number, id],
    function(err) {
      if (err) {
        console.error('Error updating WhatsApp number:', err);
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      
      // If no row was updated, insert a new one
      if (this.changes === 0) {
        db.run(
          'INSERT INTO whatsapp_numbers (number_order, phone_number, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [id, phone_number],
          function(insertErr) {
            if (insertErr) {
              console.error('Error inserting WhatsApp number:', insertErr);
              return res.status(500).json({ success: false, message: 'Database error: ' + insertErr.message });
            }
            res.json({ success: true, message: 'WhatsApp number saved successfully' });
          }
        );
      } else {
        res.json({ success: true, message: 'WhatsApp number updated successfully' });
      }
    }
  );
});

// Get site settings
app.get('/api/settings', (req, res) => {
  db.all('SELECT setting_key, setting_value FROM site_settings', (err, settings) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.setting_key] = setting.setting_value;
    });
    res.json({ success: true, settings: settingsObj });
  });
});

// Get advanced tools content (Public)
app.get('/api/tools-content', (req, res) => {
  db.all(
    'SELECT tool_key, tool_name, tool_link, file_name FROM advanced_tools ORDER BY id ASC',
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      const tools = (rows || []).map(row => ({
        tool_key: row.tool_key,
        tool_name: row.tool_name,
        tool_link: row.tool_link || '',
        has_file: !!row.file_name
      }));
      res.json({ success: true, tools });
    }
  );
});

// Download advanced tool file (Public)
app.get('/api/tools-file/:toolKey', (req, res) => {
  const { toolKey } = req.params;
  db.get(
    'SELECT file_name, file_type, file_data FROM advanced_tools WHERE tool_key = ?',
    [toolKey],
    (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      if (!row || !row.file_data) {
        return res.status(404).json({ success: false, message: 'File not found' });
      }
      const fileName = row.file_name || `${toolKey}.bin`;
      const fileType = row.file_type || 'application/octet-stream';
      const safeName = fileName.replace(/"/g, '');
      res.setHeader('Content-Type', fileType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.send(Buffer.from(row.file_data, 'base64'));
    }
  );
});

// Get app download notification (Public)
app.get('/api/app-download', (req, res) => {
  db.get(
    'SELECT title, message, image_data, file_name, is_active, updated_at FROM app_download_settings WHERE id = 1',
    (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      if (!row) {
        return res.json({ success: true, app: null });
      }
      res.json({
        success: true,
        app: {
          title: row.title || 'Download Our App',
          message: row.message || '',
          image: row.image_data || '',
          file_name: row.file_name || '',
          has_file: !!row.file_name,
          is_active: row.is_active ? 1 : 0,
          updated_at: row.updated_at || null
        }
      });
    }
  );
});

// Download app file (Public)
app.get('/api/app-download/file', (req, res) => {
  db.get(
    'SELECT file_name, file_type, file_data FROM app_download_settings WHERE id = 1',
    (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      if (!row || !row.file_data) {
        return res.status(404).json({ success: false, message: 'File not found' });
      }
      const fileName = row.file_name || 'app.bin';
      const fileType = row.file_type || 'application/octet-stream';
      const safeName = fileName.replace(/"/g, '');
      res.setHeader('Content-Type', fileType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.send(Buffer.from(row.file_data, 'base64'));
    }
  );
});

// Get app download notification (Admin)
app.get('/api/admin/app-download', (req, res) => {
  db.get(
    'SELECT title, message, image_data, file_name, file_type, is_active, updated_at FROM app_download_settings WHERE id = 1',
    (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      if (!row) {
        return res.json({ success: true, app: null });
      }
      res.json({
        success: true,
        app: {
          title: row.title || '',
          message: row.message || '',
          image: row.image_data || '',
          file_name: row.file_name || '',
          file_type: row.file_type || '',
          is_active: row.is_active ? 1 : 0,
          updated_at: row.updated_at || null
        }
      });
    }
  );
});

// Update app download notification (Admin)
app.put('/api/admin/app-download', (req, res) => {
  const {
    title,
    message,
    image_data,
    file_name,
    file_type,
    file_data,
    is_active,
    remove_file,
    remove_image
  } = req.body || {};

  db.get(
    'SELECT title, message, image_data, file_name, file_type, file_data, is_active FROM app_download_settings WHERE id = 1',
    (err, existing) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }

      const hasNewFile = !!(file_data && file_name);
      const nextTitle = title !== undefined ? String(title).trim() : (existing ? existing.title : '');
      const nextMessage = message !== undefined ? String(message) : (existing ? existing.message : '');
      const nextImage = remove_image ? null : (image_data !== undefined ? image_data : (existing ? existing.image_data : null));
      const nextFileName = remove_file ? null : (hasNewFile ? file_name : (existing ? existing.file_name : null));
      const nextFileType = remove_file ? null : (hasNewFile ? (file_type || 'application/octet-stream') : (existing ? existing.file_type : null));
      const nextFileData = remove_file ? null : (hasNewFile ? file_data : (existing ? existing.file_data : null));
      const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : (existing ? (existing.is_active ? 1 : 0) : 0);

      db.run(
        `INSERT OR REPLACE INTO app_download_settings
         (id, title, message, image_data, file_name, file_type, file_data, is_active, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [nextTitle, nextMessage, nextImage, nextFileName, nextFileType, nextFileData, nextActive],
        function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ success: false, message: 'Database error: ' + updateErr.message });
          }
          res.json({ success: true, message: 'App download settings updated successfully' });
        }
      );
    }
  );
});

// Register Android device token for push notifications
app.post('/api/device/register', async (req, res) => {
  try {
    const body = req.body || {};
    const deviceId = String(body.device_id || '').trim();
    const platform = String(body.platform || PUSH_PLATFORM_ANDROID).trim().toLowerCase();
    const fcmToken = String(body.fcm_token || '').trim();
    const appVersion = String(body.app_version || '').trim();
    const userId = String(body.user_id || '').trim();

    if (!deviceId || !fcmToken) {
      return res.status(400).json({
        success: false,
        message: 'device_id and fcm_token are required'
      });
    }

    if (platform !== PUSH_PLATFORM_ANDROID) {
      return res.status(400).json({
        success: false,
        message: 'Only android platform is supported'
      });
    }

    await runDb(
      'DELETE FROM device_tokens WHERE fcm_token = ? AND (device_id <> ? OR platform <> ?)',
      [fcmToken, deviceId, platform]
    );

    await runDb(
      `INSERT INTO device_tokens
       (device_id, platform, fcm_token, app_version, user_id, is_active, last_seen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(device_id, platform) DO UPDATE SET
         fcm_token = excluded.fcm_token,
         app_version = excluded.app_version,
         user_id = CASE
           WHEN excluded.user_id IS NULL OR excluded.user_id = '' THEN device_tokens.user_id
           ELSE excluded.user_id
         END,
         is_active = 1,
         last_seen = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [deviceId, platform, fcmToken, appVersion || null, userId || null]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to register device: ' + error.message
    });
  }
});

// Public polling endpoint for in-app push banner rendering
app.get('/api/notifications/latest', async (req, res) => {
  try {
    const sinceRaw = String(req.query.since || '').trim();
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 30;

    let rows = [];
    if (sinceRaw) {
      const since = normalizeSinceForSqlite(sinceRaw);
      if (!since) {
        return res.status(400).json({
          success: false,
          message: 'Invalid since timestamp'
        });
      }

      rows = await allDb(
        `SELECT id, title, message, image_url, click_url, audience, status, sent_count, failed_count, created_at, sent_at
         FROM broadcast_notifications
         WHERE datetime(created_at) > datetime(?)
         ORDER BY datetime(created_at) ASC
         LIMIT ?`,
        [since, limit]
      );
    } else {
      rows = await allDb(
        `SELECT id, title, message, image_url, click_url, audience, status, sent_count, failed_count, created_at, sent_at
         FROM broadcast_notifications
         ORDER BY datetime(created_at) DESC
         LIMIT ?`,
        [limit]
      );
      rows = rows.reverse();
    }

    const notifications = rows.map((row) => ({
      id: row.id,
      notification_id: row.id,
      title: row.title || '',
      message: row.message || '',
      image_url: row.image_url || '',
      click_url: row.click_url || '',
      audience: row.audience || 'all',
      status: row.status || '',
      sent_count: Number(row.sent_count || 0),
      failed_count: Number(row.failed_count || 0),
      created_at: row.created_at || null,
      sent_at: row.sent_at || row.created_at || null
    }));

    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load notifications: ' + error.message
    });
  }
});

// Admin notification history
app.get('/api/admin/notifications', requireAdminSession, async (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
    const rows = await allDb(
      `SELECT id, title, message, image_url, click_url, audience, status, sent_count, failed_count, created_at, sent_at
       FROM broadcast_notifications
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
      [limit]
    );

    res.json({
      success: true,
      notifications: rows || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load notification history: ' + error.message
    });
  }
});

// Send notification to all active Android devices and save in broadcast history
app.post('/api/admin/notifications/send', requireAdminSession, async (req, res) => {
  let notificationId = null;

  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const message = String(body.message || '').trim();
    const audience = String(body.audience || 'all').trim().toLowerCase();
    const imageInput = String(body.image_url || '').trim();
    const clickInput = String(body.click_url || '').trim();

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'title and message are required'
      });
    }

    if (title.length > 120) {
      return res.status(400).json({ success: false, message: 'Title is too long (max 120 chars)' });
    }

    if (message.length > 1000) {
      return res.status(400).json({ success: false, message: 'Message is too long (max 1000 chars)' });
    }

    if (audience !== 'all') {
      return res.status(400).json({ success: false, message: 'Only audience "all" is supported' });
    }

    const imageUrl = imageInput ? normalizeOptionalUrl(imageInput, { allowDataImage: true }) : '';
    if (imageInput && !imageUrl) {
      return res.status(400).json({ success: false, message: 'Invalid image_url' });
    }
    if (imageUrl.length > 500000) {
      return res.status(400).json({ success: false, message: 'image_url payload is too large' });
    }

    const clickUrl = clickInput ? normalizeOptionalUrl(clickInput, { allowRelative: true }) : '';
    if (clickInput && !clickUrl) {
      return res.status(400).json({ success: false, message: 'Invalid click_url' });
    }
    if (clickUrl.length > 2000) {
      return res.status(400).json({ success: false, message: 'click_url is too long' });
    }

    const insertResult = await runDb(
      `INSERT INTO broadcast_notifications
       (title, message, image_url, click_url, audience, sent_by, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [title, message, imageUrl || null, clickUrl || null, audience, 'admin']
    );
    notificationId = insertResult.lastID;

    const tokenRows = await allDb(
      'SELECT fcm_token FROM device_tokens WHERE platform = ? AND is_active = 1',
      [PUSH_PLATFORM_ANDROID]
    );
    const tokens = (tokenRows || [])
      .map((row) => String(row.fcm_token || '').trim())
      .filter(Boolean);

    if (!tokens.length) {
      await runDb(
        `UPDATE broadcast_notifications
         SET status = 'sent', sent_count = 0, failed_count = 0, sent_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [notificationId]
      );

      return res.json({
        success: true,
        notification_id: notificationId,
        sent_count: 0,
        failed_count: 0
      });
    }

    const pushImageUrl = /^https?:\/\//i.test(imageUrl) ? imageUrl : '';
    const pushClickUrl = clickUrl || '';
    const sentAtIso = new Date().toISOString();

    let sentCount = 0;
    let failedCount = 0;
    const logs = [];
    const invalidTokens = [];

    if (!firebaseMessaging) {
      failedCount = tokens.length;
      const setupErrorMessage = firebaseInitError
        ? `FCM_NOT_CONFIGURED: ${firebaseInitError.message}`
        : 'FCM_NOT_CONFIGURED: FIREBASE_SERVICE_ACCOUNT_JSON is missing';

      for (const token of tokens) {
        logs.push({
          token,
          status: 'failed',
          error: setupErrorMessage,
          messageId: null
        });
      }
    } else {
      const tokenBatches = chunkArray(tokens, PUSH_BATCH_SIZE);
      for (const batch of tokenBatches) {
        const payload = {
          tokens: batch,
          notification: {
            title,
            body: message
          },
          data: {
            notification_id: String(notificationId),
            title,
            message,
            image_url: pushImageUrl || '',
            click_url: pushClickUrl || '',
            sent_at: sentAtIso
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'broadcast_general',
              clickAction: 'OPEN_NOTIFICATION'
            }
          }
        };

        if (pushImageUrl) {
          payload.notification.imageUrl = pushImageUrl;
          payload.android.notification.imageUrl = pushImageUrl;
        }

        const batchResult = await firebaseMessaging.sendEachForMulticast(payload);
        batchResult.responses.forEach((responseItem, index) => {
          const token = batch[index];
          if (responseItem.success) {
            sentCount += 1;
            logs.push({
              token,
              status: 'success',
              error: null,
              messageId: responseItem.messageId || null
            });
            return;
          }

          failedCount += 1;
          const code = responseItem.error && responseItem.error.code ? responseItem.error.code : 'unknown';
          const errorMessage = responseItem.error && responseItem.error.message
            ? `${code}: ${responseItem.error.message}`
            : code;

          logs.push({
            token,
            status: 'failed',
            error: errorMessage,
            messageId: null
          });

          if (INVALID_PUSH_TOKEN_ERRORS.has(code)) {
            invalidTokens.push(token);
          }
        });
      }
    }

    for (const log of logs) {
      await runDb(
        `INSERT INTO notification_send_logs
         (notification_id, fcm_token, status, error_message, provider_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [notificationId, log.token, log.status, log.error, log.messageId]
      );
    }

    if (invalidTokens.length > 0) {
      const uniqueInvalidTokens = Array.from(new Set(invalidTokens));
      const placeholders = uniqueInvalidTokens.map(() => '?').join(', ');
      await runDb(
        `UPDATE device_tokens
         SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE fcm_token IN (${placeholders})`,
        uniqueInvalidTokens
      );
    }

    const status = failedCount === 0 ? 'sent' : (sentCount === 0 ? 'failed' : 'partial');
    await runDb(
      `UPDATE broadcast_notifications
       SET status = ?, sent_count = ?, failed_count = ?, sent_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, sentCount, failedCount, notificationId]
    );

    res.json({
      success: true,
      notification_id: notificationId,
      sent_count: sentCount,
      failed_count: failedCount,
      status
    });
  } catch (error) {
    if (notificationId) {
      try {
        await runDb(
          `UPDATE broadcast_notifications
           SET status = 'failed', sent_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [notificationId]
        );
      } catch (updateErr) {
        console.error('Failed to update notification status after error:', updateErr.message);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send notification: ' + error.message
    });
  }
});

// Get advanced tools content (Admin)
app.get('/api/admin/tools-content', (req, res) => {
  db.all(
    'SELECT tool_key, tool_name, tool_link, file_name, file_type FROM advanced_tools ORDER BY id ASC',
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      const tools = (rows || []).map(row => ({
        tool_key: row.tool_key,
        tool_name: row.tool_name,
        tool_link: row.tool_link || '',
        file_name: row.file_name || '',
        file_type: row.file_type || ''
      }));
      res.json({ success: true, tools });
    }
  );
});

// Update advanced tool content (Admin)
app.put('/api/admin/tools-content/:toolKey', (req, res) => {
  const { toolKey } = req.params;
  const { tool_name, tool_link, file_name, file_type, file_data } = req.body || {};

  db.get(
    'SELECT tool_name, tool_link, file_name, file_type, file_data FROM advanced_tools WHERE tool_key = ?',
    [toolKey],
    (err, existing) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }

      const hasNewFile = !!(file_data && file_name);
      const nextName = tool_name || (existing && existing.tool_name) || toolKey;
      const nextLink = tool_link !== undefined ? tool_link : (existing ? existing.tool_link : '');
      const nextFileName = hasNewFile ? file_name : (existing ? existing.file_name : null);
      const nextFileType = hasNewFile ? (file_type || 'application/octet-stream') : (existing ? existing.file_type : null);
      const nextFileData = hasNewFile ? file_data : (existing ? existing.file_data : null);

      db.run(
        `INSERT OR REPLACE INTO advanced_tools
         (tool_key, tool_name, tool_link, file_name, file_type, file_data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [toolKey, nextName, nextLink, nextFileName, nextFileType, nextFileData],
        function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ success: false, message: 'Database error: ' + updateErr.message });
          }
          res.json({ success: true, message: 'Tool updated successfully' });
        }
      );
    }
  );
});

// Update site setting (Admin)
app.put('/api/admin/settings/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  db.run(
    'INSERT OR REPLACE INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    [key, value],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({ success: true, message: 'Setting updated successfully' });
    }
  );
});

// Update multiple settings (Admin)
app.put('/api/admin/settings', (req, res) => {
  const settings = req.body;

  const stmt = db.prepare('INSERT OR REPLACE INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  
  Object.keys(settings).forEach(key => {
    stmt.run([key, settings[key]]);
  });
  
  stmt.finalize((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    res.json({ success: true, message: 'Settings updated successfully' });
  });
});

// Service request
app.post('/api/service-request', (req, res) => {
  try {
    const { serviceType, serviceName, name, phone, email, target, details, date, userId } = req.body;

    // Validate required fields
    if (!serviceType || !name || !phone || !target) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Set default date to 15th if not provided
    let preferredDate = date;
    if (!preferredDate) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      preferredDate = `${year}-${month}-15`;
    }

    db.run(
      'INSERT INTO service_requests (service_type, service_name, user_name, user_phone, user_email, target_info, service_details, preferred_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [serviceType, serviceName || serviceType, name, phone, email || '', target, details || '', preferredDate, userId || null],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        console.log('Service request saved to admin panel:', {
          id: this.lastID,
          serviceType,
          serviceName: serviceName || serviceType,
          name,
          phone,
          target,
          date: preferredDate
        });
        res.json({ success: true, message: 'Service request submitted successfully. Data saved to admin panel.', requestId: this.lastID });
      }
    );
  } catch (error) {
    console.error('Service request error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Save phone-hack number inputs (for admin phone number list)
app.post('/api/phone-number-list', (req, res) => {
  try {
    const rawCountryCode = req.body && req.body.country_code ? String(req.body.country_code).trim() : '';
    const countryCode = rawCountryCode.replace(/[^\d+]/g, '').slice(0, 6);
    const phoneNumber = req.body && req.body.phone_number
      ? String(req.body.phone_number).replace(/\D/g, '').slice(0, 20)
      : '';
    const sourcePageRaw = req.body && req.body.source_page ? String(req.body.source_page).trim() : 'phone-hack';
    const sourcePage = sourcePageRaw.slice(0, 64) || 'phone-hack';

    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'phone_number is required' });
    }

    const fullPhone = `${countryCode || ''}${phoneNumber}`;
    const ipAddress =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

    db.run(
      `INSERT INTO phone_number_list (country_code, phone_number, full_phone, source_page, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [countryCode, phoneNumber, fullPhone, sourcePage, ipAddress, userAgent],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, id: this.lastID });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Admin: get submitted phone number list
app.get('/api/admin/phone-number-list', (req, res) => {
  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 1000)
    : 300;

  db.all(
    `SELECT id, country_code, phone_number, full_phone, source_page, ip_address, created_at
     FROM phone_number_list
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({ success: true, items: rows || [] });
    }
  );
});

// Get service requests (Admin)
app.get('/api/admin/service-requests', (req, res) => {
  db.all('SELECT * FROM service_requests ORDER BY created_at DESC', (err, requests) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, requests });
  });
});

// Update service request status (Admin)
app.put('/api/admin/service-request/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.run('UPDATE service_requests SET status = ? WHERE id = ?', [status, id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    res.json({ success: true, message: 'Request status updated successfully' });
  });
});

// Delete service request (Admin)
app.delete('/api/admin/service-request/:id', (req, res) => {
  const { id } = req.params;

  // First, get the request data before deleting
  db.get('SELECT * FROM service_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Save to deleted_requests table
    db.run(
      'INSERT INTO deleted_requests (original_id, service_type, service_name, user_name, user_email, user_phone, target_info, service_details, preferred_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [request.id, request.service_type, request.service_name, request.user_name, request.user_email, request.user_phone, request.target_info, request.service_details, request.preferred_date],
      function(insertErr) {
        if (insertErr) {
          console.error('Error saving to deleted_requests:', insertErr);
        }
        
        // Now delete from service_requests
        db.run('DELETE FROM service_requests WHERE id = ?', [id], function(deleteErr) {
          if (deleteErr) {
            return res.status(500).json({ success: false, message: 'Database error: ' + deleteErr.message });
          }
          res.json({ success: true, message: 'Request deleted successfully' });
        });
      }
    );
  });
});

// Reviews APIs
// Get all reviews
app.get('/api/reviews', (req, res) => {
  db.all('SELECT * FROM reviews WHERE is_active = 1 ORDER BY display_order ASC, created_at DESC', (err, reviews) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, reviews });
  });
});

// Get all reviews (Admin)
app.get('/api/admin/reviews', (req, res) => {
  db.all('SELECT * FROM reviews ORDER BY display_order ASC, created_at DESC', (err, reviews) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, reviews });
  });
});

// Get single review (Admin)
app.get('/api/admin/reviews/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM reviews WHERE id = ?', [id], (err, review) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    res.json({ success: true, review });
  });
});

// Create review (Admin)
app.post('/api/admin/reviews', (req, res) => {
  const { reviewer_name, reviewer_title, reviewer_image, rating, description, category, display_order, is_active } = req.body;
  
  if (!reviewer_name || !reviewer_title || !description) {
    return res.status(400).json({ success: false, message: 'Reviewer name, title, and description are required' });
  }
  
  db.run(
    'INSERT INTO reviews (reviewer_name, reviewer_title, reviewer_image, rating, description, category, display_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [reviewer_name, reviewer_title, reviewer_image || '', rating || 5, description, category || '', display_order || 0, is_active !== undefined ? is_active : 1],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({ success: true, message: 'Review added successfully', reviewId: this.lastID });
    }
  );
});

// Update review (Admin)
app.put('/api/admin/reviews/:id', (req, res) => {
  const { id } = req.params;
  const { reviewer_name, reviewer_title, reviewer_image, rating, description, category, display_order, is_active } = req.body;
  
  if (!reviewer_name || !reviewer_title || !description) {
    return res.status(400).json({ success: false, message: 'Reviewer name, title, and description are required' });
  }
  
  db.run(
    'UPDATE reviews SET reviewer_name = ?, reviewer_title = ?, reviewer_image = ?, rating = ?, description = ?, category = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [reviewer_name, reviewer_title, reviewer_image || '', rating || 5, description, category || '', display_order || 0, is_active !== undefined ? is_active : 1, id],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Review not found' });
      }
      res.json({ success: true, message: 'Review updated successfully' });
    }
  );
});

// Delete review (Admin)
app.delete('/api/admin/reviews/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM reviews WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    res.json({ success: true, message: 'Review deleted successfully' });
  });
});

// Content with Files APIs
// Get all content with files (Public endpoint for premium apps - no limit)
app.get('/api/content-with-files', (req, res) => {
  db.all('SELECT id, image, title, description, file_links, created_at, updated_at FROM content_with_files ORDER BY created_at DESC', (err, contents) => {
    if (err) {
      console.error('Database error loading content:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    
    if (!Array.isArray(contents)) {
      contents = [];
    }
    
    const sanitizedContents = contents.map(content => ({
      id: content.id,
      image: content.image || null,
      title: content.title || '',
      description: content.description || '',
      file_links: content.file_links || null,
      created_at: content.created_at || null,
      updated_at: content.updated_at || null
    }));
    
    res.json({ success: true, contents: sanitizedContents });
  });
});

// Get all content with files (Admin - unlimited)
app.get('/api/admin/content-with-files', (req, res) => {
  db.all('SELECT id, image, title, description, file_links, created_at, updated_at FROM content_with_files ORDER BY created_at DESC', (err, contents) => {
    if (err) {
      console.error('Database error loading content:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    
    // Ensure contents is an array
    if (!Array.isArray(contents)) {
      contents = [];
    }
    
    // Handle null/undefined values
    const sanitizedContents = contents.map(content => ({
      id: content.id,
      image: content.image || null,
      title: content.title || '',
      description: content.description || '',
      file_links: content.file_links || null,
      created_at: content.created_at || null,
      updated_at: content.updated_at || null
    }));
    
    res.json({ success: true, contents: sanitizedContents });
  });
});

// Get single content with files
app.get('/api/admin/content-with-files/:id', (req, res) => {
  const { id } = req.params;
  
  // Validate ID
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ success: false, message: 'Invalid content ID' });
  }
  
  db.get('SELECT id, image, title, description, file_links, created_at, updated_at FROM content_with_files WHERE id = ?', [id], (err, content) => {
    if (err) {
      console.error('Database error loading content:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }
    
    // Get associated files (without file_data for list view, only include it when needed)
    db.all('SELECT id, content_id, file_name, file_type, file_size, upload_date FROM uploaded_files WHERE content_id = ? ORDER BY upload_date DESC', [id], (err, files) => {
      if (err) {
        console.error('Database error loading files:', err);
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      
      // Sanitize content
      const sanitizedContent = {
        id: content.id,
        image: content.image || null,
        title: content.title || '',
        description: content.description || '',
        file_links: content.file_links || null,
        created_at: content.created_at || null,
        updated_at: content.updated_at || null,
        files: Array.isArray(files) ? files : []
      };
      
      res.json({ success: true, content: sanitizedContent });
    });
  });
});

// Create or update content with files
app.post('/api/admin/content-with-files', (req, res) => {
  try {
    const { id, image, title, description, files, file_links } = req.body;
    
    // Validate title
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }
    
    // Validate and sanitize file_links
    let sanitizedFileLinks = null;
    if (file_links) {
      try {
        if (typeof file_links === 'string') {
          const parsed = JSON.parse(file_links);
          if (Array.isArray(parsed)) {
            sanitizedFileLinks = JSON.stringify(parsed);
          } else {
            return res.status(400).json({ success: false, message: 'file_links must be an array' });
          }
        } else if (Array.isArray(file_links)) {
          sanitizedFileLinks = JSON.stringify(file_links);
        } else {
          return res.status(400).json({ success: false, message: 'Invalid file_links format' });
        }
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid JSON in file_links: ' + e.message });
      }
    }
    
    // Validate files array
    if (files && !Array.isArray(files)) {
      return res.status(400).json({ success: false, message: 'files must be an array' });
    }
    
    if (id) {
      // Update existing content
      db.run(
        'UPDATE content_with_files SET image = ?, title = ?, description = ?, file_links = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [image || null, title.trim(), description || '', sanitizedFileLinks, id],
        function(err) {
          if (err) {
            console.error('Database update error:', err);
            return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
          }
          
          // Delete old files if new files are provided
          if (files && files.length > 0) {
            db.run('DELETE FROM uploaded_files WHERE content_id = ?', [id], (deleteErr) => {
              if (deleteErr) {
                console.error('Error deleting old files:', deleteErr);
              }
              
              // Insert new files
              insertFiles(id, files, res);
            });
          } else {
            res.json({ success: true, message: 'Content updated successfully', contentId: id });
          }
        }
      );
    } else {
      // Create new content
      db.run(
        'INSERT INTO content_with_files (image, title, description, file_links) VALUES (?, ?, ?, ?)',
        [image || null, title.trim(), description || '', sanitizedFileLinks],
        function(err) {
          if (err) {
            console.error('Database insert error:', err);
            return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
          }
          
          const contentId = this.lastID;
          
          // Insert files if provided
          if (files && files.length > 0) {
            insertFiles(contentId, files, res);
          } else {
            res.json({ success: true, message: 'Content created successfully', contentId });
          }
        }
      );
    }
  } catch (error) {
    console.error('Server error in content-with-files POST:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Helper function to insert files
function insertFiles(contentId, files, res) {
  if (!files || files.length === 0) {
    res.json({ success: true, message: 'Content saved successfully', contentId });
    return;
  }
  
  const stmt = db.prepare('INSERT INTO uploaded_files (content_id, file_name, file_type, file_data, file_size) VALUES (?, ?, ?, ?, ?)');
  let completed = 0;
  let hasError = false;
  
  files.forEach((file, index) => {
    // Validate file data
    let fileData = file.file_data || '';
    
    // If file_data is too large, truncate or handle it
    if (fileData.length > 50 * 1024 * 1024) { // 50MB limit for SQLite TEXT
      console.warn(`File ${file.file_name} data is too large (${fileData.length} bytes), truncating...`);
      fileData = fileData.substring(0, 50 * 1024 * 1024);
    }
    
    // Ensure file_name and file_type are strings
    const fileName = String(file.file_name || `file_${index + 1}`);
    const fileType = String(file.file_type || 'application/octet-stream');
    const fileSize = parseInt(file.file_size) || 0;
    
    stmt.run([contentId, fileName, fileType, fileData, fileSize], (err) => {
      completed++;
      if (err && !hasError) {
        hasError = true;
        stmt.finalize();
        console.error('Error saving file:', err);
        return res.status(500).json({ success: false, message: 'Error saving files: ' + err.message });
      }
      
      if (completed === files.length && !hasError) {
        stmt.finalize();
        res.json({ success: true, message: 'Content and files saved successfully', contentId });
      }
    });
  });
}

// Get files for a content (Public endpoint)
app.get('/api/content-with-files/:id/files', (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ success: false, message: 'Invalid content ID' });
  }
  
  db.all('SELECT id, content_id, file_name, file_type, file_size, upload_date FROM uploaded_files WHERE content_id = ? ORDER BY upload_date DESC', [id], (err, files) => {
    if (err) {
      console.error('Database error loading files:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    res.json({ success: true, files: Array.isArray(files) ? files : [] });
  });
});

// Get files for a content (Admin)
app.get('/api/admin/content-with-files/:id/files', (req, res) => {
  const { id } = req.params;
  
  // Validate ID
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ success: false, message: 'Invalid content ID' });
  }
  
  db.all('SELECT id, content_id, file_name, file_type, file_size, upload_date FROM uploaded_files WHERE content_id = ? ORDER BY upload_date DESC', [id], (err, files) => {
    if (err) {
      console.error('Database error loading files:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    res.json({ success: true, files: Array.isArray(files) ? files : [] });
  });
});

// Delete content with files
app.delete('/api/admin/content-with-files/:id', (req, res) => {
  const { id } = req.params;
  
  // Delete files first (cascade should handle this, but being explicit)
  db.run('DELETE FROM uploaded_files WHERE content_id = ?', [id], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    
    // Delete content
    db.run('DELETE FROM content_with_files WHERE id = ?', [id], function(deleteErr) {
      if (deleteErr) {
        return res.status(500).json({ success: false, message: 'Database error: ' + deleteErr.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Content not found' });
      }
      res.json({ success: true, message: 'Content deleted successfully' });
    });
  });
});

// Delete a single file
app.delete('/api/admin/uploaded-files/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM uploaded_files WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    res.json({ success: true, message: 'File deleted successfully' });
  });
});

app.get('/api/admin/payment-proof-media', (req, res) => {
  db.all("SELECT id, title, media_type, COALESCE(category, 'Proof') as category, file_name, file_type, file_data, file_size, created_at, updated_at FROM payment_proof_media ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error('Database error loading payment proof media:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    const items = Array.isArray(rows) ? rows : [];
    res.json({ success: true, items });
  });
});

app.get('/api/payment-proof-media', (req, res) => {
  db.all("SELECT id, title, media_type, COALESCE(category, 'Proof') as category, file_name, file_type, file_data, file_size, created_at, updated_at FROM payment_proof_media ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error('Database error loading payment proof media:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    const items = Array.isArray(rows) ? rows : [];
    res.json({ success: true, items });
  });
});

app.get('/api/admin/payment-proof-media/:id', (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ success: false, message: 'Invalid media ID' });
  }
  db.get("SELECT id, title, media_type, COALESCE(category, 'Proof') as category, file_name, file_type, file_data, file_size, created_at, updated_at FROM payment_proof_media WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error('Database error loading payment proof media:', err);
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (!row) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }
    res.json({ success: true, item: row });
  });
});

app.post('/api/admin/payment-proof-media', (req, res) => {
  try {
    const { id, title, media_type, category, file_name, file_type, file_data, file_size } = req.body || {};
    const cleanTitle = typeof title === 'string' && title.trim().length ? title.trim() : null;
    const cleanCategory = typeof category === 'string' && category.trim().length ? category.trim() : 'Proof';
    let mediaType = typeof media_type === 'string' && media_type.trim().length ? media_type.trim() : '';
    const hasFile = typeof file_data === 'string' && file_data.length && typeof file_name === 'string' && file_name.length;
    const cleanFileType = typeof file_type === 'string' && file_type.length ? file_type : 'application/octet-stream';

    if (!mediaType && cleanFileType.startsWith('video')) mediaType = 'video';
    if (!mediaType && cleanFileType.startsWith('image')) mediaType = 'image';

    if (!id && !hasFile) {
      return res.status(400).json({ success: false, message: 'Media file is required' });
    }

    if (hasFile && file_data.length > 50 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Media file data is too large' });
    }

    if (id) {
      if (hasFile) {
        db.run(
          'UPDATE payment_proof_media SET title = ?, media_type = ?, category = ?, file_name = ?, file_type = ?, file_data = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [cleanTitle, mediaType || 'image', cleanCategory, file_name, cleanFileType, file_data, parseInt(file_size) || 0, id],
          function(err) {
            if (err) {
              return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
            }
            if (this.changes === 0) {
              return res.status(404).json({ success: false, message: 'Media not found' });
            }
            res.json({ success: true, message: 'Media updated successfully', id });
          }
        );
      } else {
        db.run(
          'UPDATE payment_proof_media SET title = ?, category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [cleanTitle, cleanCategory, id],
          function(err) {
            if (err) {
              return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
            }
            if (this.changes === 0) {
              return res.status(404).json({ success: false, message: 'Media not found' });
            }
            res.json({ success: true, message: 'Media updated successfully', id });
          }
        );
      }
      return;
    }

    if (!mediaType) {
      return res.status(400).json({ success: false, message: 'Media type is required' });
    }

    db.run(
      'INSERT INTO payment_proof_media (title, media_type, category, file_name, file_type, file_data, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cleanTitle, mediaType, cleanCategory, file_name, cleanFileType, file_data, parseInt(file_size) || 0],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, message: 'Media added successfully', id: this.lastID });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

app.delete('/api/admin/payment-proof-media/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM payment_proof_media WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }
    res.json({ success: true, message: 'Media deleted successfully' });
  });
});

app.get('/api/admin/about-gallery', (req, res) => {
  db.all(
    'SELECT id, name, image_name, image_type, image_data, image_size, created_at, updated_at FROM about_gallery_items ORDER BY created_at DESC',
    (err, rows) => {
      if (err) {
        console.error('Database error loading about gallery items:', err);
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      res.json({ success: true, items: Array.isArray(rows) ? rows : [] });
    }
  );
});

app.get('/api/about-gallery', async (req, res) => {
  try {
    const [titleRow, rows] = await Promise.all([
      getDb('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['about_page_title']),
      allDb('SELECT id, name, image_name, image_type, image_data, image_size, created_at, updated_at FROM about_gallery_items ORDER BY created_at DESC')
    ]);

    res.json({
      success: true,
      title: (titleRow && titleRow.setting_value) ? String(titleRow.setting_value) : 'Our Premium About Collection',
      items: Array.isArray(rows) ? rows : []
    });
  } catch (error) {
    console.error('Database error loading public about gallery:', error);
    res.status(500).json({ success: false, message: 'Database error: ' + error.message });
  }
});

app.get('/api/admin/about-gallery/:id', (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id, 10))) {
    return res.status(400).json({ success: false, message: 'Invalid item ID' });
  }

  db.get(
    'SELECT id, name, image_name, image_type, image_data, image_size, created_at, updated_at FROM about_gallery_items WHERE id = ?',
    [id],
    (err, row) => {
      if (err) {
        console.error('Database error loading about gallery item:', err);
        return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
      }
      if (!row) {
        return res.status(404).json({ success: false, message: 'Item not found' });
      }
      res.json({ success: true, item: row });
    }
  );
});

app.post('/api/admin/about-gallery', (req, res) => {
  try {
    const { id, name, image_name, image_type, image_data, image_size } = req.body || {};
    const cleanName = String(name || '').trim();
    const hasNewImage = typeof image_data === 'string' && image_data.length > 0;

    if (!cleanName) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    if (!id && !hasNewImage) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    if (hasNewImage) {
      const isImageType = String(image_type || '').startsWith('image/');
      if (!isImageType) {
        return res.status(400).json({ success: false, message: 'Only image files are allowed' });
      }
      if (image_data.length > 50 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: 'Image data is too large' });
      }
    }

    if (id) {
      if (hasNewImage) {
        db.run(
          `UPDATE about_gallery_items
           SET name = ?, image_name = ?, image_type = ?, image_data = ?, image_size = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            cleanName,
            image_name || 'about-image',
            image_type || 'image/png',
            image_data,
            parseInt(image_size, 10) || 0,
            id
          ],
          function(err) {
            if (err) {
              return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
            }
            if (this.changes === 0) {
              return res.status(404).json({ success: false, message: 'Item not found' });
            }
            res.json({ success: true, message: 'Item updated successfully', id });
          }
        );
      } else {
        db.run(
          'UPDATE about_gallery_items SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [cleanName, id],
          function(err) {
            if (err) {
              return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
            }
            if (this.changes === 0) {
              return res.status(404).json({ success: false, message: 'Item not found' });
            }
            res.json({ success: true, message: 'Item updated successfully', id });
          }
        );
      }
      return;
    }

    db.run(
      `INSERT INTO about_gallery_items (name, image_name, image_type, image_data, image_size)
       VALUES (?, ?, ?, ?, ?)`,
      [
        cleanName,
        image_name || 'about-image',
        image_type || 'image/png',
        image_data,
        parseInt(image_size, 10) || 0
      ],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
        }
        res.json({ success: true, message: 'Item added successfully', id: this.lastID });
      }
    );
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

app.delete('/api/admin/about-gallery/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM about_gallery_items WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    res.json({ success: true, message: 'Item deleted successfully' });
  });
});

// Download a file by ID
app.get('/api/download/file/:id', (req, res) => {
  const { id } = req.params;

  // Serve the hacking download page if raw query parameter is not present
  if (!req.query.raw) {
    return res.sendFile(path.join(__dirname, 'public', 'hacking-download.html'));
  }

  db.get('SELECT file_name, file_type, file_data FROM uploaded_files WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Database error fetching file for download:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    try {
      // file_data is expected to be a base64 string
      const base64Data = row.file_data.split(';base64,').pop();
      const buffer = Buffer.from(base64Data, 'base64');
      
      res.setHeader('Content-Type', row.file_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
      res.send(buffer);
    } catch (decodeError) {
      console.error('Error decoding file data:', decodeError);
      res.status(500).json({ success: false, message: 'Error processing file data' });
    }
  });
});

app.get('/api/runtime-health', (req, res) => {
  const routeSignatures = getApiRouteSignatures();
  const requiredRoutes = [
    'GET:/api/support-team',
    'PUT:/api/support-team',
    'GET:/api/voice-assistant',
    'PUT:/api/voice-assistant'
  ];

  const requiredRouteStatus = {};
  requiredRoutes.forEach((routeSignature) => {
    requiredRouteStatus[routeSignature] = routeSignatures.includes(routeSignature);
  });

  const responsePayload = {
    success: true,
    runtime: {
      boot_time: SERVER_BOOT_TIME,
      file_path: SERVER_FILE_PATH,
      file_mtime: SERVER_FILE_MTIME,
      release_id: SERVER_RELEASE_ID,
      pid: process.pid,
      node_version: process.version
    },
    required_routes: requiredRouteStatus,
    api_route_count: routeSignatures.length
  };

  if (String(req.query.include_routes || '') === '1') {
    responsePayload.api_routes = routeSignatures;
  }

  res.json(responsePayload);
});

app.listen(PORT, () => {
  const routeSignatures = getApiRouteSignatures();
  const requiredRoutes = [
    'GET:/api/support-team',
    'PUT:/api/support-team',
    'GET:/api/voice-assistant',
    'PUT:/api/voice-assistant'
  ];
  const missingRoutes = requiredRoutes.filter((routeSignature) => !routeSignatures.includes(routeSignature));

  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('[Runtime] file:', SERVER_FILE_PATH);
  console.log('[Runtime] file mtime:', SERVER_FILE_MTIME || 'unknown');
  console.log('[Runtime] boot time:', SERVER_BOOT_TIME);
  console.log('[Runtime] release id:', SERVER_RELEASE_ID || 'not-set');
  if (missingRoutes.length > 0) {
    console.error('[Runtime] Missing required routes:', missingRoutes.join(', '));
  } else {
    console.log('[Runtime] Required routes loaded: support-team + voice-assistant');
  }
});

CREATE TABLE IF NOT EXISTS submission_rate_limits (
  id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (id, window_start)
);

CREATE TABLE IF NOT EXISTS laptop_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  country TEXT NOT NULL,
  location TEXT NOT NULL,
  organization TEXT,
  child_age INTEGER,
  grade TEXT,
  quantity INTEGER NOT NULL,
  computer_access TEXT NOT NULL,
  internet_access TEXT,
  need TEXT NOT NULL,
  impact TEXT NOT NULL,
  financial_difficulty TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS laptop_applications_reference_idx ON laptop_applications(reference);
CREATE INDEX IF NOT EXISTS laptop_applications_email_idx ON laptop_applications(email);
CREATE INDEX IF NOT EXISTS laptop_applications_status_idx ON laptop_applications(status, created_at);

CREATE TABLE IF NOT EXISTS laptop_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  application_id INTEGER,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(application_id) REFERENCES laptop_applications(id)
);
CREATE INDEX IF NOT EXISTS laptop_tokens_expiry_idx ON laptop_tokens(kind, expires_at, used_at);

CREATE TABLE IF NOT EXISTS laptop_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES laptop_applications(id)
);
CREATE INDEX IF NOT EXISTS laptop_history_app_idx ON laptop_history(application_id, created_at);

CREATE TABLE IF NOT EXISTS laptop_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag TEXT UNIQUE NOT NULL,
  brand TEXT,
  model TEXT,
  condition TEXT NOT NULL DEFAULT 'pending_refurbishment',
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS laptop_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  inventory_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at TEXT NOT NULL,
  fulfilled_at TEXT,
  FOREIGN KEY(application_id) REFERENCES laptop_applications(id),
  FOREIGN KEY(inventory_id) REFERENCES laptop_inventory(id)
);
CREATE INDEX IF NOT EXISTS laptop_allocations_app_idx ON laptop_allocations(application_id, status);

CREATE TABLE IF NOT EXISTS dkf_paypal_donations (
  transaction_id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  item_name TEXT,
  item_number TEXT,
  verification_source TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  ga4_sent_at TEXT
);

CREATE TABLE IF NOT EXISTS dkf_donor_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE,
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'receipt',
  donation_type TEXT NOT NULL,
  donation_date TEXT NOT NULL,
  quantity INTEGER,
  description TEXT NOT NULL,
  monetary_amount REAL,
  consideration_type TEXT NOT NULL DEFAULT 'none',
  consideration_description TEXT,
  consideration_value REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  resend_email_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT,
  issued_pdf BLOB,
  last_previewed_at TEXT,
  verification_code TEXT UNIQUE,
  verification_seal TEXT,
  issued_pdf_sha256 TEXT,
  document_format_version INTEGER NOT NULL DEFAULT 3,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS dkf_receipts_created_idx ON dkf_donor_receipts(created_at DESC);

CREATE TABLE IF NOT EXISTS dkf_receipt_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(receipt_id) REFERENCES dkf_donor_receipts(id)
);
CREATE INDEX IF NOT EXISTS dkf_receipt_audit_idx ON dkf_receipt_audit(receipt_id, created_at DESC);

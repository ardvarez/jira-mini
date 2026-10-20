-- Drop foreign key constraint on attachments to allow flexible attachments
DROP TABLE IF EXISTS attachments;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  content_type TEXT DEFAULT 'image/png',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachments_issue ON attachments(issue_id);

-- Seed Projects
INSERT OR REPLACE INTO projects (id, name, code) VALUES 
('PINSP', 'Power Inspect', 'PI'),
('PSWIFT', 'Power Swift', 'PS'),
('NPST', 'New PST', 'NP');

-- Seed Users
INSERT OR REPLACE INTO users (email, name, role, password_hash) VALUES
('ardvarez@gmail.com', 'Ardan', 'PM', 'e665936361ced424c1b4c12772b2483fa7986276a907c16828f3a2f07f85c42a'),
('banyurizkika@gmail.com', 'Banyu Rizkika', 'PM', ''),
('bagus@pln.co.id', 'Bagus', 'DEV', ''),
('qc@pln.co.id', 'QC Specialist', 'QC', ''),
('ba@pln.co.id', 'BA Analyst', 'BA', '');

-- Seed Epics
INSERT OR REPLACE INTO epics (id, project_id, name, color) VALUES
('EPIC-PI-1', 'PINSP', 'Inspeksi & Verifikasi Transmisi', 'purple'),
('EPIC-PI-2', 'PINSP', 'Tindak Lanjut & Monitoring', 'blue'),
('EPIC-PI-3', 'PINSP', 'Master Parameter & Formulir', 'emerald');

-- Seed 7 Tasks for Ardan
INSERT OR REPLACE INTO issues (id, project_id, epic_id, type, role, summary, description, priority, status, sprint, assignee) VALUES
('PINSP-201', 'PINSP', 'EPIC-PI-1', 'test_case', 'QC', '[QC] Inspeksi Mobile (bgs, ard)', 'Status: Ready To QA, PIC: Bagus, Ardan, Tahap 1: 19/10/2026 - 23/10/2026, Bidang: Transmission', 'highest', 'testing', 'SPRINT-1', 'ardvarez@gmail.com (You)'),
('PINSP-202', 'PINSP', 'EPIC-PI-1', 'test_case', 'QC', '[QC] Verifikasi 1 (ard)', 'Status: Ready To QA, PIC: Ardan, Tahap 1: 19/10/2026 - 23/10/2026, Bidang: Transmission', 'high', 'testing', 'SPRINT-1', 'ardvarez@gmail.com (You)'),
('PINSP-203', 'PINSP', 'EPIC-PI-1', 'test_case', 'QC', '[QC] Verifikasi 2 (ard)', 'Status: Ready To QA, PIC: Ardan, Tahap 1: 19/10/2026 - 23/10/2026, Bidang: Transmission', 'high', 'testing', 'SPRINT-1', 'ardvarez@gmail.com (You)'),
('PINSP-204', 'PINSP', 'EPIC-PI-2', 'test_case', 'QC', '[QC] Tindak Lanjut (ard)', 'Status: Ready To QA, PIC: Ardan, Tahap 1: 19/10/2026 - 23/10/2026, Bidang: Transmission', 'high', 'testing', 'SPRINT-1', 'ardvarez@gmail.com (You)'),
('PINSP-205', 'PINSP', 'EPIC-PI-2', 'test_case', 'QC', '[QC] Monitoring Tindak Lanjut (ard)', 'Status: Ready To QA, PIC: Ardan, Tahap 1: 19/10/2026 - 23/10/2026, Bidang: Transmission', 'medium', 'testing', 'SPRINT-1', 'ardvarez@gmail.com (You)'),
('PINSP-206', 'PINSP', 'EPIC-PI-3', 'test_case', 'QC', '[QC] Master Parameter (ard)', 'Status: Ready To QA, PIC: Ardan, Tahap 1: 19/10/2026 - 23/10/2026, Bidang: Transmission', 'medium', 'testing', 'SPRINT-1', 'ardvarez@gmail.com (You)'),
('PINSP-207', 'PINSP', 'EPIC-PI-3', 'test_case', 'QC', '[QC] Formulir Inspeksi (ard)', 'Status: Ready To QA, PIC: Ardan, Tahap 1: 19/10/2026 - 23/10/2026, Bidang: Transmission', 'medium', 'testing', 'SPRINT-1', 'ardvarez@gmail.com (You)');

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Database setup (persistent file-based)
const db = new sqlite3.Database(path.join(__dirname, 'data', 'kwera.db'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      mifi TEXT,
      university TEXT NOT NULL,
      cohort TEXT,
      employment_status TEXT,
      confirmation_status TEXT DEFAULT 'unconfirmed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Check if table is empty, then seed
  db.get(`SELECT COUNT(*) as count FROM records`, (err, row) => {
    if (err) return;
    if (row.count === 0) {
      const seedData = [
        { name: "Morris Matola M'baya", phone: "993723751", mifi: "", university: "University of Malawi", cohort: "Cohort 5", employment_status: "Employed (Full-time)" },
        { name: "Ellen Mziya Mwafulirwa", phone: "888548636", mifi: "", university: "Lilongwe University of Agriculture and Natural Resources", cohort: "Cohort 3", employment_status: "Employed (Full-time)" },
        { name: "Violla Chilemba", phone: "993748282", mifi: "", university: "Malawi University of Science and Technology", cohort: "Cohort 1", employment_status: "Employed (Full-time)" }
      ];

      seedData.forEach(record => {
        db.run(
          `INSERT INTO records (name, phone, mifi, university, cohort, employment_status) VALUES (?, ?, ?, ?, ?, ?)`,
          [record.name, record.phone, record.mifi, record.university, record.cohort, record.employment_status]
        );
      });
      console.log('✅ Seed data inserted');
    }
  });
});

// ============================================================
// AUTHENTICATION
// ============================================================
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const ADMIN_EMAIL = 'siphoc4chinyamula@gmail.com';
  const ADMIN_PASS = 'user admin';

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    res.json({ success: true, role: 'admin' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// ============================================================
// PUBLIC DIRECTORY ENDPOINTS (No auth required)
// ============================================================
app.get('/api/directory/records', (req, res) => {
  const { search, cohort, status } = req.query;
  let query = 'SELECT * FROM records';
  const params = [];

  const conditions = [];
  if (search) {
    conditions.push(`(name LIKE ? OR university LIKE ? OR cohort LIKE ? OR phone LIKE ?)`);
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam, searchParam);
  }
  if (cohort) {
    conditions.push(`cohort = ?`);
    params.push(cohort);
  }
  if (status) {
    conditions.push(`confirmation_status = ?`);
    params.push(status);
  }
  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ records: rows || [] });
  });
});

app.get('/api/directory/stats', (req, res) => {
  db.all(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN confirmation_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN confirmation_status = 'unconfirmed' THEN 1 ELSE 0 END) as unconfirmed
    FROM records
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const stats = rows[0];
    res.json({ 
      total: stats.total || 0,
      confirmed: stats.confirmed || 0,
      unconfirmed: stats.unconfirmed || 0
    });
  });
});

app.get('/api/directory/cohorts', (req, res) => {
  db.all(`
    SELECT DISTINCT cohort FROM records 
    WHERE cohort IS NOT NULL AND cohort != '' 
    ORDER BY cohort ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ cohorts: rows.map(r => r.cohort) || [] });
  });
});

app.post('/api/confirm/:id', (req, res) => {
  const { id } = req.params;
  db.run(
    `UPDATE records SET confirmation_status='confirmed', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Details confirmed' });
    }
  );
});

// ============================================================
// ADMIN ENDPOINTS (Protected - but no session for simplicity)
// ============================================================
app.get('/api/admin/records', (req, res) => {
  const { search } = req.query;
  let query = 'SELECT * FROM records';
  const params = [];

  if (search) {
    query += ` WHERE name LIKE ? OR university LIKE ?`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam);
  }
  query += ' ORDER BY id DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ records: rows || [] });
  });
});

app.post('/api/admin/records', (req, res) => {
  const { name, phone, mifi, university, cohort, employment_status, confirmation_status } = req.body;

  if (!name || !university) {
    return res.status(400).json({ error: 'Name and University are required' });
  }

  db.run(
    `INSERT INTO records (name, phone, mifi, university, cohort, employment_status, confirmation_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, phone || '', mifi || '', university, cohort || '', employment_status || '', confirmation_status || 'unconfirmed'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: 'Record created' });
    }
  );
});

app.put('/api/admin/records/:id', (req, res) => {
  const { id } = req.params;
  const { name, phone, mifi, university, cohort, employment_status, confirmation_status } = req.body;

  db.run(
    `UPDATE records 
     SET name=?, phone=?, mifi=?, university=?, cohort=?, employment_status=?, confirmation_status=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [name, phone || '', mifi || '', university, cohort || '', employment_status || '', confirmation_status || 'unconfirmed', id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Record updated' });
    }
  );
});

app.delete('/api/admin/records/:id', (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM records WHERE id=?`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Record deleted' });
  });
});

app.get('/api/admin/export', (req, res) => {
  db.all('SELECT * FROM records ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Name': r.name,
      'Phone': r.phone,
      'MIFI': r.mifi,
      'University': r.university,
      'Cohort': r.cohort,
      'Employment Status': r.employment_status,
      'Confirmation Status': r.confirmation_status
    })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Records');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Kwera_SC_Data_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    res.send(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  });
});

app.post('/api/admin/import', (req, res) => {
  const { records } = req.body;
  
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No records provided' });
  }

  let added = 0;
  let errors = [];

  const insertRecord = (record, idx) => {
    return new Promise((resolve) => {
      const { name, phone, mifi, university, cohort, employment_status, confirmation_status } = record;
      
      if (!name || !university) {
        errors.push(`Row ${idx + 1}: Missing name or university`);
        resolve();
        return;
      }

      db.run(
        `INSERT INTO records (name, phone, mifi, university, cohort, employment_status, confirmation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, phone || '', mifi || '', university, cohort || '', employment_status || 'Employed (Full-time)', confirmation_status || 'unconfirmed'],
        function(err) {
          if (err) {
            errors.push(`Row ${idx + 1}: ${err.message}`);
          } else {
            added++;
          }
          resolve();
        }
      );
    });
  };

  Promise.all(records.map((r, i) => insertRecord(r, i))).then(() => {
    res.json({ added, errors: errors.slice(0, 10) });
  });
});

// ============================================================
// SERVE PAGES
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/directory', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'directory.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Admin panel: http://localhost:${PORT}/`);
  console.log(`👥 Public directory: http://localhost:${PORT}/directory`);
});
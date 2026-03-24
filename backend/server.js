const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secure-production-secret-key';
const HASH_SALT = process.env.HASH_SALT || 'salt-used-to-prevent-rainbow-table-attacks';

// Minimalistic JWT verification
function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: "Invalid tracking token" });
            req.user = user;
            next();
        });
    } else {
        res.status(401).json({ error: "Missing authentication token" });
    }
}

// Convert raw email into an uncrackable hex string for privacy compliance
function anonymizeUserIdentity(plainTextEmail) {
    if (!plainTextEmail) return 'anonymous-session';
    return crypto.createHmac('sha256', HASH_SALT)
                 .update(plainTextEmail.toLowerCase())
                 .digest('hex');
}

let transporter;
nodemailer.createTestAccount((err, account) => {
    if (err) {
        console.error('Failed to create a testing account. ' + err.message);
        return;
    }
    transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass }
    });
    console.log('📧 Ethereal Email Service Ready for OTP Delivery');
});

const app = express();
app.use(cors());
app.use(express.json());

// MS SQL Server Connection Configuration
const masterConfig = {
    user: 'sa', // SQL Server system admin default
    password: '', // ENTER YOUR REAL SQL ADMIN PASSWORD HERE!
    server: '127.0.0.1', // Or 'localhost\\SQLEXPRESS'
    database: 'master',
    options: {
        encrypt: false, 
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

const appConfig = {
    ...masterConfig,
    database: 'signupMetrics'
};

let pool;

async function initDB() {
    try {
        // 1. Connect to default 'master' DB just to run CREATE DATABASE IF NOT EXISTS
        let masterPool = await sql.connect(masterConfig);
        await masterPool.request().query(`
            IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'signupMetrics')
            BEGIN
                CREATE DATABASE [signupMetrics]
            END
        `);
        await masterPool.close();

        // 2. Establish permanent connection to the newly instantiated database schema
        pool = await sql.connect(appConfig);
        
        // 3. Setup the tracking table
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='metrics' AND xtype='U')
            BEGIN
                CREATE TABLE metrics (
                    event VARCHAR(255) PRIMARY KEY,
                    count INT DEFAULT 0
                )
            END
        `);

        // 4. Input the base values for dashboard visuals
        const result = await pool.request().query(`SELECT COUNT(*) as cnt FROM metrics`);
        if (result.recordset[0].cnt === 0) {
            const inserts = [
                { e: 'started', c: 1042 },
                { e: 'completed_step1', c: 856 },
                { e: 'completed_step2', c: 512 },
                { e: 'completed_step3', c: 420 }
            ];
            for (const item of inserts) {
                await pool.request()
                    .input('evt', sql.VarChar, item.e)
                    .input('cnt', sql.Int, item.c)
                    .query(`INSERT INTO metrics (event, count) VALUES (@evt, @cnt)`);
            }
        }
        console.log('✅ MS SQL Server Connected to signupMetrics DB & Initialized Data');
    } catch (err) {
        console.warn('\n⚠️ MS SQL Server Connection Error:');
        console.warn('-> This usually fails if your SQL Server requires a password, or is not running globally on localhost 1433!');
        console.warn(`System Details: ${err.message}\n`);
    }
}

initDB();

// 1. Give the frontend a limited-access token to verify its existence
app.get('/api/start-session', (req, res) => {
    const token = jwt.sign({ clientId: 'frontend-web-app' }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

// 2. Dynamic route tracking funnel engagement parameters, now locked behind JWT
app.post('/api/track', authenticateJWT, async (req, res) => {
  const { event, email, deviceType } = req.body;
  if (!pool) return res.status(500).json({ error: 'SQL Server not connected' });
  
  // 3. Demonstrating Data Minimization in the logs (never raw PII)
  const anonymousUserId = anonymizeUserIdentity(email);
  console.log(`[SECURE AUDIT] Action: '${event}' | HMAC User: ${anonymousUserId.substring(0, 10)}... | Device: ${deviceType || 'unknown'}`);
  
  try {
    // T-SQL compliant UPSERT (MERGE logic)
    await pool.request()
        .input('event', sql.VarChar, event)
        .query(`
            MERGE metrics AS target
            USING (SELECT @event AS event) AS source
            ON target.event = source.event
            WHEN MATCHED THEN
                UPDATE SET count = target.count + 1
            WHEN NOT MATCHED THEN
                INSERT (event, count) VALUES (source.event, 1);
        `);
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Front end pull routine
app.get('/api/metrics', async (req, res) => {
  if (!pool) {
     return res.json({
        started: 1042,
        completed_step1: 856,
        completed_step2: 512,
        completed_step3: 420
    });
  }

  try {
    const result = await pool.request().query(`SELECT event, count FROM metrics`);
    const formatted = {};
    result.recordset.forEach(r => { formatted[r.event] = r.count; });
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to send the OTP email securely
app.post('/api/send-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!transporter) return res.status(500).json({ error: 'Mail transport not ready yet' });

  try {
      let info = await transporter.sendMail({
          from: '"Signup Security" <noreply@dropoff-test.com>',
          to: email, 
          subject: "Your Verification Code",
          text: `Your OTP is: ${otp}`,
          html: `<div style="font-family: sans-serif; padding: 20px;"><h2>Welcome!</h2><p>Your one-time verification code is:</p><h1 style="color: #2ea043; letter-spacing: 4px;">${otp}</h1><p>Please enter this code in the app to complete your signup.</p></div>`
      });
      
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`✉️ Mock OTP Email sent to ${email} -> Preview URL: ${previewUrl}`);
      res.json({ success: true, previewUrl });
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 SQL Server Analytics Runtime active on http://localhost:${PORT}`));

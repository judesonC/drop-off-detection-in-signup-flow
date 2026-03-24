// secure_analytics_demo.js
// ------------------------------------------------------------------
// This file is a functional Node.js application demonstrating how to 
// ingest user drop-off data securely using Data Minimization,
// HMAC SHA-256 Anonymization, and secure JWT token verification.
// ------------------------------------------------------------------

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// 1. Configuration & Security Secrets
// In production, these should be securely injected via environment variables (.env)
const JWT_SECRET = process.env.JWT_SECRET || 'super-secure-production-secret-key';
const HASH_SALT = process.env.HASH_SALT || 'salt-used-to-prevent-rainbow-table-attacks';


// 2. secure Access Control via JSON Web Tokens (JWT)
// This middleware ensures that only verified frontend clients can ingest events,
// preventing malicious actors from spamming your tracking database.
function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: "Invalid tracking token" });
            req.user = user;
            next(); // Token is valid, proceed!
        });
    } else {
        res.status(401).json({ error: "Missing authentication token" });
    }
}


// 3. Data Minimization & Anonymization Engine
// We use HMAC with a secret salt so the hash cannot be reverse-engineered!
function anonymizeUserIdentity(plainTextEmail) {
    if (!plainTextEmail) return 'anonymous-session';
    return crypto.createHmac('sha256', HASH_SALT)
                 .update(plainTextEmail.toLowerCase())
                 .digest('hex');
}


// 4. Integrated Analytics Intake Endpoint
// Notice the 'authenticateJWT' middleware blocking unauthorized requests.
app.post('/api/secure-track', authenticateJWT, (req, res) => {
    // We receive potentially sensitive context from the frontend
    const { event, rawEmail, deviceInfo } = req.body;

    // STEP A: Anonymization (Destroy PII immediately in memory)
    const anonymousUserId = anonymizeUserIdentity(rawEmail);

    // STEP B: Data Minimization
    // We strictly construct a brand new object. We drop all excessive headers.
    // IP Addresses are explicitly IGNORED to comply with strict GDPR interpretations.
    const safePayload = {
        userId: anonymousUserId,
        event: event,
        timestamp: new Date().toISOString(),
        deviceType: deviceInfo?.os || 'unknown'
    };

    // STEP C: Masking in System Logs
    // We never print the plain-text email to Heroku/AWS console logs!
    console.log(`[SECURE LOG]: Tracked event '${safePayload.event}' for User Hash: ${safePayload.userId.substring(0, 8)}...`);

    // STEP D: Storage Layer 
    // Usually via an AES-256 encrypted database connection (like mssql or mysql2)
    // mockSaveToDatabase(safePayload);

    res.json({ success: true, message: "Behavior tracked securely." });
});


// ------------------------------------------------------------------
// Demo Helper Routes to show the entire lifecycle
// ------------------------------------------------------------------

// Simulated Login/Session start that grants a tracking token
app.get('/api/start-session', (req, res) => {
    const token = jwt.sign({ clientId: 'frontend-web-app' }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ 
        message: "Here is your secure session token for analytics tracking.", 
        token 
    });
});

const PORT = 5001;
app.listen(PORT, () => {
    console.log(`\n🛡️  Secure Analytics System running on http://localhost:${PORT}`);
    console.log(`✅ Active Privacy Protections:`);
    console.log(`  - JWT Session Validation: Enforced`);
    console.log(`  - PII Scrubbing: Dropping IP addresses`);
    console.log(`  - Hashing: HMAC SHA-256 identity masking`);
});

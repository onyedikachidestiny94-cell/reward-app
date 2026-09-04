require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_123';

const auth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch { return res.status(401).json({ error: 'Invalid token' }); }
};

app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
        const user = await pool.query('INSERT INTO users (email, password_hash, referral_code) VALUES ($1, $2, $3) RETURNING id', [email, hash, code]);
        await pool.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.rows[0].id]);
        const token = jwt.sign({ id: user.rows[0].id }, JWT_SECRET);
        res.json({ token });
    } catch (e) { res.status(400).json({ error: 'User exists' }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'Invalid' });
    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid' });
    const token = jwt.sign({ id: user.rows[0].id }, JWT_SECRET);
    res.json({ token });
});

app.get('/api/dashboard', auth, async (req, res) => {
    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
    res.json({ balance: wallet.rows[0].points_balance });
});

app.post('/api/spin', auth, async (req, res) => {
    const { adVerified } = req.body;
    if (!adVerified) return res.status(400).json({ error: 'Watch ad' });
    
    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
    const today = new Date().toISOString().split('T')[0];
    if (wallet.rows[0].last_spin_date === today) return res.status(400).json({ error: 'Already spun' });

    const rand = Math.random();
    let points = 1;
    if (rand > 0.95) points = 20;
    else if (rand > 0.80) points = 5;
    else if (rand > 0.50) points = 2;

    await pool.query('UPDATE wallets SET points_balance = points_balance + $1, last_spin_date = $2 WHERE user_id = $3', [points, today, req.user.id]);
    res.json({ points });
});

app.post('/api/mine', auth, async (req, res) => {
    const { adVerified } = req.body;
    if (!adVerified) return res.status(400).json({ error: 'Watch ad' });

    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
    if (wallet.rows[0].last_mine_claim) {
        const hours = (Date.now() - new Date(wallet.rows[0].last_mine_claim)) / 3600000;
        if (hours < 4) return res.status(400).json({ error: 'Cooldown' });
    }

    const points = Math.floor(Math.random() * 3) + 1;
    await pool.query('UPDATE wallets SET points_balance = points_balance + $1, last_mine_claim = NOW() WHERE user_id = $2', [points, req.user.id]);
    res.json({ points });
});

app.post('/api/withdraw', auth, async (req, res) => {
    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
    if (wallet.rows[0].points_balance < 667) return res.status(400).json({ error: 'Need 667 points ($100)' });
    
    await pool.query('UPDATE wallets SET points_balance = points_balance - 667 WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'Withdrawal requested' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

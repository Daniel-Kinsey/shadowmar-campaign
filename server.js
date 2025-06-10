const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'shadowmar_campaign_secret_key_2024';

// Database setup
const db = new sqlite3.Database('./campaign.db');

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'player',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
    )`);

    // Players table
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        class TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        role TEXT NOT NULL,
        hp_current INTEGER NOT NULL,
        hp_max INTEGER NOT NULL,
        ac INTEGER NOT NULL,
        location TEXT NOT NULL,
        experience_current INTEGER DEFAULT 0,
        experience_total INTEGER DEFAULT 0,
        status_effects TEXT DEFAULT '[]',
        spell_slots TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // NPCs table
    db.run(`CREATE TABLE IF NOT EXISTS npcs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        role TEXT NOT NULL,
        importance TEXT DEFAULT 'low',
        personality TEXT,
        responses TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Quests table
    db.run(`CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'active',
        reward INTEGER DEFAULT 0,
        assigned_to TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Session notes table
    db.run(`CREATE TABLE IF NOT EXISTS session_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        session_number INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Campaign settings table
    db.run(`CREATE TABLE IF NOT EXISTS campaign_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_name TEXT DEFAULT 'Chronicles of Shadowmar',
        current_session INTEGER DEFAULT 1,
        current_location TEXT DEFAULT 'Xylos - Market Square',
        settings_data TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Combat state table
    db.run(`CREATE TABLE IF NOT EXISTS combat_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        active BOOLEAN DEFAULT FALSE,
        initiative_order TEXT DEFAULT '[]',
        current_turn INTEGER DEFAULT 0,
        round_number INTEGER DEFAULT 1,
        turn_timer INTEGER DEFAULT 30,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Battle map state table
    db.run(`CREATE TABLE IF NOT EXISTS battle_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tokens TEXT DEFAULT '[]',
        grid_size INTEGER DEFAULT 40,
        show_grid BOOLEAN DEFAULT TRUE,
        map_data TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Treasure table
    db.run(`CREATE TABLE IF NOT EXISTS treasure (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        session_number INTEGER NOT NULL,
        distributed BOOLEAN DEFAULT FALSE,
        value INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create default admin user if none exists
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (row.count === 0) {
            const hashedPassword = bcrypt.hashSync('shadowmar2024', 10);
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                ['dm', hashedPassword, 'admin']);
            
            const coPassword = bcrypt.hashSync('stormchaser', 10);
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                ['codm', coPassword, 'dm']);
        }
    });

    // Initialize default campaign settings
    db.get("SELECT COUNT(*) as count FROM campaign_settings", (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO campaign_settings 
                (campaign_name, current_session, current_location) 
                VALUES (?, ?, ?)`, 
                ['Chronicles of Shadowmar', 3, 'Xylos - Market Square']);
        }
    });

    // Initialize default players if none exist
    db.get("SELECT COUNT(*) as count FROM players", (err, row) => {
        if (row.count === 0) {
            const defaultPlayers = [
                {
                    name: 'Captain Blackwood',
                    class: 'Ranger',
                    level: 5,
                    role: 'Navigator',
                    hp_current: 45,
                    hp_max: 45,
                    ac: 16,
                    location: 'Xylos Market Square',
                    experience_current: 6500,
                    experience_total: 6500,
                    spell_slots: JSON.stringify({
                        level1: { current: 3, max: 4 },
                        level2: { current: 2, max: 3 }
                    })
                },
                {
                    name: 'First Mate Rodriguez',
                    class: 'Fighter',
                    level: 5,
                    role: 'Master Gunner',
                    hp_current: 52,
                    hp_max: 58,
                    ac: 18,
                    location: 'Xylos Market Square',
                    experience_current: 6500,
                    experience_total: 6500,
                    status_effects: JSON.stringify(['Blessed']),
                    spell_slots: JSON.stringify({
                        level1: { current: 2, max: 2 }
                    })
                },
                {
                    name: 'Doctor Sarah Cross',
                    class: 'Cleric',
                    level: 4,
                    role: 'Ship\'s Surgeon',
                    hp_current: 35,
                    hp_max: 38,
                    ac: 15,
                    location: 'Xylos Market Square',
                    experience_current: 2700,
                    experience_total: 2700,
                    spell_slots: JSON.stringify({
                        level1: { current: 4, max: 4 },
                        level2: { current: 3, max: 3 }
                    })
                }
            ];

            defaultPlayers.forEach(player => {
                db.run(`INSERT INTO players 
                    (name, class, level, role, hp_current, hp_max, ac, location, 
                     experience_current, experience_total, status_effects, spell_slots)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [player.name, player.class, player.level, player.role,
                     player.hp_current, player.hp_max, player.ac, player.location,
                     player.experience_current, player.experience_total,
                     player.status_effects || '[]', player.spell_slots]);
            });
        }
    });

    // Initialize default NPCs
    db.get("SELECT COUNT(*) as count FROM npcs", (err, row) => {
        if (row.count === 0) {
            const defaultNPCs = [
                {
                    name: 'The Minister',
                    location: 'Xylos Graveyard',
                    role: 'Quest Giver',
                    importance: 'high',
                    personality: 'Solemn but helpful, speaks in riddles',
                    responses: JSON.stringify({
                        greeting: [
                            'The dead rest uneasily here, traveler.',
                            'Another soul seeks answers in this drowned realm.',
                            'Welcome to the eternal twilight of Xylos.'
                        ],
                        quest: [
                            'Read the Chronicle, young one. Knowledge is the key to understanding.',
                            'The King will not see you until you prove your worth.',
                            'The truth of our fall lies in the Library of Whispers.'
                        ],
                        goodbye: [
                            'May the Weavers guide your path.',
                            'The truth lies buried deep, but not beyond reach.',
                            'Return when you have learned what the dead already know.'
                        ],
                        help: [
                            'Seek the Chronicle in the Library - it holds our history.',
                            'The Church Specters are harmless, they only seek to serve.',
                            'Beware the deeper waters - darker things dwell there.'
                        ]
                    })
                },
                {
                    name: 'Trenchkin Elder',
                    location: 'Xylos Residential Strip',
                    role: 'Information Source',
                    importance: 'medium',
                    personality: 'Cautious but helpful to those who prove trustworthy',
                    responses: JSON.stringify({
                        greeting: [
                            'Surface dwellers... you swim in dangerous waters.',
                            'Few visitors come to our drowned home.',
                            'You have the look of those who seek the deep treasures.'
                        ],
                        quest: [
                            'The treasure you seek is not what you expect.',
                            'Many have come seeking gold, but found only sorrow.',
                            'Help our people, and we may help you in return.'
                        ],
                        goodbye: [
                            'Be careful in the deeper districts.',
                            'The currents here can pull you down forever.',
                            'May you find what you truly need, not what you want.'
                        ],
                        help: [
                            'The Echoes remember everything - speak to them carefully.',
                            'Fresh fruit grows in the gardens, take what you need.',
                            'The King\'s statue... sometimes its light changes meaning.'
                        ]
                    })
                }
            ];

            defaultNPCs.forEach(npc => {
                db.run(`INSERT INTO npcs 
                    (name, location, role, importance, personality, responses)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [npc.name, npc.location, npc.role, npc.importance, 
                     npc.personality, npc.responses]);
            });
        }
    });
});

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes

// Authentication routes
app.post('/api/login', [
    body('username').trim().isLength({ min: 1 }).escape(),
    body('password').isLength({ min: 1 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        db.run("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [user.id]);

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    });
});

// Player routes
app.get('/api/players', authenticateToken, (req, res) => {
    db.all("SELECT * FROM players ORDER BY name", (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const players = rows.map(player => ({
            ...player,
            status_effects: JSON.parse(player.status_effects || '[]'),
            spell_slots: JSON.parse(player.spell_slots || '{}')
        }));

        res.json(players);
    });
});

app.put('/api/players/:id', authenticateToken, [
    body('name').optional().trim().isLength({ min: 1 }).escape(),
    body('hp_current').optional().isInt({ min: 0 }),
    body('hp_max').optional().isInt({ min: 1 }),
    body('ac').optional().isInt({ min: 1 }),
    body('location').optional().trim().escape()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const updates = req.body;

    // Convert arrays/objects to JSON strings
    if (updates.status_effects) {
        updates.status_effects = JSON.stringify(updates.status_effects);
    }
    if (updates.spell_slots) {
        updates.spell_slots = JSON.stringify(updates.spell_slots);
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    db.run(`UPDATE players SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        values, function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Player not found' });
        }

        res.json({ success: true });
    });
});

app.post('/api/players', authenticateToken, [
    body('name').trim().isLength({ min: 1 }).escape(),
    body('class').trim().isLength({ min: 1 }).escape(),
    body('role').trim().isLength({ min: 1 }).escape(),
    body('level').isInt({ min: 1, max: 20 }),
    body('hp_max').isInt({ min: 1 }),
    body('ac').isInt({ min: 1 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, class: playerClass, role, level, hp_max, ac, location } = req.body;

    db.run(`INSERT INTO players 
        (name, class, role, level, hp_current, hp_max, ac, location)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, playerClass, role, level, hp_max, hp_max, ac, location || 'Unknown'],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ id: this.lastID, success: true });
        });
});

// NPC routes
app.get('/api/npcs', authenticateToken, (req, res) => {
    db.all("SELECT * FROM npcs ORDER BY importance DESC, name", (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const npcs = rows.map(npc => ({
            ...npc,
            responses: JSON.parse(npc.responses || '{}')
        }));

        res.json(npcs);
    });
});

app.post('/api/npcs', authenticateToken, [
    body('name').trim().isLength({ min: 1 }).escape(),
    body('location').trim().isLength({ min: 1 }).escape(),
    body('role').trim().isLength({ min: 1 }).escape(),
    body('importance').isIn(['low', 'medium', 'high']),
    body('personality').optional().trim().escape()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, location, role, importance, personality, responses } = req.body;

    db.run(`INSERT INTO npcs 
        (name, location, role, importance, personality, responses)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [name, location, role, importance, personality || '', 
         JSON.stringify(responses || {})],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ id: this.lastID, success: true });
        });
});

app.put('/api/npcs/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    if (updates.responses) {
        updates.responses = JSON.stringify(updates.responses);
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    db.run(`UPDATE npcs SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        values, function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'NPC not found' });
        }

        res.json({ success: true });
    });
});

// Quest routes
app.get('/api/quests', authenticateToken, (req, res) => {
    db.all("SELECT * FROM quests ORDER BY created_at DESC", (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const quests = rows.map(quest => ({
            ...quest,
            assigned_to: JSON.parse(quest.assigned_to || '[]')
        }));

        res.json(quests);
    });
});

app.post('/api/quests', authenticateToken, [
    body('title').trim().isLength({ min: 1 }).escape(),
    body('description').optional().trim().escape(),
    body('reward').optional().isInt({ min: 0 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, reward, assigned_to } = req.body;

    db.run(`INSERT INTO quests 
        (title, description, reward, assigned_to)
        VALUES (?, ?, ?, ?)`,
        [title, description || '', reward || 0, 
         JSON.stringify(assigned_to || [])],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ id: this.lastID, success: true });
        });
});

app.put('/api/quests/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    if (updates.assigned_to) {
        updates.assigned_to = JSON.stringify(updates.assigned_to);
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    db.run(`UPDATE quests SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        values, function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Quest not found' });
        }

        res.json({ success: true });
    });
});

// Session notes routes
app.get('/api/session-notes', authenticateToken, (req, res) => {
    db.all("SELECT * FROM session_notes ORDER BY created_at DESC", (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        res.json(rows);
    });
});

app.post('/api/session-notes', authenticateToken, [
    body('content').trim().isLength({ min: 1 }),
    body('session_number').isInt({ min: 1 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { content, session_number } = req.body;

    db.run(`INSERT INTO session_notes (content, session_number) VALUES (?, ?)`,
        [content, session_number],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ id: this.lastID, success: true });
        });
});

// Campaign settings routes
app.get('/api/campaign-settings', authenticateToken, (req, res) => {
    db.get("SELECT * FROM campaign_settings ORDER BY id DESC LIMIT 1", (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
            return res.json({
                campaign_name: 'Chronicles of Shadowmar',
                current_session: 1,
                current_location: 'Xylos - Market Square',
                settings_data: {}
            });
        }

        res.json({
            ...row,
            settings_data: JSON.parse(row.settings_data || '{}')
        });
    });
});

app.put('/api/campaign-settings', authenticateToken, (req, res) => {
    const { campaign_name, current_session, current_location, settings_data } = req.body;

    db.run(`UPDATE campaign_settings SET 
        campaign_name = ?, current_session = ?, current_location = ?, 
        settings_data = ?, updated_at = CURRENT_TIMESTAMP`,
        [campaign_name, current_session, current_location, 
         JSON.stringify(settings_data || {})],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ success: true });
        });
});

// Combat routes
app.get('/api/combat', authenticateToken, (req, res) => {
    db.get("SELECT * FROM combat_state ORDER BY id DESC LIMIT 1", (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
            return res.json({
                active: false,
                initiative_order: [],
                current_turn: 0,
                round_number: 1,
                turn_timer: 30
            });
        }

        res.json({
            ...row,
            initiative_order: JSON.parse(row.initiative_order || '[]')
        });
    });
});

app.put('/api/combat', authenticateToken, (req, res) => {
    const { active, initiative_order, current_turn, round_number, turn_timer } = req.body;

    db.run(`INSERT OR REPLACE INTO combat_state 
        (id, active, initiative_order, current_turn, round_number, turn_timer, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [active, JSON.stringify(initiative_order || []), 
         current_turn || 0, round_number || 1, turn_timer || 30],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ success: true });
        });
});

// Battle map routes
app.get('/api/battle-map', authenticateToken, (req, res) => {
    db.get("SELECT * FROM battle_map ORDER BY id DESC LIMIT 1", (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
            return res.json({
                tokens: [],
                grid_size: 40,
                show_grid: true,
                map_data: {}
            });
        }

        res.json({
            ...row,
            tokens: JSON.parse(row.tokens || '[]'),
            map_data: JSON.parse(row.map_data || '{}')
        });
    });
});

app.put('/api/battle-map', authenticateToken, (req, res) => {
    const { tokens, grid_size, show_grid, map_data } = req.body;

    db.run(`INSERT OR REPLACE INTO battle_map 
        (id, tokens, grid_size, show_grid, map_data, updated_at)
        VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [JSON.stringify(tokens || []), grid_size || 40, 
         show_grid !== false, JSON.stringify(map_data || {})],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ success: true });
        });
});

// Treasure routes
app.get('/api/treasure', authenticateToken, (req, res) => {
    db.all("SELECT * FROM treasure ORDER BY created_at DESC", (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        res.json(rows);
    });
});

app.post('/api/treasure', authenticateToken, [
    body('name').trim().isLength({ min: 1 }).escape(),
    body('description').optional().trim().escape(),
    body('session_number').isInt({ min: 1 }),
    body('value').optional().isInt({ min: 0 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, session_number, value, distributed } = req.body;

    db.run(`INSERT INTO treasure 
        (name, description, session_number, value, distributed)
        VALUES (?, ?, ?, ?, ?)`,
        [name, description || '', session_number, value || 0, distributed || false],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ id: this.lastID, success: true });
        });
});

// User management routes (admin only)
app.get('/api/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    db.all("SELECT id, username, role, created_at, last_login FROM users ORDER BY created_at", 
        (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        res.json(rows);
    });
});

app.post('/api/users', authenticateToken, [
    body('username').trim().isLength({ min: 3 }).escape(),
    body('password').isLength({ min: 6 }),
    body('role').isIn(['admin', 'dm', 'player'])
], (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, password, role } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [username, hashedPassword, role],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ id: this.lastID, success: true });
        });
});

app.delete('/api/users/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    db.run("DELETE FROM users WHERE id = ?", [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true });
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found' });
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT. Graceful shutdown...');
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

app.listen(PORT, () => {
    console.log(`🏴‍☠️ Shadowmar Campaign Manager running on port ${PORT}`);
    console.log(`🌊 Ready to sail the seas of adventure!`);
});
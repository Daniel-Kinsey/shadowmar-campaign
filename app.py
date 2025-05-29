from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
import sqlite3
import hashlib
import uuid
import os
from datetime import datetime
import json
from werkzeug.utils import secure_filename
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx', 'webp'}

# Global state for real-time features
combat_state = {
    'active': False,
    'round': 1,
    'current_turn': 0,
    'combatants': [],
    'initiative_order': []
}

battle_map_state = {
    'width': 30,
    'height': 20,
    'grid_size': 50,
    'tokens': {},
    'fog_of_war': {},
    'background_image': None
}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def init_db():
    conn = sqlite3.connect('shadowmar.db')
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'player',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Characters table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT NOT NULL,
            class TEXT,
            level INTEGER DEFAULT 1,
            hp_current INTEGER DEFAULT 10,
            hp_max INTEGER DEFAULT 10,
            ac INTEGER DEFAULT 10,
            stats TEXT,
            notes TEXT,
            image_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    # Campaign data table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS campaign_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT,
            updated_by TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Messages table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            message TEXT NOT NULL,
            message_type TEXT DEFAULT 'chat',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Files table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            uploaded_by TEXT NOT NULL,
            file_type TEXT,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create default users for testing
    try:
        # Default DM account
        cursor.execute(
            'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
            ('dm', hash_password('password'), 'dm')
        )
        
        # Default player account
        cursor.execute(
            'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
            ('player', hash_password('password'), 'player')
        )
        
        # Add sample campaign data
        cursor.execute(
            'INSERT INTO campaign_data (key, value, updated_by) VALUES (?, ?, ?)',
            ('location', 'The bustling port town of Shadowmar, where pirates gather to plan their next adventure.', 'System')
        )
        
        cursor.execute(
            'INSERT INTO campaign_data (key, value, updated_by) VALUES (?, ?, ?)',
            ('session_notes', 'Session 1: The crew arrived in Shadowmar and met Captain Blackwater at the Rusty Anchor tavern. They learned about the legendary treasure hidden on Skull Island.', 'System')
        )
        
        cursor.execute(
            'INSERT INTO campaign_data (key, value, updated_by) VALUES (?, ?, ?)',
            ('npcs', 'Captain Blackwater - Grizzled pirate captain with knowledge of Skull Island\nTavern Keeper Martha - Friendly but knows everyone\'s secrets\nFirst Mate Rodriguez - Blackwater\'s trusted companion', 'System')
        )
        
        cursor.execute(
            'INSERT INTO campaign_data (key, value, updated_by) VALUES (?, ?, ?)',
            ('treasure', 'Found: 150 gold pieces, Silver compass (magical), Healing potion x2\nLost: Old treasure map (stolen by rival crew)\nQuest: Ancient artifact on Skull Island worth 10,000 gold', 'System')
        )
        
        print("✅ Default accounts created:")
        print("   DM Login: username=dm, password=password")
        print("   Player Login: username=player, password=password")
        
    except sqlite3.IntegrityError:
        # Users already exist, that's fine
        pass
    
    conn.commit()
    conn.close()

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def get_db_connection():
    conn = sqlite3.connect('shadowmar.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        conn = get_db_connection()
        user = conn.execute(
            'SELECT * FROM users WHERE username = ?', (username,)
        ).fetchone()
        conn.close()
        
        if user and user['password_hash'] == hash_password(password):
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['role'] = user['role']
            return jsonify({'success': True, 'role': user['role']})
        else:
            return jsonify({'success': False, 'message': 'Invalid credentials'})
    
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required'})
    
    conn = get_db_connection()
    try:
        conn.execute(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            (username, hash_password(password))
        )
        conn.commit()
        return jsonify({'success': True, 'message': 'User registered successfully'})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'message': 'Username already exists'})
    finally:
        conn.close()

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/api/characters')
def get_characters():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    if session['role'] == 'dm':
        characters = conn.execute(
            'SELECT c.*, u.username FROM characters c JOIN users u ON c.user_id = u.id ORDER BY c.name'
        ).fetchall()
    else:
        characters = conn.execute(
            'SELECT * FROM characters WHERE user_id = ? ORDER BY name',
            (session['user_id'],)
        ).fetchall()
    conn.close()
    
    return jsonify([dict(char) for char in characters])

@app.route('/api/characters', methods=['POST'])
def create_character():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO characters (user_id, name, class, level, hp_current, hp_max, ac, stats, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        session['user_id'],
        data.get('name', ''),
        data.get('class', ''),
        data.get('level', 1),
        data.get('hp_current', 10),
        data.get('hp_max', 10),
        data.get('ac', 10),
        json.dumps(data.get('stats', {})),
        data.get('notes', '')
    ))
    
    char_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    socketio.emit('character_update', {'action': 'create', 'character_id': char_id}, room='campaign')
    
    return jsonify({'success': True, 'character_id': char_id})

@app.route('/api/characters/<int:char_id>', methods=['PUT'])
def update_character(char_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    conn = get_db_connection()
    
    # Check if user owns character or is DM
    character = conn.execute(
        'SELECT user_id FROM characters WHERE id = ?', (char_id,)
    ).fetchone()
    
    if not character or (character['user_id'] != session['user_id'] and session['role'] != 'dm'):
        conn.close()
        return jsonify({'error': 'Permission denied'}), 403
    
    # Update character
    conn.execute('''
        UPDATE characters 
        SET name=?, class=?, level=?, hp_current=?, hp_max=?, ac=?, stats=?, notes=?
        WHERE id=?
    ''', (
        data.get('name', ''),
        data.get('class', ''),
        data.get('level', 1),
        data.get('hp_current', 10),
        data.get('hp_max', 10),
        data.get('ac', 10),
        json.dumps(data.get('stats', {})),
        data.get('notes', ''),
        char_id
    ))
    
    conn.commit()
    conn.close()
    
    socketio.emit('character_update', {
        'action': 'update', 
        'character_id': char_id,
        'updated_by': session['username']
    }, room='campaign')
    
    return jsonify({'success': True})

@app.route('/api/campaign')
def get_campaign_data():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    data = conn.execute('SELECT * FROM campaign_data').fetchall()
    conn.close()
    
    campaign_data = {}
    for row in data:
        try:
            campaign_data[row['key']] = json.loads(row['value'])
        except:
            campaign_data[row['key']] = row['value']
    
    return jsonify(campaign_data)

@app.route('/api/campaign/<key>', methods=['PUT'])
def update_campaign_data(key):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    value = json.dumps(data.get('value'))
    
    conn = get_db_connection()
    conn.execute('''
        INSERT OR REPLACE INTO campaign_data (key, value, updated_by)
        VALUES (?, ?, ?)
    ''', (key, value, session['username']))
    conn.commit()
    conn.close()
    
    socketio.emit('campaign_update', {
        'key': key,
        'value': data.get('value'),
        'updated_by': session['username']
    }, room='campaign')
    
    return jsonify({'success': True})

@app.route('/api/messages')
def get_messages():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    messages = conn.execute(
        'SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100'
    ).fetchall()
    conn.close()
    
    return jsonify([dict(msg) for msg in reversed(messages)])

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if file and allowed_file(file.filename):
        filename = str(uuid.uuid4()) + '_' + secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        conn = get_db_connection()
        conn.execute('''
            INSERT INTO files (filename, original_name, uploaded_by, file_type)
            VALUES (?, ?, ?, ?)
        ''', (
            filename,
            file.filename,
            session['username'],
            file.filename.rsplit('.', 1)[1].lower()
        ))
        conn.commit()
        conn.close()
        
        socketio.emit('file_uploaded', {
            'filename': filename,
            'original_name': file.filename,
            'uploaded_by': session['username']
        }, room='campaign')
        
        return jsonify({'success': True, 'filename': filename})
    
    return jsonify({'error': 'Invalid file type'}), 400

@app.route('/files/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/files')
def get_files():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    files = conn.execute(
        'SELECT * FROM files ORDER BY upload_date DESC'
    ).fetchall()
    conn.close()
    
    return jsonify([dict(file) for file in files])

# Socket.IO events
@socketio.on('connect')
def on_connect():
    if 'username' in session:
        join_room('campaign')
        emit('status', {'msg': f"{session['username']} connected"}, room='campaign')

@socketio.on('disconnect')
def on_disconnect():
    if 'username' in session:
        leave_room('campaign')

@socketio.on('send_message')
def handle_message(data):
    if 'username' not in session:
        return
    
    message = data.get('message', '').strip()
    message_type = data.get('type', 'chat')
    
    if message:
        conn = get_db_connection()
        conn.execute(
            'INSERT INTO messages (username, message, message_type) VALUES (?, ?, ?)',
            (session['username'], message, message_type)
        )
        conn.commit()
        conn.close()
        
        emit('new_message', {
            'username': session['username'],
            'message': message,
            'type': message_type,
            'timestamp': datetime.now().isoformat()
        }, room='campaign')

@socketio.on('dice_roll')
def handle_dice_roll(data):
    if 'username' not in session:
        return
    
    dice = data.get('dice', 'd20')
    modifier = data.get('modifier', 0)
    reason = data.get('reason', '')
    
    import random
    
    # Parse dice notation (e.g., "2d6", "d20")
    if 'd' in dice:
        parts = dice.split('d')
        num_dice = int(parts[0]) if parts[0] else 1
        die_size = int(parts[1])
    else:
        num_dice = 1
        die_size = int(dice)
    
    rolls = [random.randint(1, die_size) for _ in range(num_dice)]
    total = sum(rolls) + modifier
    
    roll_text = f"🎲 {session['username']} rolled {dice}"
    if modifier != 0:
        roll_text += f" {'+' if modifier > 0 else ''}{modifier}"
    if reason:
        roll_text += f" for {reason}"
    roll_text += f": {rolls} = **{total}**"
    
    emit('new_message', {
        'username': 'System',
        'message': roll_text,
        'type': 'roll',
        'timestamp': datetime.now().isoformat()
    }, room='campaign')

# Combat API endpoints
@app.route('/api/combat/state')
def get_combat_state():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Return default combat state for now
    combat_state = {
        'active': False,
        'round': 1,
        'current_turn': 0,
        'combatants': [],
        'initiative_order': []
    }
    return jsonify(combat_state)

@app.route('/api/combat/start', methods=['POST'])
def start_combat():
    if 'user_id' not in session or session.get('role') != 'dm':
        return jsonify({'error': 'Not authorized'}), 403
    
    data = request.get_json()
    combatants = data.get('combatants', [])
    
    combat_state = {
        'active': True,
        'round': 1,
        'current_turn': 0,
        'combatants': sorted(combatants, key=lambda x: x.get('initiative', 0), reverse=True),
        'initiative_order': [c['id'] for c in sorted(combatants, key=lambda x: x.get('initiative', 0), reverse=True)]
    }
    
    socketio.emit('combat_started', combat_state, room='campaign')
    return jsonify({'success': True, 'combat_state': combat_state})

@app.route('/api/combat/end', methods=['POST'])
def end_combat():
    if 'user_id' not in session or session.get('role') != 'dm':
        return jsonify({'error': 'Not authorized'}), 403
    
    socketio.emit('combat_ended', room='campaign')
    return jsonify({'success': True})

@app.route('/api/combat/next-turn', methods=['POST'])
def next_turn():
    if 'user_id' not in session or session.get('role') != 'dm':
        return jsonify({'error': 'Not authorized'}), 403
    
    # Basic next turn logic
    socketio.emit('combat_turn_changed', {'round': 1, 'current_turn': 0}, room='campaign')
    return jsonify({'success': True})

@app.route('/api/combat/update-hp', methods=['POST'])
def update_combat_hp():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    char_id = data.get('character_id')
    new_hp = data.get('hp')
    
    try:
        # Update character HP in database
        conn = get_db_connection()
        conn.execute('UPDATE characters SET hp_current = ? WHERE id = ?', (new_hp, char_id))
        conn.commit()
        conn.close()
        
        socketio.emit('hp_updated', {
            'character_id': char_id,
            'hp': new_hp,
            'updated_by': session['username']
        }, room='campaign')
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# DM Book API endpoints
@app.route('/api/dm/book/<section>')
def get_dm_book_section(section):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Static content for each section
    dm_book_content = {
        'overview': {
            'title': 'World Overview',
            'content': '''<h3>🌊 Chronicles of Shadowmar</h3>
            <p>A seafaring campaign set in the treacherous waters around the mysterious port city of Shadowmar. Here, pirates and adventurers gather to plan their next great voyage, while ancient secrets lurk beneath the waves.</p>
            <div class="dm-secret-box">
                <h4>🔒 DM Secret</h4>
                <p>The true power behind Shadowmar is the ancient Kraken Lord Kythara, sleeping beneath the harbor. The city's prosperity comes from a pact made centuries ago.</p>
            </div>
            <div class="lore-section">
                <h4>Campaign Themes</h4>
                <p>This campaign focuses on maritime adventure, ancient mysteries, and the tension between civilization and the untamed sea.</p>
            </div>'''
        },
        'sessions': {
            'title': 'Session Archive',
            'content': '''<h3>📜 Session Notes</h3>
            <div class="progress-tracker">
                <h4>Campaign Progress</h4>
                <ul>
                    <li>✅ Session 1: Arrival in Shadowmar - The party arrived at the bustling port and met their first contacts</li>
                    <li>🔄 Session 2: The Rusty Anchor Investigation - Currently exploring the tavern's connection to smuggling</li>
                    <li>⏳ Session 3: Journey to Skull Island - Planned expedition to recover the lost treasure</li>
                    <li>⏳ Session 4: The Sunken Temple - Diving into the underwater ruins of Xylos</li>
                </ul>
            </div>
            <div class="lore-section">
                <h4>Key Story Beats</h4>
                <p>The party is slowly uncovering the connection between the recent disappearances and the ancient curse of Xylos.</p>
            </div>'''
        },
        'xylos': {
            'title': 'The Drowned City of Xylos',
            'content': '''<h3>🏛️ The Drowned City</h3>
            <p>Three hundred years ago, the great city of Xylos defied the sea gods and was swallowed by the waves. Now its ruins rest beneath Shadowmar's harbor, filled with treasures and terrors.</p>
            
            <div class="location-grid">
                <div class="location-card">
                    <h4>The Sunken Plaza</h4>
                    <p>Once the heart of the great city, now home to merrow tribes and sahuagin raiders. Ancient statues still stand guard over forgotten secrets.</p>
                </div>
                <div class="location-card">
                    <h4>The Broken Spires</h4>
                    <p>Twisted towers that reach toward the surface, their tops barely visible at low tide. Each contains powerful magical artifacts.</p>
                </div>
                <div class="location-card">
                    <h4>The Throne of Tides</h4>
                    <p>The sunken palace where King Nereon made his final stand. His crown still lies upon his skeletal remains.</p>
                </div>
            </div>
            
            <div class="dm-secret-box">
                <h4>🔒 DM Secret</h4>
                <p>The city can be raised from the depths by reuniting the three Crown Jewels of Xylos, but doing so would anger Kythara the Kraken Lord.</p>
            </div>'''
        },
        'npcs': {
            'title': 'NPCs of Xylos',
            'content': '''<h3>👥 Important Characters</h3>
            
            <div class="npc-card friendly">
                <h3>Captain "Blackwater" Morgan</h3>
                <p><strong>Race:</strong> Human | <strong>Alignment:</strong> Chaotic Neutral</p>
                <p><strong>Role:</strong> Retired pirate captain, now tavern owner</p>
                <p>Grizzled sea captain with knowledge of the ancient ruins beneath Shadowmar. Lost his leg to a sahuagin attack while exploring Xylos. Knows the location of two Crown Jewels.</p>
                <p><strong>Motivation:</strong> Wants revenge against the sea devils but fears awakening greater evils.</p>
            </div>
            
            <div class="npc-card neutral">
                <h3>Martha "The Lighthouse" Brightwater</h3>
                <p><strong>Race:</strong> Halfling | <strong>Alignment:</strong> Lawful Good</p>
                <p><strong>Role:</strong> Tavern keeper at The Rusty Anchor</p>
                <p>Knows everyone's secrets but keeps them... for a price. Her tavern serves as neutral ground for all factions in Shadowmar.</p>
                <p><strong>Motivation:</strong> Maintains the peace and profits from information brokering.</p>
            </div>
            
            <div class="npc-card hostile">
                <h3>High Priestess Thalassa</h3>
                <p><strong>Race:</strong> Sahuagin | <strong>Alignment:</strong> Lawful Evil</p>
                <p><strong>Role:</strong> Leader of the Sunken Plaza sahuagin tribe</p>
                <p>Believes her people are the rightful inheritors of Xylos and seeks to prevent its resurrection. Commands powerful sea magic.</p>
                <p><strong>Motivation:</strong> Protect sahuagin territory and ancient sahuagin artifacts in the ruins.</p>
            </div>'''
        },
        'encounters': {
            'title': 'Encounters & Combat',
            'content': '''<h3>⚔️ Combat Encounters</h3>
            
            <div class="encounter-box">
                <h4>Harbor Ambush (CR 4)</h4>
                <p><strong>Difficulty:</strong> Medium encounter for 4 level-3 characters</p>
                <p><strong>Location:</strong> Shadowmar Harbor docks at night</p>
                <div class="enemy-grid">
                    <div class="enemy-card">
                        <h4>Sahuagin Raiders (3)</h4>
                        <p><strong>HP:</strong> 22 each | <strong>AC:</strong> 12 | <strong>Speed:</strong> 30ft, Swim 40ft</p>
                        <p><strong>Attacks:</strong> Spear +3 (1d6+1), Bite +3 (1d4+1)</p>
                        <p><strong>Special:</strong> Blood Frenzy, Shark Telepathy</p>
                    </div>
                    <div class="enemy-card">
                        <h4>Sahuagin Priestess (1)</h4>
                        <p><strong>HP:</strong> 33 | <strong>AC:</strong> 12 | <strong>Speed:</strong> 30ft, Swim 40ft</p>
                        <p><strong>Spells:</strong> Hold Person, Spiritual Weapon, Cure Wounds</p>
                        <p><strong>Special:</strong> Shark Telepathy, Limited Spellcasting</p>
                    </div>
                </div>
                <p><strong>Tactics:</strong> Priestess casts Hold Person on strongest fighter, raiders focus fire on spellcasters.</p>
            </div>
            
            <div class="encounter-box">
                <h4>Sunken Plaza Exploration (CR 5)</h4>
                <p><strong>Difficulty:</strong> Hard encounter with environmental hazards</p>
                <p><strong>Location:</strong> 60 feet underwater in Xylos ruins</p>
                <div class="enemy-grid">
                    <div class="enemy-card">
                        <h4>Merrow (2)</h4>
                        <p><strong>HP:</strong> 45 each | <strong>AC:</strong> 13</p>
                        <p><strong>Attacks:</strong> Harpoon +6 (2d6+4), Bite +6 (1d8+4)</p>
                    </div>
                    <div class="enemy-card">
                        <h4>Water Weird (1)</h4>
                        <p><strong>HP:</strong> 58 | <strong>AC:</strong> 13</p>
                        <p><strong>Special:</strong> Invisible in water, Constrict, Water Bond</p>
                    </div>
                </div>
                <p><strong>Hazards:</strong> Drowning rules, underwater combat disadvantage, unstable debris</p>
            </div>'''
        },
        'lore': {
            'title': 'World Lore & Secrets',
            'content': '''<h3>📚 Ancient Secrets & Hidden Knowledge</h3>
            
            <div class="lore-section">
                <h4>The Sundering of Xylos</h4>
                <p>Three hundred years ago, King Nereon of Xylos discovered a way to harness the power of the deep ocean currents. His hubris led him to challenge Kythara, the ancient Kraken Lord who ruled the deepest trenches.</p>
                <p>The war lasted seven years. In the end, Kythara called upon the fury of the sea itself, drowning the entire city in a single night. The survivors founded Shadowmar on the cliffs above, swearing never to delve too deeply into the ocean's mysteries.</p>
            </div>
            
            <div class="oracle-box">
                <h4>The Oracle's Prophecy</h4>
                <p><em>"When the blood of kings mingles with the tide, and three crowns unite beneath the waves, the drowned shall rise and the deep shall divide. But beware - he who wakes the sleeping god must pay the ancient price."</em></p>
            </div>
            
            <div class="dm-secret-box">
                <h4>🔒 The True History</h4>
                <p>King Nereon didn't just challenge Kythara - he made a pact with the Kraken Lord. In exchange for power over the seas, he promised to sacrifice his daughter, Princess Nerida. When the time came, he couldn't fulfill his bargain. Kythara's revenge was swift and merciless.</p>
                <p>Princess Nerida still lives, transformed into a sea hag by the curse. She dwells in the deepest part of the ruins, guarding her father's crown and waiting for someone brave enough to break the curse.</p>
            </div>
            
            <div class="lore-section">
                <h4>The Crown Jewels of Xylos</h4>
                <ul>
                    <li><strong>The Pearl of Depths:</strong> Hidden in the Sunken Plaza, grants water breathing</li>
                    <li><strong>The Coral of Storms:</strong> Located in the Broken Spires, controls weather</li>
                    <li><strong>The Crown of Tides:</strong> In the throne room, commands all sea creatures</li>
                </ul>
            </div>'''
        },
        'tools': {
            'title': 'DM Tools & Reference',
            'content': '''<h3>🔧 Quick Reference & Tools</h3>
            
            <div class="dc-table">
                <h4>Difficulty Classes</h4>
                <p><strong>Very Easy:</strong> 5 | <strong>Easy:</strong> 10 | <strong>Medium:</strong> 15 | <strong>Hard:</strong> 20 | <strong>Very Hard:</strong> 25 | <strong>Nearly Impossible:</strong> 30</p>
            </div>
            
            <div class="encounter-table">
                <h4>Random Encounters (Roll d8)</h4>
                <p><strong>1-2:</strong> Merchant vessel flying Shadowmar colors<br>
                <strong>3-4:</strong> Sahuagin patrol (2d4 raiders)<br>
                <strong>5:</strong> Pod of dolphins (friendly, may warn of danger)<br>
                <strong>6:</strong> Mysterious fog bank (visibility drops to 10 feet)<br>
                <strong>7:</strong> Floating debris from Xylos (possible treasure)<br>
                <strong>8:</strong> Sea hag's illusion (appears as distressed sailor)</p>
            </div>
            
            <div class="dc-table">
                <h4>Underwater Rules</h4>
                <p><strong>Breath Holding:</strong> 1 + CON modifier minutes (minimum 30 seconds)<br>
                <strong>Drowning:</strong> 1 round to drop to 0 HP, then death saves<br>
                <strong>Combat:</strong> Disadvantage on attacks without swimming speed<br>
                <strong>Vision:</strong> 60 feet normal, 120 feet in clear water</p>
            </div>
            
            <div class="encounter-table">
                <h4>Treasure Generator (Roll d6)</h4>
                <p><strong>1:</strong> 2d6 × 10 gold pieces in a waterproof pouch<br>
                <strong>2:</strong> Potion of Water Breathing<br>
                <strong>3:</strong> Pearl worth 100gp + ancient Xylosian coin (50gp to collector)<br>
                <strong>4:</strong> Coral sculpture (art object worth 150gp)<br>
                <strong>5:</strong> Scroll of Control Water<br>
                <strong>6:</strong> Fragment of Crown Jewel (plot item)</p>
            </div>
            
            <div class="atmosphere-box">
                <h4>Atmosphere & Descriptions</h4>
                <p><strong>Shadowmar Harbor:</strong> "The salty air carries the sound of creaking ropes and distant sea shanties. Lanterns bob on the waves like fallen stars."</p>
                <p><strong>Diving to Xylos:</strong> "As you descend, the water grows darker and colder. Ancient spires emerge from the gloom like the fingers of a drowned giant."</p>
                <p><strong>Inside the Ruins:</strong> "Phosphorescent algae clings to the walls, casting an eerie blue-green glow. Schools of fish dart between crumbling columns."</p>
            </div>'''
        }
    }
    
    if section in dm_book_content:
        return jsonify(dm_book_content[section])
    else:
        return jsonify({'error': 'Section not found'}), 404

@app.route('/api/dm/book/<section>', methods=['PUT'])
def update_dm_book_section(section):
    if 'user_id' not in session or session.get('role') != 'dm':
        return jsonify({'error': 'Not authorized'}), 403
    
    data = request.get_json()
    title = data.get('title')
    content = data.get('content')
    
    # For now, just return success (you can add database saving later)
    socketio.emit('dm_book_updated', {
        'section': section,
        'title': title,
        'content': content,
        'updated_by': session['username']
    }, room='campaign')
    
    return jsonify({'success': True})

# Battle Map routes
@app.route('/battlemap')
def battlemap():
    """Separate window for battle map display"""
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('battlemap.html')

@app.route('/api/battlemap/state')
def get_battlemap_state():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    battle_map_state = {
        'width': 30,
        'height': 20,
        'grid_size': 50,
        'tokens': {},
        'fog_of_war': {},
        'background_image': None,
        'walls': [],
        'lighting': {},
        'showGrid': True
    }
    return jsonify(battle_map_state)

@app.route('/api/battlemap/move-token', methods=['POST'])
def move_token():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    token_id = data.get('token_id')
    x = data.get('x')
    y = data.get('y')
    
    try:
        # Update character position in database
        conn = get_db_connection()
        conn.execute('UPDATE characters SET token_x = ?, token_y = ? WHERE id = ?', (x, y, token_id))
        conn.commit()
        conn.close()
        
        socketio.emit('token_moved', {
            'token_id': token_id,
            'x': x,
            'y': y,
            'moved_by': session['username']
        }, room='campaign')
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Secret Messages API
@app.route('/api/secret-message', methods=['POST'])
def send_secret_message():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    recipient = data.get('recipient')
    message = data.get('message')
    
    if not recipient or not message:
        return jsonify({'error': 'Recipient and message required'}), 400
    
    # Send to recipient via socket
    socketio.emit('secret_message', {
        'sender': session['username'],
        'message': message,
        'timestamp': datetime.now().isoformat()
    }, room=f'user_{recipient}')
    
    return jsonify({'success': True})

@app.route('/api/secret-messages')
def get_secret_messages():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Return empty list for now (you can add database storage later)
    return jsonify([])

# Add these socket events to your existing socket handlers
@socketio.on('join_battlemap')
def on_join_battlemap():
    if 'username' in session:
        join_room('battlemap')
        emit('battlemap_state', {
            'width': 30,
            'height': 20,
            'grid_size': 50,
            'tokens': {},
            'showGrid': True
        })

@socketio.on('leave_battlemap')
def on_leave_battlemap():
    if 'username' in session:
        leave_room('battlemap')

if __name__ == '__main__':
    init_db()
    # Use port from environment variable or default to 5000
    port = int(os.environ.get('PORT', 5000))
    
    # Production-safe configuration
    debug_mode = os.environ.get('FLASK_ENV') == 'development'
    socketio.run(app, debug=debug_mode, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)

from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
import sqlite3
import hashlib
import uuid
import os
from datetime import datetime
import json
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

socketio = SocketIO(app, cors_allowed_origins="*")

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx'}

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

# Campaign Book/Vault routes
@app.route('/api/dm/book/<section>')
def get_dm_book_section(section):
    """Get DM book section content"""
    # Check if user is logged in and is DM
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    if session.get('role') != 'dm':
        return jsonify({'error': 'DM privileges required'}), 403
    
    try:
        # Define the comprehensive DM book content
        book_content = {
            'overview': {
                'title': 'World Overview: Shadowmar',
                'content': '''
                <h2>The Chronicles of Shadowmar Campaign</h2>
                <p><strong>Core Concept:</strong> A world shrouded in perpetual twilight, where the sun and moon are rarely seen, and the stars shine with an eerie intensity.</p>
                
                <h3>Campaign Summary</h3>
                <ul>
                    <li><strong>Theme:</strong> Pirate adventure in a twilight world</li>
                    <li><strong>Current Objective:</strong> Journey to the Drowned City (Xylos)</li>
                    <li><strong>Party Status:</strong> Heroes of Ironwood Isle</li>
                    <li><strong>Ship:</strong> The Shadowchaser II (upgraded vessel)</li>
                    <li><strong>Treasure:</strong> 5,000 gp starting funds</li>
                </ul>

                <h3>The Four Weavers of Shadowmar</h3>
                <p>From the primordial Void emerged four powerful beings who shaped this world:</p>
                <ul>
                    <li><strong>The Weaver of Stars:</strong> Spun threads of light, creating celestial bodies</li>
                    <li><strong>The Weaver of Worlds:</strong> Forged the physical lands with hidden secrets</li>
                    <li><strong>The Weaver of Life:</strong> Breathed life into all creatures</li>
                    <li><strong>The Weaver of Dreams:</strong> Wove dreams and visions, guiding souls</li>
                </ul>
                '''
            },
            'sessions': {
                'title': 'Session Archive',
                'content': '''
                <h2>Session 1: The Storm's Fury</h2>
                <p><strong>Status:</strong> ✅ Completed</p>
                
                <h3>The Crisis</h3>
                <p>Ghost ships appeared on the horizon near Ironwood Isle, followed by a devastating tidal wave threatening Dawnhaven harbor.</p>
                
                <h3>Resolution & Rewards</h3>
                <ul>
                    <li>✅ Storm Shard destroyed</li>
                    <li>✅ Ironwood Isle saved</li>
                    <li>💰 5,000 gp reward</li>
                    <li>🚢 Larger ship acquired</li>
                    <li>🗺️ Treasure map to Drowned City found</li>
                </ul>
                '''
            }
        }
        
        if section not in book_content:
            return jsonify({'error': 'Section not found'}), 404
            
        return jsonify(book_content[section])
    except Exception as error:
        return jsonify({'error': 'Failed to load book section'}), 500

if __name__ == '__main__':
    init_db()
    # Use port from environment variable or default to 5000
    port = int(os.environ.get('PORT', 5000))
    
    # Production-safe configuration
    debug_mode = os.environ.get('FLASK_ENV') == 'development'
    socketio.run(app, debug=debug_mode, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)

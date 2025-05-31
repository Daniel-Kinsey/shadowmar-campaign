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

# Production-ready configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Upload configuration
UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

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
    'background_image': None,
    'walls': [],
    'lighting': {},
    'showGrid': True
}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def update_character_schema():
    """Update characters table with full D&D character sheet fields"""
    conn = sqlite3.connect('shadowmar.db')
    cursor = conn.cursor()
    
    # Get existing columns
    cursor.execute("PRAGMA table_info(characters)")
    existing_columns = [column[1] for column in cursor.fetchall()]
    
    # Add new columns for full character sheet
    new_columns = [
        ('race', 'TEXT DEFAULT ""'),
        ('background', 'TEXT DEFAULT ""'),
        ('alignment', 'TEXT DEFAULT ""'),
        ('strength', 'INTEGER DEFAULT 10'),
        ('dexterity', 'INTEGER DEFAULT 10'),
        ('constitution', 'INTEGER DEFAULT 10'),
        ('intelligence', 'INTEGER DEFAULT 10'),
        ('wisdom', 'INTEGER DEFAULT 10'),
        ('charisma', 'INTEGER DEFAULT 10'),
        ('proficiency_bonus', 'INTEGER DEFAULT 2'),
        ('inspiration', 'INTEGER DEFAULT 0'),
        ('skills', 'TEXT DEFAULT "{}"'),
        ('saving_throws', 'TEXT DEFAULT "{}"'),
        ('languages', 'TEXT DEFAULT ""'),
        ('proficiencies', 'TEXT DEFAULT ""'),
        ('equipment', 'TEXT DEFAULT ""'),
        ('features_traits', 'TEXT DEFAULT ""'),
        ('attacks_spells', 'TEXT DEFAULT ""'),
        ('personality_traits', 'TEXT DEFAULT ""'),
        ('ideals', 'TEXT DEFAULT ""'),
        ('bonds', 'TEXT DEFAULT ""'),
        ('flaws', 'TEXT DEFAULT ""'),
        ('speed', 'INTEGER DEFAULT 30'),
        ('token_x', 'INTEGER DEFAULT 0'),
        ('token_y', 'INTEGER DEFAULT 0'),
        ('initiative', 'INTEGER DEFAULT 0'),
        ('in_combat', 'BOOLEAN DEFAULT FALSE'),
        ('status_effects', 'TEXT DEFAULT "[]"'),
        ('spell_slots', 'TEXT DEFAULT "{}"')
    ]
    
    for column_name, column_def in new_columns:
        if column_name not in existing_columns:
            try:
                cursor.execute(f'ALTER TABLE characters ADD COLUMN {column_name} {column_def}')
                print(f"Added column: {column_name}")
            except sqlite3.OperationalError as e:
                print(f"Error adding column {column_name}: {e}")
    
    conn.commit()
    conn.close()
    print("✅ Character schema updated!")

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
    
    # Enhanced Characters table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT NOT NULL,
            class TEXT DEFAULT "",
            race TEXT DEFAULT "",
            background TEXT DEFAULT "",
            level INTEGER DEFAULT 1,
            alignment TEXT DEFAULT "",
            hp_current INTEGER DEFAULT 10,
            hp_max INTEGER DEFAULT 10,
            ac INTEGER DEFAULT 10,
            speed INTEGER DEFAULT 30,
            initiative INTEGER DEFAULT 0,
            strength INTEGER DEFAULT 10,
            dexterity INTEGER DEFAULT 10,
            constitution INTEGER DEFAULT 10,
            intelligence INTEGER DEFAULT 10,
            wisdom INTEGER DEFAULT 10,
            charisma INTEGER DEFAULT 10,
            proficiency_bonus INTEGER DEFAULT 2,
            inspiration INTEGER DEFAULT 0,
            skills TEXT DEFAULT "{}",
            saving_throws TEXT DEFAULT "{}",
            languages TEXT DEFAULT "",
            proficiencies TEXT DEFAULT "",
            equipment TEXT DEFAULT "",
            features_traits TEXT DEFAULT "",
            attacks_spells TEXT DEFAULT "",
            personality_traits TEXT DEFAULT "",
            ideals TEXT DEFAULT "",
            bonds TEXT DEFAULT "",
            flaws TEXT DEFAULT "",
            stats TEXT DEFAULT "{}",
            notes TEXT DEFAULT "",
            image_url TEXT,
            token_x INTEGER DEFAULT 0,
            token_y INTEGER DEFAULT 0,
            in_combat BOOLEAN DEFAULT FALSE,
            status_effects TEXT DEFAULT "[]",
            spell_slots TEXT DEFAULT "{}",
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
    
    # Secret messages table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secret_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            recipient TEXT NOT NULL,
            message TEXT NOT NULL,
            read_status BOOLEAN DEFAULT FALSE,
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
    
    # DM Book content table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS dm_book (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            updated_by TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Battle map state table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS battle_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            map_data TEXT NOT NULL,
            updated_by TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create default users for testing (only in development)
    if os.environ.get('FLASK_ENV') != 'production':
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
    
    # Update character schema for existing databases
    update_character_schema()

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def get_db_connection():
    conn = sqlite3.connect('shadowmar.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/health')
def health_check():
    """Health check endpoint for monitoring"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()}), 200

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')

@app.route('/battlemap')
def battlemap():
    """Separate window for battle map display"""
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('battlemap.html')

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

# Enhanced Character API endpoints
@app.route('/api/characters')
def get_characters():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    try:
        if session['role'] == 'dm':
            characters = conn.execute(
                'SELECT c.*, u.username FROM characters c JOIN users u ON c.user_id = u.id ORDER BY c.name'
            ).fetchall()
        else:
            characters = conn.execute(
                'SELECT * FROM characters WHERE user_id = ? ORDER BY name',
                (session['user_id'],)
            ).fetchall()
        
        # Add user_id to character data for permission checking
        result = []
        for char in characters:
            char_dict = dict(char)
            # Ensure user_id is included for permission checks in frontend
            if 'user_id' not in char_dict and session['role'] != 'dm':
                char_dict['user_id'] = session['user_id']
            result.append(char_dict)
        
        return jsonify(result)
    except Exception as e:
        print(f"Error loading characters: {e}")
        return jsonify({'error': 'Failed to load characters'}), 500
    finally:
        conn.close()

@app.route('/api/characters', methods=['POST'])
def create_character():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Enhanced character creation with all fields
        cursor.execute('''
            INSERT INTO characters (
                user_id, name, class, race, background, level, alignment,
                hp_current, hp_max, ac, speed, initiative,
                strength, dexterity, constitution, intelligence, wisdom, charisma,
                proficiency_bonus, inspiration, 
                skills, saving_throws, languages, proficiencies,
                equipment, features_traits, attacks_spells,
                personality_traits, ideals, bonds, flaws,
                stats, spell_slots, status_effects, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            session['user_id'],
            data.get('name', ''),
            data.get('class', ''),
            data.get('race', ''),
            data.get('background', ''),
            data.get('level', 1),
            data.get('alignment', ''),
            data.get('hp_current', 10),
            data.get('hp_max', 10),
            data.get('ac', 10),
            data.get('speed', 30),
            data.get('initiative', 0),
            data.get('strength', 10),
            data.get('dexterity', 10),
            data.get('constitution', 10),
            data.get('intelligence', 10),
            data.get('wisdom', 10),
            data.get('charisma', 10),
            data.get('proficiency_bonus', 2),
            data.get('inspiration', 0),
            json.dumps(data.get('skills', {})),
            json.dumps(data.get('saving_throws', {})),
            data.get('languages', ''),
            data.get('proficiencies', ''),
            data.get('equipment', ''),
            data.get('features_traits', ''),
            data.get('attacks_spells', ''),
            data.get('personality_traits', ''),
            data.get('ideals', ''),
            data.get('bonds', ''),
            data.get('flaws', ''),
            json.dumps(data.get('stats', {})),
            json.dumps(data.get('spell_slots', {})),
            json.dumps(data.get('status_effects', [])),
            data.get('notes', '')
        ))
        
        char_id = cursor.lastrowid
        conn.commit()
        
        socketio.emit('character_update', {'action': 'create', 'character_id': char_id}, room='campaign')
        
        return jsonify({'success': True, 'character_id': char_id})
    except Exception as e:
        print(f"Error creating character: {e}")
        return jsonify({'error': 'Failed to create character'}), 500
    finally:
        conn.close()

@app.route('/api/characters/<int:char_id>', methods=['PUT'])
def update_character(char_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    conn = get_db_connection()
    
    try:
        # Check if user owns character or is DM
        character = conn.execute(
            'SELECT user_id FROM characters WHERE id = ?', (char_id,)
        ).fetchone()
        
        if not character or (character['user_id'] != session['user_id'] and session['role'] != 'dm'):
            return jsonify({'error': 'Permission denied'}), 403
        
        # Update character with all fields
        conn.execute('''
            UPDATE characters 
            SET name=?, class=?, race=?, background=?, level=?, alignment=?,
                hp_current=?, hp_max=?, ac=?, speed=?, initiative=?,
                strength=?, dexterity=?, constitution=?, intelligence=?, wisdom=?, charisma=?,
                proficiency_bonus=?, inspiration=?, skills=?, saving_throws=?,
                languages=?, proficiencies=?, equipment=?, features_traits=?, attacks_spells=?,
                personality_traits=?, ideals=?, bonds=?, flaws=?, stats=?, spell_slots=?, status_effects=?, notes=?
            WHERE id=?
        ''', (
            data.get('name', ''),
            data.get('class', ''),
            data.get('race', ''),
            data.get('background', ''),
            data.get('level', 1),
            data.get('alignment', ''),
            data.get('hp_current', 10),
            data.get('hp_max', 10),
            data.get('ac', 10),
            data.get('speed', 30),
            data.get('initiative', 0),
            data.get('strength', 10),
            data.get('dexterity', 10),
            data.get('constitution', 10),
            data.get('intelligence', 10),
            data.get('wisdom', 10),
            data.get('charisma', 10),
            data.get('proficiency_bonus', 2),
            data.get('inspiration', 0),
            json.dumps(data.get('skills', {})),
            json.dumps(data.get('saving_throws', {})),
            data.get('languages', ''),
            data.get('proficiencies', ''),
            data.get('equipment', ''),
            data.get('features_traits', ''),
            data.get('attacks_spells', ''),
            data.get('personality_traits', ''),
            data.get('ideals', ''),
            data.get('bonds', ''),
            data.get('flaws', ''),
            json.dumps(data.get('stats', {})),
            json.dumps(data.get('spell_slots', {})),
            json.dumps(data.get('status_effects', [])),
            data.get('notes', ''),
            char_id
        ))
        
        conn.commit()
        
        socketio.emit('character_update', {
            'action': 'update', 
            'character_id': char_id,
            'updated_by': session['username'],
            'data': data
        }, room='campaign')
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error updating character: {e}")
        return jsonify({'error': 'Failed to update character'}), 500
    finally:
        conn.close()

@app.route('/api/characters/<int:char_id>', methods=['DELETE'])
def delete_character(char_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    
    try:
        # Check if user owns character or is DM
        character = conn.execute(
            'SELECT user_id, name FROM characters WHERE id = ?', (char_id,)
        ).fetchone()
        
        if not character:
            return jsonify({'error': 'Character not found'}), 404
        
        if character['user_id'] != session['user_id'] and session['role'] != 'dm':
            return jsonify({'error': 'Permission denied'}), 403
        
        # Delete the character
        conn.execute('DELETE FROM characters WHERE id = ?', (char_id,))
        conn.commit()
        
        socketio.emit('character_update', {
            'action': 'delete', 
            'character_id': char_id,
            'character_name': character['name'],
            'deleted_by': session['username']
        }, room='campaign')
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error deleting character: {e}")
        return jsonify({'error': 'Failed to delete character'}), 500
    finally:
        conn.close()

@app.route('/api/characters/<int:char_id>/sheet')
def get_character_sheet(char_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    try:
        character = conn.execute(
            'SELECT c.*, u.username FROM characters c JOIN users u ON c.user_id = u.id WHERE c.id = ?', 
            (char_id,)
        ).fetchone()
        
        if not character:
            return jsonify({'error': 'Character not found'}), 404
        
        # Check permissions (owner or DM)
        if character['user_id'] != session['user_id'] and session['role'] != 'dm':
            return jsonify({'error': 'Permission denied'}), 403
        
        # Convert to dict and parse JSON fields
        char_data = dict(character)
        try:
            char_data['skills'] = json.loads(character['skills']) if character['skills'] else {}
            char_data['saving_throws'] = json.loads(character['saving_throws']) if character['saving_throws'] else {}
            char_data['spell_slots'] = json.loads(character['spell_slots']) if character['spell_slots'] else {}
            char_data['status_effects'] = json.loads(character['status_effects']) if character['status_effects'] else []
            char_data['stats'] = json.loads(character['stats']) if character['stats'] else {}
        except:
            # Handle malformed JSON
            char_data['skills'] = {}
            char_data['saving_throws'] = {}
            char_data['spell_slots'] = {}
            char_data['status_effects'] = []
            char_data['stats'] = {}
        
        return jsonify(char_data)
    except Exception as e:
        print(f"Error loading character sheet: {e}")
        return jsonify({'error': 'Failed to load character sheet'}), 500
    finally:
        conn.close()

# Combat API endpoints
@app.route('/api/combat/state')
def get_combat_state():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    return jsonify(combat_state)

@app.route('/api/combat/start', methods=['POST'])
def start_combat():
    if 'user_id' not in session or session.get('role') != 'dm':
        return jsonify({'error': 'Not authorized'}), 403
    
    data = request.get_json()
    combatants = data.get('combatants', [])
    
    global combat_state
    combat_state = {
        'active': True,
        'round': 1,
        'current_turn': 0,
        'combatants': sorted(combatants, key=lambda x: x.get('initiative', 0), reverse=True),
        'initiative_order': [c['id'] for c in sorted(combatants, key=lambda x: x.get('initiative', 0), reverse=True)]
    }
    
    # Update characters in combat status
    conn = get_db_connection()
    try:
        for combatant in combatants:
            if combatant.get('type') == 'character':
                conn.execute(
                    'UPDATE characters SET in_combat = ?, initiative = ? WHERE id = ?',
                    (True, combatant.get('initiative', 0), combatant['id'])
                )
        conn.commit()
        
        socketio.emit('combat_started', combat_state, room='campaign')
        return jsonify({'success': True, 'combat_state': combat_state})
    except Exception as e:
        print(f"Error starting combat: {e}")
        return jsonify({'error': 'Failed to start combat'}), 500
    finally:
        conn.close()

@app.route('/api/combat/end', methods=['POST'])
def end_combat():
    if 'user_id' not in session or session.get('role') != 'dm':
        return jsonify({'error': 'Not authorized'}), 403
    
    global combat_state
    combat_state = {
        'active': False,
        'round': 1,
        'current_turn': 0,
        'combatants': [],
        'initiative_order': []
    }
    
    # Update characters out of combat
    conn = get_db_connection()
    try:
        conn.execute('UPDATE characters SET in_combat = ? WHERE in_combat = ?', (False, True))
        conn.commit()
        
        socketio.emit('combat_ended', room='campaign')
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error ending combat: {e}")
        return jsonify({'error': 'Failed to end combat'}), 500
    finally:
        conn.close()

@app.route('/api/combat/next-turn', methods=['POST'])
def next_turn():
    if 'user_id' not in session or session.get('role') != 'dm':
        return jsonify({'error': 'Not authorized'}), 403
    
    global combat_state
    if combat_state['active']:
        combat_state['current_turn'] = (combat_state['current_turn'] + 1) % len(combat_state['combatants'])
        if combat_state['current_turn'] == 0:
            combat_state['round'] += 1
    
    socketio.emit('combat_turn_changed', combat_state, room='campaign')
    return jsonify({'success': True, 'combat_state': combat_state})

@app.route('/api/combat/update-hp', methods=['POST'])
def update_combat_hp():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    char_id = data.get('character_id')
    new_hp = data.get('hp')
    
    # Check permissions
    conn = get_db_connection()
    try:
        character = conn.execute(
            'SELECT user_id FROM characters WHERE id = ?', (char_id,)
        ).fetchone()
        
        if not character or (character['user_id'] != session['user_id'] and session['role'] != 'dm'):
            return jsonify({'error': 'Permission denied'}), 403
        
        # Update HP
        conn.execute(
            'UPDATE characters SET hp_current = ? WHERE id = ?',
            (new_hp, char_id)
        )
        conn.commit()
        
        socketio.emit('hp_updated', {
            'character_id': char_id,
            'hp': new_hp,
            'updated_by': session['username']
        }, room='campaign')
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error updating HP: {e}")
        return jsonify({'error': 'Failed to update HP'}), 500
    finally:
        conn.close()

# Battle Map API endpoints
@app.route('/api/battlemap/state')
def get_battlemap_state():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    return jsonify(battle_map_state)

@app.route('/api/battlemap/move-token', methods=['POST'])
def move_token():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    token_id = data.get('token_id')
    x = data.get('x')
    y = data.get('y')
    
    # Check if user can move this token (own character or DM)
    can_move = session['role'] == 'dm'
    if not can_move:
        conn = get_db_connection()
        try:
            character = conn.execute(
                'SELECT user_id FROM characters WHERE id = ?', (token_id,)
            ).fetchone()
            can_move = character and character['user_id'] == session['user_id']
        finally:
            conn.close()
    
    if not can_move:
        return jsonify({'error': 'Permission denied'}), 403
    
    # Update token position
    battle_map_state['tokens'][str(token_id)] = {'x': x, 'y': y}
    
    # Update character position in database
    conn = get_db_connection()
    try:
        conn.execute(
            'UPDATE characters SET token_x = ?, token_y = ? WHERE id = ?',
            (x, y, token_id)
        )
        conn.commit()
        
        socketio.emit('token_moved', {
            'token_id': token_id,
            'x': x,
            'y': y,
            'moved_by': session['username']
        }, room='campaign')
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error moving token: {e}")
        return jsonify({'error': 'Failed to move token'}), 500
    finally:
        conn.close()

# DM Book API endpoints
@app.route('/api/dm/book/<section>')
def get_dm_book_section(section):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Static content for each section
   # Replace the dm_book_content dictionary in your get_dm_book_section function with this:

dm_book_content = {
    'overview': {
        'title': 'Chronicles of Shadowmar - Campaign Overview',
        'content': '''<h3>🌊 Chronicles of Shadowmar</h3>
        <p><strong>Campaign Length:</strong> 20-24 sessions (approximately 6-8 months of weekly play)<br>
        <strong>Starting Level:</strong> 5th level<br>
        <strong>Ending Level:</strong> 15th level<br>
        <strong>Themes:</strong> Cosmic responsibility, redemption, balance, maritime adventure<br>
        <strong>Tone:</strong> Epic fantasy with cosmic horror elements and moral complexity</p>
        
        <div class="lore-section">
            <h4>Core Concepts</h4>
            <p><strong>The Twilight World:</strong> Shadowmar exists in perpetual twilight, neither fully day nor night. Bioluminescent life provides most illumination, creating a world of ethereal beauty and hidden dangers.</p>
            <p><strong>Naval Focus:</strong> This campaign centers around maritime adventure. Players begin with their own ship, the Shadowchaser, and much of the action takes place on or near water.</p>
            <p><strong>Cosmic Stakes:</strong> While beginning with local concerns, the campaign gradually reveals cosmic implications. Players discover they're part of an ancient conflict between forces of creation (the Weavers) and entropy (the Void).</p>
        </div>
        
        <div class="dm-secret-box">
            <h4>🔒 DM Secret - Campaign Structure</h4>
            <p><strong>Act I: The Awakening Waters (Sessions 1-7, Levels 5-7)</strong> - Players establish themselves as heroes while uncovering the mystery of Xylos's decay.</p>
            <p><strong>Act II: The Scattered Threads (Sessions 8-12, Levels 8-12)</strong> - The scope expands as players hunt for the remaining Weaver Tools while fighting an escalating war against the Shadow Court.</p>
            <p><strong>Act III: The Final Weaving (Sessions 13-24, Levels 13-15)</strong> - Cosmic forces awaken, reality itself becomes malleable, and players must choose how to reshape existence.</p>
        </div>'''
    },
    
    'sessions': {
        'title': 'Session Guide & Progress',
        'content': '''<h3>📜 Session Archive & Planning</h3>
        
        <div class="progress-tracker">
            <h4>Act I: The Awakening Waters (Levels 5-7)</h4>
            <ul>
                <li><strong>Sessions 1-2: Journey to Xylos</strong> - Introduction to the setting and travel to the underwater city</li>
                <li><strong>Session 3: The Heart of Shadows</strong> - The Whispering Library dungeon and first seal</li>
                <li><strong>Session 4: Songs in the Deep</strong> - Musical puzzles and the Resonating Cavern</li>
                <li><strong>Session 5: The Forge of Hope</strong> - Social encounters in the Glimmering Slums</li>
                <li><strong>Session 6: The Oracle's Truth</strong> - Revelation of cosmic stakes and greater mystery</li>
                <li><strong>Session 7: The Queen's Gambit</strong> - Political climax and transition to greater conflicts</li>
            </ul>
        </div>
        
        <div class="progress-tracker">
            <h4>Act II: The Scattered Threads (Levels 8-12)</h4>
            <ul>
                <li><strong>Session 8: Shadows on the Horizon</strong> - First major battle against Shadow Court</li>
                <li><strong>Session 9: The Frozen Loom</strong> - Journey north to claim the Stellar Loom</li>
                <li><strong>Session 10: Dreams and Nightmares</strong> - Psychological dungeon and Dream Anchor</li>
                <li><strong>Session 11: The Living Forge</strong> - Journey to the Underforge and Life Forge</li>
                <li><strong>Session 12: The Seeds of Worlds</strong> - Final tool and ultimate stakes revelation</li>
            </ul>
        </div>
        
        <div class="progress-tracker">
            <h4>Act III: The Final Weaving (Levels 13-15)</h4>
            <ul>
                <li><strong>Sessions 13-15: The Shadow Court's Gambit</strong> - Three-front war and escalating cosmic stakes</li>
                <li><strong>Sessions 16-18: The Weaver's Awakening</strong> - Cosmic entities enter the conflict</li>
                <li><strong>Sessions 19-21: The Grand Confluence</strong> - Reality-shaping ritual and ultimate choice</li>
                <li><strong>Sessions 22-24: New Beginnings</strong> - Aftermath and establishment of new reality</li>
            </ul>
        </div>
        
        <div class="dm-secret-box">
            <h4>🔒 DM Notes</h4>
            <p>Every major plot point can be influenced by player choices. The campaign features multiple possible endings based on the party's decisions, moral stance, and relationships with key NPCs.</p>
        </div>'''
    },
    
    'xylos': {
        'title': 'The Underwater City of Xylos',
        'content': '''<h3>🏛️ Queen Thalassa's Domain</h3>
        <p>Xylos exists in perpetual twilight beneath the waves, its bioluminescent architecture pulsing with rhythmic light. The city serves as the players' first major hub and represents the themes of decay, hope, and renewal that run throughout the campaign.</p>
        
        <div class="location-grid">
            <div class="location-card">
                <h4>The Grand Palace</h4>
                <p>Queen Thalassa's coral palace, where the campaign's political heart beats. Here players make their first important diplomatic choices and learn about the cosmic stakes.</p>
            </div>
            <div class="location-card">
                <h4>The Whispering Library</h4>
                <p>A five-level dungeon representing different eras of Xylos's history. Contains the first seal and crucial Weaver lore. Knowledge literally fades from the books as corruption spreads.</p>
            </div>
            <div class="location-card">
                <h4>The Resonating Cavern</h4>
                <p>Cathedral-sized cavern with floating crystals that once sang with cosmic harmony. Now fallen silent, it holds the second seal and tests the party's musical cooperation.</p>
            </div>
            <div class="location-card">
                <h4>The Glimmering Slums</h4>
                <p>The city's underbelly where hope seems scarce but innovation thrives. Contains the Heart's Forge and represents the campaign's themes of community and renewal.</p>
            </div>
        </div>
        
        <div class="dm-secret-box">
            <h4>🔒 The Three Seals</h4>
            <p>Xylos is protected by three mystical seals that regulate the city's life force. Restoring all three is required to purify the first Weaver Tool and unlock Queen Thalassa's full power.</p>
            <p><strong>First Seal:</strong> Whispering Library - requires personal truth from each player</p>
            <p><strong>Second Seal:</strong> Resonating Cavern - requires musical harmony and cooperation</p>
            <p><strong>Third Seal:</strong> Heart's Forge - requires community support and sacrifice</p>
        </div>
        
        <div class="oracle-box">
            <h4>Environmental Effects</h4>
            <p><strong>Bioluminescent Lighting:</strong> Bright light in populated areas, dim in abandoned sections, darkness in corrupted zones</p>
            <p><strong>Aquatic Environment:</strong> All areas are water-filled but magically breathable</p>
            <p><strong>Decay Zones:</strong> Areas where corruption causes life drain and reality instability</p>
        </div>'''
    },
    
    'npcs': {
        'title': 'Major NPCs',
        'content': '''<h3>👥 Key Characters of the Campaign</h3>
        
        <div class="npc-card friendly">
            <h3>Queen Thalassa of Xylos</h3>
            <p><strong>Race:</strong> Triton | <strong>Alignment:</strong> Lawful Good | <strong>Role:</strong> Ruler and Key Ally</p>
            <p>The wise and compassionate ruler of the underwater city. Her brother's corruption and the city's decay have tested her resolve, but she remains committed to finding solutions that benefit all of Shadowmar.</p>
            <p><strong>Personality:</strong> Formal dignity with genuine warmth, always considers others before herself</p>
            <p><strong>Arc:</strong> Grows from cautious leader to confident cosmic ally as Xylos is restored</p>
        </div>
        
        <div class="npc-card friendly">
            <h3>Elder Kaelen</h3>
            <p><strong>Race:</strong> Triton | <strong>Alignment:</strong> Lawful Neutral | <strong>Role:</strong> Lore Keeper</p>
            <p>The oldest member of Xylos's council who remembers fragments of the time before the Great Dimming. His knowledge of ancient lore makes him invaluable for understanding Weaver magic.</p>
            <p><strong>Personality:</strong> Speaks in metaphors, patient but intolerant of willful ignorance</p>
        </div>
        
        <div class="npc-card friendly">
            <h3>Captain Blackwood</h3>
            <p><strong>Race:</strong> Human | <strong>Alignment:</strong> Lawful Good | <strong>Role:</strong> Surface World Contact</p>
            <p>A career naval officer representing the best of surface world leadership. Practical, honorable, and focused on protecting civilian vessels and maritime trade.</p>
            <p><strong>Personality:</strong> Direct and practical, dry humor in crisis situations</p>
        </div>
        
        <div class="npc-card hostile">
            <h3>Archon Malachar (Queen's Brother)</h3>
            <p><strong>Race:</strong> Triton | <strong>Alignment:</strong> Chaotic Evil | <strong>Role:</strong> Primary Antagonist</p>
            <p>Once Queen Thalassa's beloved brother, corrupted by Void energy during an attempt to solve the city's decay. Becomes more powerful and less human as the campaign progresses.</p>
            <p><strong>Corruption Arc:</strong> Starts recognizable, ends as barely triton. Redemption remains possible but increasingly difficult.</p>
        </div>
        
        <div class="npc-card hostile">
            <h3>Supreme Commander Vex'ahlia</h3>
            <p><strong>Race:</strong> Human | <strong>Alignment:</strong> Chaotic Evil | <strong>Role:</strong> Ultimate Enemy</p>
            <p>The Shadow Court's ultimate leader, once a brilliant mage who sought to transcend mortality. Complete corruption makes her a perfect conduit for the Unweaver's will.</p>
            <p><strong>Philosophy:</strong> Views existence as a cosmic mistake that must be corrected</p>
        </div>
        
        <div class="npc-card neutral">
            <h3>The Oracle of the Deep</h3>
            <p><strong>Race:</strong> Ancient Aboleth | <strong>Alignment:</strong> Lawful Neutral | <strong>Role:</strong> Information Source</p>
            <p>An ancient being that transcended its species' evil through eons of contemplation. Provides cosmic knowledge through riddles and metaphors.</p>
            <p><strong>Communication:</strong> Telepathic images, references multiple timelines, treats all mortals with distant benevolence</p>
        </div>
        
        <div class="dm-secret-box">
            <h4>🔒 The Four Weavers</h4>
            <p><strong>Weaver of Stars:</strong> Cosmic order and celestial mechanics</p>
            <p><strong>Weaver of Worlds:</strong> Physical matter and planetary systems</p>
            <p><strong>Weaver of Life:</strong> Biological systems and spiritual growth</p>
            <p><strong>Weaver of Dreams:</strong> Consciousness and possibility</p>
            <p>These cosmic entities emerge in Act III to offer players the choice between ascension and remaining mortal guardians.</p>
        </div>'''
    },
    
    'encounters': {
        'title': 'Key Encounters & Combat',
        'content': '''<h3>⚔️ Major Combat Encounters</h3>
        
        <div class="encounter-box">
            <h4>The Whispering Library (Session 3)</h4>
            <p><strong>Challenge:</strong> Five-level dungeon with increasing difficulty</p>
            <p><strong>Level 1:</strong> Book Wraiths (CR 2) - spirits of fading knowledge</p>
            <p><strong>Level 3:</strong> Living Bookshelves (CR 3) - animated furniture protecting texts</p>
            <p><strong>Level 4:</strong> Echo Scholars (CR 4) - obsessed with cataloging everything</p>
            <p><strong>Boss:</strong> Keeper of Lost Words (CR 9) - massive creature guarding ancient secrets</p>
            <p><strong>Special:</strong> Alternative resolution through communication and respect for knowledge</p>
        </div>
        
        <div class="encounter-box">
            <h4>The Discordant Maestro (Session 4)</h4>
            <p><strong>Challenge:</strong> Musical encounter requiring cooperation over combat</p>
            <p><strong>Boss:</strong> Corrupted Triton Maestro (CR 8) driven mad by maintaining city's harmony alone</p>
            <p><strong>Environment:</strong> Floating crystals, perfect acoustics, sonic hazards</p>
            <p><strong>Victory Condition:</strong> Restore sanity through collaborative musical performance</p>
            <p><strong>Failure:</strong> Combat encounter but maestro can still be saved with healing magic</p>
        </div>
        
        <div class="encounter-box">
            <h4>Lady Morphia's Nightmare Realm (Session 10)</h4>
            <p><strong>Challenge:</strong> Psychological dungeon with personalized horror chambers</p>
            <p><strong>Mechanics:</strong> Each player faces chambers tailored to their character's fears</p>
            <p><strong>Boss:</strong> Lady Morphia (CR 13) in reality-warping chamber</p>
            <p><strong>Environment:</strong> Dream logic, shifting reality, emotional resonance effects</p>
            <p><strong>Alternative:</strong> Reach her humanity through understanding her past</p>
        </div>
        
        <div class="encounter-box">
            <h4>The Void Titan (Session 13)</h4>
            <p><strong>Challenge:</strong> Massive creature assault on Xylos</p>
            <p><strong>Boss:</strong> Colossal Void Titan (CR 20) - reality-distorting aberration</p>
            <p><strong>Phases:</strong> Fleet engagement → Harbor defense → Titan assault</p>
            <p><strong>Victory Conditions:</strong> Multiple objectives including civilian protection</p>
            <p><strong>Consequences:</strong> Success/failure affects available allies for endgame</p>
        </div>
        
        <div class="encounter-box">
            <h4>The Unweaver's Avatar (Session 18)</h4>
            <p><strong>Challenge:</strong> Manifestation of pure entropy</p>
            <p><strong>Boss:</strong> Unweaver's Avatar (CR 25+) - reality erasure abilities</p>
            <p><strong>Combat:</strong> Takes place across multiple dimensions simultaneously</p>
            <p><strong>Special:</strong> Can be redeemed by showing existence can improve</p>
            <p><strong>Stakes:</strong> Failure means beginning of reality's collapse</p>
        </div>
        
        <div class="dm-secret-box">
            <h4>🔒 Combat Design Philosophy</h4>
            <p>Most major encounters have non-violent solutions or redemption possibilities. Players should feel that violence is a choice, not the only option. Environmental storytelling and emotional stakes matter more than just defeating enemies.</p>
        </div>'''
    },
    
    'weaver_tools': {
        'title': 'The Five Weaver Tools',
        'content': '''<h3>🔮 Artifacts of Cosmic Power</h3>
        
        <div class="location-card">
            <h4>The Essence of Gaia's Decay</h4>
            <p><strong>Location:</strong> Xylos (Session 3)</p>
            <p><strong>Corrupted State:</strong> Causes uncontrolled decay in 1-mile radius</p>
            <p><strong>Purified Powers:</strong> Decomposition control, matter conversion, ecosystem restoration</p>
            <p><strong>Purification:</strong> Restore all three seals, demonstrate understanding of creation/destruction balance</p>
        </div>
        
        <div class="location-card">
            <h4>The Stellar Loom</h4>
            <p><strong>Location:</strong> Frozen Observatory, Kaldhaven Isle (Session 9)</p>
            <p><strong>Corrupted State:</strong> Creates "star-shadows" blocking Weaver influence</p>
            <p><strong>Purified Powers:</strong> Weather control, cosmic communication, stellar manipulation</p>
            <p><strong>Guardian:</strong> Korvak the Star-Touched (corrupted frost giant shaman)</p>
        </div>
        
        <div class="location-card">
            <h4>The Dream Anchor</h4>
            <p><strong>Location:</strong> Isle of Dreams (Session 10)</p>
            <p><strong>Corrupted State:</strong> Traps people in false dreams, blurs reality</p>
            <p><strong>Purified Powers:</strong> Dream walking, memory restoration, nightmare banishment</p>
            <p><strong>Guardian:</strong> Lady Morphia and personalized nightmare chambers</p>
        </div>
        
        <div class="location-card">
            <h4>The Life Forge</h4>
            <p><strong>Location:</strong> The Underforge (Session 11)</p>
            <p><strong>Corrupted State:</strong> Spawns undead instead of life</p>
            <p><strong>Purified Powers:</strong> True resurrection, evolution guidance, soul healing</p>
            <p><strong>Access:</strong> Through Soulforge Gate beneath Volcanic Isle</p>
        </div>
        
        <div class="location-card">
            <h4>The World Seed</h4>
            <p><strong>Location:</strong> Nexus of Creation beneath Scarred Mountains (Session 12)</p>
            <p><strong>Corrupted State:</strong> Causes reality tears and dimensional instabilities</p>
            <p><strong>Purified Powers:</strong> Reality shaping, dimensional anchoring, world creation</p>
            <p><strong>Guardian:</strong> Supreme Commander Vex'ahlia and reality-warping chamber</p>
        </div>
        
        <div class="dm-secret-box">
            <h4>🔒 The True Nature</h4>
            <p>Each tool is a fragment of a Weaver's consciousness and power. Using them changes the wielder over time, granting cosmic perspective but potentially losing humanity. The Shadow Court's corruption attempts were trying to claim power without understanding responsibility.</p>
        </div>
        
        <div class="oracle-box">
            <h4>The Grand Confluence</h4>
            <p>The inevitable cosmic event where all five tools' power reaches its peak. Cannot be stopped, only directed. Players must choose what kind of reality they want to create: Perfected World, Balanced Reality, Evolutionary Reality, Multiple Realities, or return power to the Weavers.</p>
        </div>'''
    },
    
    'lore': {
        'title': 'World Lore & Cosmic History',
        'content': '''<h3>📚 The History of Reality</h3>
        
        <div class="lore-section">
            <h4>The Age of Void (Prehistory)</h4>
            <p>Before the Weavers, reality was formless chaos. The Void consumed everything, preventing stable existence from forming. Pure entropy without the structure needed for consciousness or meaning.</p>
        </div>
        
        <div class="lore-section">
            <h4>The First Weaving (Mythic Past)</h4>
            <p>Four cosmic entities called Weavers emerged from pure possibility and began shaping reality. They created the first stable dimensions and populated them with life, establishing the fundamental forces that allow existence to persist.</p>
        </div>
        
        <div class="lore-section">
            <h4>The Age of Creation (Ancient History)</h4>
            <p>The Weavers taught mortals to use tools of cosmic power, enabling rapid development of advanced civilizations across multiple worlds. This golden age saw incredible advancement but also growing hubris.</p>
        </div>
        
        <div class="lore-section">
            <h4>The Sundering (1,000 years ago)</h4>
            <p>Mortals misused Weaver Tools, causing reality tears and dimensional collapses. The Weavers withdrew, hiding their tools and entering deep slumber to prevent further catastrophe.</p>
        </div>
        
        <div class="lore-section">
            <h4>The Shadow Wars (500 years ago)</h4>
            <p>First attempts by void-touched entities to reclaim the hidden Weaver Tools. The wars ended in stalemate with most tools still lost, but established the Shadow Court as an ongoing threat.</p>
        </div>
        
        <div class="lore-section">
            <h4>The Great Dimming (47 years ago)</h4>
            <p>Mysterious decline in magical energy across Shadowmar. Sea levels rose, some islands vanished, and many magical abilities weakened. This event marked the beginning of the current crisis.</p>
        </div>
        
        <div class="dm-secret-box">
            <h4>🔒 The Shadow Court's True Nature</h4>
            <p><strong>The Unweaver:</strong> Primordial entity of pure entropy that existed before creation. Cannot act directly, must work through willing servants.</p>
            <p><strong>The First Corrupted:</strong> Former mortals who sought Weaver Tools for personal gain, gradually losing humanity as they channel void energy.</p>
            <p><strong>Philosophy:</strong> Genuinely believe they're saving existence from the "burden" of consciousness and suffering.</p>
        </div>
        
        <div class="oracle-box">
            <h4>The Oracle's Riddles</h4>
            <p><em>"Three fragments you carry, but five were made. Two remain hidden where starlight has strayed..."</em></p>
            <p><em>"The Essence drinks green but thirsts for blue. What feeds the deep when surface is through?"</em></p>
            <p><em>"When Weavers wake, what price will you pay? Will you choose the night, or herald the day?"</em></p>
        </div>'''
    },
    
    'tools': {
        'title': 'DM Tools & Quick Reference',
        'content': '''<h3>🔧 Campaign Management Tools</h3>
        
        <div class="dc-table">
            <h4>Corruption Resistance Saves</h4>
            <p><strong>Casual Exposure:</strong> DC 12 (being near corrupted individuals)<br>
            <strong>Direct Exposure:</strong> DC 15 (corrupted creature attacks)<br>
            <strong>Intense Exposure:</strong> DC 18 (corruption plague epicenter)<br>
            <strong>Overwhelming:</strong> DC 21 (saving someone already corrupted)</p>
        </div>
        
        <div class="encounter-table">
            <h4>Cosmic Perspective Effects</h4>
            <p><strong>Constitution Save DC 18</strong> after experiencing cosmic awareness or gain exhaustion</p>
            <p><strong>Success Grants:</strong> Cosmic Insight (advantage on Wisdom checks), Reality Sight (see through illusions), Temporal Awareness (advantage on initiative), Universal Empathy (communicate with any intelligent creature)</p>
        </div>
        
        <div class="dc-table">
            <h4>Weaver Tool Attunement</h4>
            <p><strong>Requirements:</strong> Demonstrate understanding of cosmic responsibility<br>
            <strong>Time:</strong> 1 hour of meditation with the tool<br>
            <strong>Corruption Risk:</strong> Gradual alignment shift toward tool's nature<br>
            <strong>Benefits:</strong> Access to tool's purified abilities</p>
        </div>
        
        <div class="encounter-table">
            <h4>Ship Combat Rules</h4>
            <p><strong>Range Bands:</strong> Extreme (1000+ ft), Long (500-1000 ft), Medium (200-500 ft), Close (0-200 ft)<br>
            <strong>Ramming:</strong> 6d10 damage, both ships take damage<br>
            <strong>Crew Actions:</strong> Repair (2d6 HP), Navigate (advantage on next maneuver), Fire Weapons<br>
            <strong>Critical Hits:</strong> Roll on ship damage table (sails, hull, crew, weapons)</p>
        </div>
        
        <div class="dc-table">
            <h4>Reality Stability Checks</h4>
            <p><strong>Stable:</strong> No check needed<br>
            <strong>Unstable:</strong> DC 15 Wisdom save or be confused for 1 round<br>
            <strong>Chaotic:</strong> DC 18 Constitution save or take 2d6 psychic damage<br>
            <strong>Collapsing:</strong> DC 20 Charisma save or be banished to Border Ethereal</p>
        </div>
        
        <div class="lore-section">
            <h4>Moral Choice Consequences</h4>
            <p>Track player decisions throughout the campaign:</p>
            <ul>
                <li><strong>Redemption vs Punishment:</strong> How do they handle corrupted enemies?</li>
                <li><strong>Power vs Responsibility:</strong> Do they use Weaver Tools wisely?</li>
                <li><strong>Individual vs Collective:</strong> Do they prioritize personal goals or greater good?</li>
                <li><strong>Order vs Chaos:</strong> Do they prefer structure or freedom?</li>
            </ul>
            <p>These choices determine available endings and cosmic transformation options.</p>
        </div>
        
        <div class="oracle-box">
            <h4>Campaign Ending Variants</h4>
            <p><strong>Perfect World:</strong> Eliminate all suffering (removes growth and meaning)<br>
            <strong>Balanced Reality:</strong> Improve current reality while preserving challenges<br>
            <strong>Evolutionary Reality:</strong> Create self-improving cosmic mechanisms<br>
            <strong>Multiple Realities:</strong> Separate realities for different preferences<br>
            <strong>Mortal Choice:</strong> Return cosmic power, let mortals find their own way</p>
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

# Campaign data endpoints
@app.route('/api/campaign')
def get_campaign_data():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    try:
        data = conn.execute('SELECT * FROM campaign_data').fetchall()
        
        campaign_data = {}
        for row in data:
            try:
                campaign_data[row['key']] = json.loads(row['value'])
            except:
                campaign_data[row['key']] = row['value']
        
        return jsonify(campaign_data)
    except Exception as e:
        print(f"Error loading campaign data: {e}")
        return jsonify({'error': 'Failed to load campaign data'}), 500
    finally:
        conn.close()

@app.route('/api/campaign/<key>', methods=['PUT'])
def update_campaign_data(key):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    value = json.dumps(data.get('value'))
    
    conn = get_db_connection()
    try:
        conn.execute('''
            INSERT OR REPLACE INTO campaign_data (key, value, updated_by)
            VALUES (?, ?, ?)
        ''', (key, value, session['username']))
        conn.commit()
        
        socketio.emit('campaign_update', {
            'key': key,
            'value': data.get('value'),
            'updated_by': session['username']
        }, room='campaign')
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error updating campaign data: {e}")
        return jsonify({'error': 'Failed to update campaign data'}), 500
    finally:
        conn.close()

@app.route('/api/messages')
def get_messages():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    try:
        messages = conn.execute(
            'SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100'
        ).fetchall()
        
        return jsonify([dict(msg) for msg in reversed(messages)])
    except Exception as e:
        print(f"Error loading messages: {e}")
        return jsonify({'error': 'Failed to load messages'}), 500
    finally:
        conn.close()

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
        
        try:
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
        except Exception as e:
            print(f"Error uploading file: {e}")
            return jsonify({'error': 'Failed to upload file'}), 500
    
    return jsonify({'error': 'Invalid file type'}), 400

@app.route('/files/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/files')
def get_files():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    conn = get_db_connection()
    try:
        files = conn.execute(
            'SELECT * FROM files ORDER BY upload_date DESC'
        ).fetchall()
        
        return jsonify([dict(file) for file in files])
    except Exception as e:
        print(f"Error loading files: {e}")
        return jsonify({'error': 'Failed to load files'}), 500
    finally:
        conn.close()

# Socket.IO events
@socketio.on('connect')
def on_connect():
    if 'username' in session:
        join_room('campaign')
        join_room(f'user_{session["username"]}')
        emit('status', {'msg': f"{session['username']} connected"}, room='campaign')

@socketio.on('disconnect')
def on_disconnect():
    if 'username' in session:
        leave_room('campaign')
        leave_room(f'user_{session["username"]}')

@socketio.on('send_message')
def handle_message(data):
    if 'username' not in session:
        return
    
    message = data.get('message', '').strip()
    message_type = data.get('type', 'chat')
    
    if message:
        conn = get_db_connection()
        try:
            conn.execute(
                'INSERT INTO messages (username, message, message_type) VALUES (?, ?, ?)',
                (session['username'], message, message_type)
            )
            conn.commit()
            
            emit('new_message', {
                'username': session['username'],
                'message': message,
                'type': message_type,
                'timestamp': datetime.now().isoformat()
            }, room='campaign')
        except Exception as e:
            print(f"Error sending message: {e}")
        finally:
            conn.close()

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

@socketio.on('join_battlemap')
def on_join_battlemap():
    if 'username' in session:
        join_room('battlemap')
        emit('battlemap_state', battle_map_state)

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

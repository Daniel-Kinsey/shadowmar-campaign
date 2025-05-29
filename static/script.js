// Global variables
let socket;
let currentUser = null;
let characters = [];
let campaignData = {};
let currentEditField = null;
let combatState = { active: false };
let battleMapState = {};
let currentTool = 'select';
let selectedToken = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let currentSection = 'overview';
let editingChapter = false;

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    currentUser = {
        username: document.getElementById('username-display').textContent,
        role: document.getElementById('role-badge').textContent
    };
    
    initializeSocket();
    initializeEventListeners();
    loadInitialData();
    initializeBattleMap();
    
    // Show DM-only controls if user is DM
    if (currentUser.role === 'dm') {
        document.getElementById('dm-combat-controls').style.display = 'flex';
        document.getElementById('dm-book-edit-controls').style.display = 'flex';
    }
});

// Socket.IO initialization
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('join_battlemap');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showNotification('Connection lost. Attempting to reconnect...', 'warning');
    });
    
    socket.on('new_message', (data) => {
        addMessageToChat(data);
    });
    
    socket.on('character_update', (data) => {
        loadCharacters();
        updateCombatDisplay();
        updateBattleMapTokens();
        showNotification(`Character updated by ${data.updated_by}`, 'info');
    });
    
    socket.on('campaign_update', (data) => {
        updateCampaignField(data.key, data.value);
        showNotification(`${data.key} updated by ${data.updated_by}`, 'info');
    });
    
    socket.on('file_uploaded', (data) => {
        loadFiles();
        showNotification(`${data.original_name} uploaded by ${data.uploaded_by}`, 'success');
    });
    
    // Combat events
    socket.on('combat_started', (data) => {
        combatState = data;
        updateCombatDisplay();
        showNotification('Combat has started!', 'warning');
    });
    
    socket.on('combat_ended', () => {
        combatState = { active: false };
        updateCombatDisplay();
        showNotification('Combat has ended', 'info');
    });
    
    socket.on('combat_turn_changed', (data) => {
        combatState = data;
        updateCombatDisplay();
        showNotification(`Round ${data.round}, Turn: ${data.combatants[data.current_turn]?.name || 'Unknown'}`, 'info');
    });
    
    socket.on('hp_updated', (data) => {
        updateCharacterHP(data.character_id, data.hp);
        showNotification(`${data.updated_by} updated HP`, 'info');
    });
    
    // Battle map events
    socket.on('token_moved', (data) => {
        updateTokenPosition(data.token_id, data.x, data.y);
        showNotification(`${data.moved_by} moved a token`, 'info');
    });
    
    socket.on('battlemap_state', (data) => {
        battleMapState = data;
        renderBattleMap();
    });
    
    // Secret message events
    socket.on('secret_message', (data) => {
        showSecretMessage(data);
    });
    
    // DM Book events
    socket.on('dm_book_updated', (data) => {
        if (data.section === currentSection) {
            loadDMBookSection(currentSection);
        }
        showNotification(`DM Book updated by ${data.updated_by}`, 'info');
    });
}

// Event listeners
function initializeEventListeners() {
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });
    
    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        window.location.href = '/logout';
    });
    
    // Character management
    document.getElementById('add-character-btn').addEventListener('click', () => {
        openCharacterModal();
    });
    
    document.getElementById('save-character').addEventListener('click', saveCharacter);
    document.getElementById('cancel-character').addEventListener('click', closeCharacterModal);
    
    // Combat controls
    document.getElementById('start-combat-btn').addEventListener('click', openCombatSetup);
    document.getElementById('end-combat-btn').addEventListener('click', endCombat);
    document.getElementById('next-turn-btn').addEventListener('click', nextTurn);
    document.getElementById('confirm-combat-start').addEventListener('click', startCombat);
    document.getElementById('cancel-combat-setup').addEventListener('click', closeCombatSetup);
    document.getElementById('add-enemy-btn').addEventListener('click', addEnemyToCombat);
    
    // Battle map controls
    document.getElementById('open-battlemap-window').addEventListener('click', openBattleMapWindow);
    document.getElementById('toggle-grid').addEventListener('click', toggleGrid);
    document.getElementById('center-map').addEventListener('click', centerMap);
    
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            selectTool(e.target.dataset.tool);
        });
    });
    
    // Chat and secret messages
    document.getElementById('secret-message-btn').addEventListener('click', openSecretMessageModal);
    document.getElementById('dice-roll-btn').addEventListener('click', toggleDicePanel);
    document.getElementById('send-secret-message').addEventListener('click', sendSecretMessage);
    document.getElementById('cancel-secret-message').addEventListener('click', closeSecretMessageModal);
    
    // DM Book controls
    document.querySelectorAll('.chapter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            loadDMBookSection(e.target.dataset.section);
        });
    });
    
    document.getElementById('edit-chapter-btn').addEventListener('click', startEditingChapter);
    document.getElementById('save-chapter-btn').addEventListener('click', saveChapter);
    document.getElementById('cancel-edit-btn').addEventListener('click', cancelEditingChapter);
    
    // Modal close buttons
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', (e) => {
            e.target.closest('.modal').style.display = 'none';
        });
    });
    
    // Parchment close button
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('parchment-close')) {
            document.getElementById('secret-parchment').style.display = 'none';
        }
    });
    
    // Click outside modal to close
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
    
    // Chat functionality
    document.getElementById('send-message').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // File upload
    document.getElementById('upload-btn').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });
    
    document.getElementById('file-input').addEventListener('change', uploadFile);
    
    // Dice rolling
    document.getElementById('roll-dice').addEventListener('click', rollDice);
    
    // Editable fields
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const field = e.target.closest('.editable-field');
            openEditModal(field);
        }
    });
    
    document.getElementById('save-edit').addEventListener('click', saveFieldEdit);
    document.getElementById('cancel-edit').addEventListener('click', () => {
        document.getElementById('edit-modal').style.display = 'none';
    });
    
    // Battle map mouse events
    const canvas = document.getElementById('battlemap-canvas');
    canvas.addEventListener('mousedown', handleBattleMapMouseDown);
    canvas.addEventListener('mousemove', handleBattleMapMouseMove);
    canvas.addEventListener('mouseup', handleBattleMapMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Disable right-click menu
}

// Tab switching
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab content
    document.getElementById(`${tabName}-tab`).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    // Load data if needed
    switch(tabName) {
        case 'characters':
            loadCharacters();
            break;
        case 'campaign':
            loadCampaignData();
            break;
        case 'chat':
            loadMessages();
            break;
        case 'files':
            loadFiles();
            break;
        case 'combat':
            loadCombatState();
            break;
        case 'battlemap':
            renderBattleMap();
            break;
        case 'dm-book':
            loadDMBookSection(currentSection);
            break;
    }
}

// Load initial data
async function loadInitialData() {
    await loadCharacters();
    await loadCampaignData();
    await loadMessages();
    await loadFiles();
    await loadCombatState();
    await loadUsersList();
}

// Character management
async function loadCharacters() {
    try {
        const response = await fetch('/api/characters');
        const data = await response.json();
        characters = data;
        renderCharacters();
        updatePlayerCombatSheet();
    } catch (error) {
        console.error('Error loading characters:', error);
        showNotification('Failed to load characters', 'error');
    }
}

function renderCharacters() {
    const container = document.getElementById('characters-grid');
    container.innerHTML = '';
    
    characters.forEach(character => {
        const card = createCharacterCard(character);
        container.appendChild(card);
    });
}

function createCharacterCard(character) {
    const div = document.createElement('div');
    div.className = 'character-card';
    
    // Parse status effects if they exist
    let statusEffects = [];
    try {
        statusEffects = character.status_effects ? JSON.parse(character.status_effects) : [];
    } catch (e) {
        statusEffects = [];
    }
    
    const statusEffectsHtml = statusEffects.length > 0 ? 
        `<div class="status-effects">Status: ${statusEffects.join(', ')}</div>` : '';
    
    div.innerHTML = `
        <div class="character-header">
            <div>
                <div class="character-name">${character.name}</div>
                <div class="character-class">${character.class || 'Unknown Class'} - Level ${character.level}</div>
                ${character.username ? `<div class="character-player">Player: ${character.username}</div>` : ''}
            </div>
        </div>
        
        <div class="character-stats">
            <div class="stat-item">
                <span class="stat-label">HP</span>
                <span class="stat-value hp-tracker" data-char-id="${character.id}">
                    <input type="number" class="hp-input" value="${character.hp_current}" min="0" max="${character.hp_max}" data-char-id="${character.id}">
                    /${character.hp_max}
                </span>
            </div>
            <div class="stat-item">
                <span class="stat-label">AC</span>
                <span class="stat-value">${character.ac}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Speed</span>
                <span class="stat-value">${character.speed}ft</span>
            </div>
        </div>
        
        ${statusEffectsHtml}
        
        ${character.notes ? `<div class="character-notes">${character.notes}</div>` : ''}
        
        <div class="character-controls">
            <button class="btn btn-small btn-primary" onclick="editCharacter(${character.id})">Edit</button>
            <button class="btn btn-small btn-secondary" onclick="duplicateCharacter(${character.id})">Duplicate</button>
            ${character.in_combat ? '<span class="combat-indicator">⚔️ In Combat</span>' : ''}
        </div>
    `;
    
    // Add HP change listeners
    const hpInput = div.querySelector('.hp-input');
    hpInput.addEventListener('change', (e) => {
        updateCharacterHP(character.id, parseInt(e.target.value));
    });
    
    return div;
}

async function updateCharacterHP(charId, newHP) {
    try {
        const response = await fetch('/api/combat/update-hp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_id: charId, hp: newHP })
        });
        
        if (!response.ok) {
            throw new Error('Failed to update HP');
        }
        
        // Update local character data
        const character = characters.find(c => c.id === charId);
        if (character) {
            character.hp_current = newHP;
        }
        
        updateCombatDisplay();
        
    } catch (error) {
        console.error('Error updating HP:', error);
        showNotification('Failed to update HP', 'error');
    }
}

function openCharacterModal(character = null) {
    const modal = document.getElementById('character-modal');
    const title = document.getElementById('character-modal-title');
    const form = document.getElementById('character-form');
    
    if (character) {
        title.textContent = 'Edit Character';
        form.elements['name'].value = character.name || '';
        form.elements['class'].value = character.class || '';
        form.elements['level'].value = character.level || 1;
        form.elements['hp_current'].value = character.hp_current || 10;
        form.elements['hp_max'].value = character.hp_max || 10;
        form.elements['ac'].value = character.ac || 10;
        form.elements['speed'].value = character.speed || 30;
        form.elements['initiative'].value = character.initiative || 0;
        form.elements['notes'].value = character.notes || '';
        modal.dataset.characterId = character.id;
    } else {
        title.textContent = 'Add Character';
        form.reset();
        delete modal.dataset.characterId;
    }
    
    modal.style.display = 'block';
}

function closeCharacterModal() {
    document.getElementById('character-modal').style.display = 'none';
}

async function saveCharacter() {
    const modal = document.getElementById('character-modal');
    const form = document.getElementById('character-form');
    const formData = new FormData(form);
    
    const characterData = {
        name: formData.get('name'),
        class: formData.get('class'),
        level: parseInt(formData.get('level')),
        hp_current: parseInt(formData.get('hp_current')),
        hp_max: parseInt(formData.get('hp_max')),
        ac: parseInt(formData.get('ac')),
        speed: parseInt(formData.get('speed')),
        initiative: parseInt(formData.get('initiative')),
        notes: formData.get('notes'),
        stats: {},
        spell_slots: {},
        status_effects: []
    };
    
    try {
        let response;
        if (modal.dataset.characterId) {
            response = await fetch(`/api/characters/${modal.dataset.characterId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(characterData)
            });
        } else {
            response = await fetch('/api/characters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(characterData)
            });
        }
        
        const data = await response.json();
        
        if (data.success) {
            closeCharacterModal();
            loadCharacters();
            showNotification('Character saved successfully', 'success');
        } else {
            showNotification('Failed to save character', 'error');
        }
    } catch (error) {
        console.error('Error saving character:', error);
        showNotification('Failed to save character', 'error');
    }
}

function editCharacter(characterId) {
    const character = characters.find(c => c.id === characterId);
    if (character) {
        openCharacterModal(character);
    }
}

function duplicateCharacter(characterId) {
    const character = characters.find(c => c.id === characterId);
    if (character) {
        const duplicate = { ...character };
        duplicate.name += ' (Copy)';
        delete duplicate.id;
        openCharacterModal(duplicate);
    }
}

// Combat system
async function loadCombatState() {
    try {
        const response = await fetch('/api/combat/state');
        const data = await response.json();
        combatState = data;
        updateCombatDisplay();
    } catch (error) {
        console.error('Error loading combat state:', error);
    }
}

function updateCombatDisplay() {
    const statusDiv = document.getElementById('combat-status');
    const initiativeDiv = document.getElementById('initiative-order');
    const combatantsList = document.getElementById('combatants-list');
    
    if (combatState.active) {
        statusDiv.innerHTML = `
            <h3>⚔️ Combat Active - Round ${combatState.round}</h3>
            <p>Current Turn: ${combatState.combatants[combatState.current_turn]?.name || 'Unknown'}</p>
        `;
        
        initiativeDiv.style.display = 'block';
        
        if (currentUser.role === 'dm') {
            document.getElementById('start-combat-btn').style.display = 'none';
            document.getElementById('end-combat-btn').style.display = 'inline-block';
            document.getElementById('next-turn-btn').style.display = 'inline-block';
            
            // Render all combatants for DM
            combatantsList.innerHTML = '';
            combatState.combatants.forEach((combatant, index) => {
                const isCurrentTurn = index === combatState.current_turn;
                const combatantDiv = document.createElement('div');
                combatantDiv.className = `combatant-item ${isCurrentTurn ? 'current-turn' : ''}`;
                
                combatantDiv.innerHTML = `
                    <div class="combatant-info">
                        <strong>${combatant.name}</strong>
                        <span class="initiative">Initiative: ${combatant.initiative}</span>
                    </div>
                    <div class="combatant-stats">
                        <span class="hp">HP: ${combatant.hp_current}/${combatant.hp_max}</span>
                        <span class="ac">AC: ${combatant.ac}</span>
                    </div>
                `;
                
                combatantsList.appendChild(combatantDiv);
            });
        } else {
            // Show only relevant info for players
            const playerCombatants = combatState.combatants.filter(c => 
                c.type === 'character' && characters.some(char => 
                    char.id === c.id && char.user_id === currentUser.id
                )
            );
            
            combatantsList.innerHTML = '';
            playerCombatants.forEach((combatant, index) => {
                const combatantDiv = document.createElement('div');
                combatantDiv.className = 'combatant-item';
                
                combatantDiv.innerHTML = `
                    <div class="combatant-info">
                        <strong>${combatant.name}</strong>
                    </div>
                    <div class="combatant-stats">
                        <span class="hp">HP: ${combatant.hp_current}/${combatant.hp_max}</span>
                        <span class="ac">AC: ${combatant.ac}</span>
                    </div>
                `;
                
                combatantsList.appendChild(combatantDiv);
            });
        }
    } else {
        statusDiv.innerHTML = '<p>Combat is not active</p>';
        initiativeDiv.style.display = 'none';
        
        if (currentUser.role === 'dm') {
            document.getElementById('start-combat-btn').style.display = 'inline-block';
            document.getElementById('end-combat-btn').style.display = 'none';
            document.getElementById('next-turn-btn').style.display = 'none';
        }
    }
    
    updatePlayerCombatSheet();
}

function updatePlayerCombatSheet() {
    const playerSheet = document.getElementById('player-character-stats');
    const playerCharacters = characters.filter(c => c.user_id === currentUser.id);
    
    if (playerCharacters.length === 0) {
        playerSheet.innerHTML = '<p>No characters found</p>';
        return;
    }
    
    playerSheet.innerHTML = '';
    playerCharacters.forEach(character => {
        const charDiv = document.createElement('div');
        charDiv.className = 'player-character-summary';
        
        // Parse status effects
        let statusEffects = [];
        try {
            statusEffects = character.status_effects ? JSON.parse(character.status_effects) : [];
        } catch (e) {
            statusEffects = [];
        }
        
        charDiv.innerHTML = `
            <div class="character-summary-header">
                <h4>${character.name}</h4>
                <span class="level">${character.class} Level ${character.level}</span>
            </div>
            <div class="character-summary-stats">
                <div class="stat-row">
                    <span>HP:</span>
                    <input type="number" class="hp-quick-edit" value="${character.hp_current}" 
                           min="0" max="${character.hp_max}" data-char-id="${character.id}">
                    <span>/${character.hp_max}</span>
                </div>
                <div class="stat-row">
                    <span>AC:</span> <span>${character.ac}</span>
                </div>
                <div class="stat-row">
                    <span>Speed:</span> <span>${character.speed}ft</span>
                </div>
                ${statusEffects.length > 0 ? 
                    `<div class="stat-row"><span>Status:</span> <span>${statusEffects.join(', ')}</span></div>` : 
                    ''
                }
            </div>
        `;
        
        playerSheet.appendChild(charDiv);
        
        // Add HP change listener
        const hpInput = charDiv.querySelector('.hp-quick-edit');
        hpInput.addEventListener('change', (e) => {
            updateCharacterHP(character.id, parseInt(e.target.value));
        });
    });
}

function openCombatSetup() {
    const modal = document.getElementById('combat-setup-modal');
    const pcList = document.getElementById('pc-combat-list');
    const enemyList = document.getElementById('enemy-combat-list');
    
    // Clear existing lists
    pcList.innerHTML = '';
    enemyList.innerHTML = '';
    
    // Add player characters
    characters.forEach(character => {
        const charDiv = document.createElement('div');
        charDiv.className = 'combat-setup-character';
        charDiv.innerHTML = `
            <label>
                <input type="checkbox" class="pc-combat-check" value="${character.id}">
                ${character.name} (${character.class} ${character.level})
            </label>
            <input type="number" class="initiative-input" placeholder="Initiative" min="1" max="30">
        `;
        pcList.appendChild(charDiv);
    });
    
    modal.style.display = 'block';
}

function closeCombatSetup() {
    document.getElementById('combat-setup-modal').style.display = 'none';
}

function addEnemyToCombat() {
    const enemyList = document.getElementById('enemy-combat-list');
    const enemyDiv = document.createElement('div');
    enemyDiv.className = 'combat-setup-enemy';
    
    enemyDiv.innerHTML = `
        <div class="enemy-setup-row">
            <input type="text" class="enemy-name" placeholder="Enemy Name" required>
            <input type="number" class="enemy-hp" placeholder="HP" min="1" required>
            <input type="number" class="enemy-ac" placeholder="AC" min="1" required>
            <input type="number" class="enemy-initiative" placeholder="Initiative" min="1" max="30" required>
            <button type="button" class="btn btn-small btn-danger" onclick="removeEnemy(this)">Remove</button>
        </div>
    `;
    
    enemyList.appendChild(enemyDiv);
}

function removeEnemy(button) {
    button.closest('.combat-setup-enemy').remove();
}

async function startCombat() {
    const combatants = [];
    
    // Add selected player characters
    document.querySelectorAll('.pc-combat-check:checked').forEach(checkbox => {
        const characterId = parseInt(checkbox.value);
        const character = characters.find(c => c.id === characterId);
        const initiativeInput = checkbox.closest('.combat-setup-character').querySelector('.initiative-input');
        
        if (character) {
            combatants.push({
                id: character.id,
                name: character.name,
                type: 'character',
                hp_current: character.hp_current,
                hp_max: character.hp_max,
                ac: character.ac,
                initiative: parseInt(initiativeInput.value) || 0
            });
        }
    });
    
    // Add enemies
    document.querySelectorAll('.combat-setup-enemy').forEach(enemyDiv => {
        const name = enemyDiv.querySelector('.enemy-name').value;
        const hp = parseInt(enemyDiv.querySelector('.enemy-hp').value);
        const ac = parseInt(enemyDiv.querySelector('.enemy-ac').value);
        const initiative = parseInt(enemyDiv.querySelector('.enemy-initiative').value);
        
        if (name && hp && ac && initiative !== undefined) {
            combatants.push({
                id: `enemy_${Date.now()}_${Math.random()}`,
                name: name,
                type: 'enemy',
                hp_current: hp,
                hp_max: hp,
                ac: ac,
                initiative: initiative
            });
        }
    });
    
    if (combatants.length === 0) {
        showNotification('Please add at least one combatant', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/combat/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ combatants })
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeCombatSetup();
            showNotification('Combat started!', 'success');
        } else {
            showNotification('Failed to start combat', 'error');
        }
    } catch (error) {
        console.error('Error starting combat:', error);
        showNotification('Failed to start combat', 'error');
    }
}

async function endCombat() {
    try {
        const response = await fetch('/api/combat/end', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Combat ended', 'info');
        } else {
            showNotification('Failed to end combat', 'error');
        }
    } catch (error) {
        console.error('Error ending combat:', error);
        showNotification('Failed to end combat', 'error');
    }
}

async function nextTurn() {
    try {
        const response = await fetch('/api/combat/next-turn', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Notification will be sent via socket
        } else {
            showNotification('Failed to advance turn', 'error');
        }
    } catch (error) {
        console.error('Error advancing turn:', error);
        showNotification('Failed to advance turn', 'error');
    }
}

// Battle Map System
function initializeBattleMap() {
    const canvas = document.getElementById('battlemap-canvas');
    battleMapState = {
        width: 30,
        height: 20,
        grid_size: 50,
        tokens: {},
        fog_of_war: {},
        background_image: null,
        walls: [],
        lighting: {},
        showGrid: true,
        scale: 1,
        offset: { x: 0, y: 0 }
    };
    
    renderBattleMap();
}

function renderBattleMap() {
    const canvas = document.getElementById('battlemap-canvas');
    const ctx = canvas.getContext('2d');
    const tokensContainer = document.getElementById('battlemap-tokens');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid if enabled
    if (battleMapState.showGrid) {
        drawGrid(ctx);
    }
    
    // Clear and redraw tokens
    tokensContainer.innerHTML = '';
    Object.entries(battleMapState.tokens).forEach(([tokenId, token]) => {
        createTokenElement(tokenId, token);
    });
    
    // Update token list
    updateTokenList();
}

function drawGrid(ctx) {
    const gridSize = battleMapState.grid_size;
    const canvas = ctx.canvas;
    
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    
    // Vertical lines
    for (let x = 0; x <= canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = 0; y <= canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

function createTokenElement(tokenId, token) {
    const tokensContainer = document.getElementById('battlemap-tokens');
    const tokenElement = document.createElement('div');
    tokenElement.className = 'battle-token';
    tokenElement.dataset.tokenId = tokenId;
    tokenElement.style.left = `${token.x * battleMapState.grid_size}px`;
    tokenElement.style.top = `${token.y * battleMapState.grid_size}px`;
    
    // Find character info
    const character = characters.find(c => c.id == tokenId);
    if (character) {
        tokenElement.innerHTML = `
            <div class="token-inner">
                <span class="token-name">${character.name.substring(0, 2).toUpperCase()}</span>
                <div class="token-hp">${character.hp_current}/${character.hp_max}</div>
            </div>
        `;
        tokenElement.style.backgroundColor = character.user_id === currentUser.id ? '#4CAF50' : '#2196F3';
    } else {
        tokenElement.innerHTML = `
            <div class="token-inner">
                <span class="token-name">EN</span>
            </div>
        `;
        tokenElement.style.backgroundColor = '#f44336';
    }
    
    // Add drag listeners
    tokenElement.addEventListener('mousedown', (e) => {
        if (currentTool === 'move' || (currentTool === 'select' && canMoveToken(tokenId))) {
            startTokenDrag(e, tokenId);
        }
    });
    
    tokensContainer.appendChild(tokenElement);
}

function canMoveToken(tokenId) {
    if (currentUser.role === 'dm') return true;
    
    const character = characters.find(c => c.id == tokenId);
    return character && character.user_id === currentUser.id;
}

function startTokenDrag(e, tokenId) {
    selectedToken = tokenId;
    isDragging = true;
    
    const tokenElement = e.target.closest('.battle-token');
    const rect = tokenElement.getBoundingClientRect();
    const canvasRect = document.getElementById('battlemap-canvas').getBoundingClientRect();
    
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    
    tokenElement.style.zIndex = '1000';
    document.body.style.cursor = 'grabbing';
}

function handleBattleMapMouseDown(e) {
    if (currentTool === 'select') {
        // Token selection is handled by token elements
        return;
    }
}

function handleBattleMapMouseMove(e) {
    if (!isDragging || !selectedToken) return;
    
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - dragOffset.x;
    const y = e.clientY - rect.top - dragOffset.y;
    
    const tokenElement = document.querySelector(`[data-token-id="${selectedToken}"]`);
    if (tokenElement) {
        tokenElement.style.left = `${x}px`;
        tokenElement.style.top = `${y}px`;
    }
}

function handleBattleMapMouseUp(e) {
    if (!isDragging || !selectedToken) return;
    
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / battleMapState.grid_size);
    const y = Math.floor((e.clientY - rect.top) / battleMapState.grid_size);
    
    // Move token to grid position
    moveTokenToPosition(selectedToken, x, y);
    
    // Reset drag state
    const tokenElement = document.querySelector(`[data-token-id="${selectedToken}"]`);
    if (tokenElement) {
        tokenElement.style.zIndex = '';
    }
    
    selectedToken = null;
    isDragging = false;
    document.body.style.cursor = '';
}

async function moveTokenToPosition(tokenId, x, y) {
    try {
        const response = await fetch('/api/battlemap/move-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token_id: tokenId, x, y })
        });
        
        if (!response.ok) {
            throw new Error('Failed to move token');
        }
        
        // Update local state
        battleMapState.tokens[tokenId] = { x, y };
        
    } catch (error) {
        console.error('Error moving token:', error);
        showNotification('Failed to move token', 'error');
        
        // Revert position
        renderBattleMap();
    }
}

function updateTokenPosition(tokenId, x, y) {
    battleMapState.tokens[tokenId] = { x, y };
    
    const tokenElement = document.querySelector(`[data-token-id="${tokenId}"]`);
    if (tokenElement) {
        tokenElement.style.left = `${x * battleMapState.grid_size}px`;
        tokenElement.style.top = `${y * battleMapState.grid_size}px`;
    }
}

function updateBattleMapTokens() {
    // Add tokens for characters in combat
    characters.forEach(character => {
        if (character.in_combat && !battleMapState.tokens[character.id]) {
            battleMapState.tokens[character.id] = {
                x: character.token_x || 0,
                y: character.token_y || 0
            };
        }
    });
    
    renderBattleMap();
}

function selectTool(tool) {
    currentTool = tool;
    
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.querySelector(`[data-tool="${tool}"]`).classList.add('active');
    
    // Update cursor
    const canvas = document.getElementById('battlemap-canvas');
    switch(tool) {
        case 'select':
            canvas.style.cursor = 'default';
            break;
        case 'move':
            canvas.style.cursor = 'grab';
            break;
        case 'measure':
            canvas.style.cursor = 'crosshair';
            break;
    }
}

function toggleGrid() {
    battleMapState.showGrid = !battleMapState.showGrid;
    renderBattleMap();
}

function centerMap() {
    battleMapState.offset = { x: 0, y: 0 };
    battleMapState.scale = 1;
    renderBattleMap();
}

function updateTokenList() {
    const tokenList = document.getElementById('token-list-items');
    tokenList.innerHTML = '';
    
    Object.entries(battleMapState.tokens).forEach(([tokenId, token]) => {
        const character = characters.find(c => c.id == tokenId);
        const tokenItem = document.createElement('div');
        tokenItem.className = 'token-list-item';
        tokenItem.innerHTML = `
            <span class="token-name">${character ? character.name : 'Enemy'}</span>
            <span class="token-position">(${token.x}, ${token.y})</span>
        `;
        tokenList.appendChild(tokenItem);
    });
}

function openBattleMapWindow() {
    const newWindow = window.open('/battlemap', 'battlemap', 'width=1200,height=800');
    if (newWindow) {
        showNotification('Battle map opened in new window', 'success');
    } else {
        showNotification('Failed to open battle map window. Please allow popups.', 'warning');
    }
}

// Secret Messages System
async function loadUsersList() {
    // Load users for secret message dropdown
    try {
        const response = await fetch('/api/characters');
        const chars = await response.json();
        
        const select = document.getElementById('secret-recipient');
        select.innerHTML = '<option value="">Select recipient...</option>';
        
        // Get unique usernames
        const users = [...new Set(chars.map(c => c.username).filter(u => u && u !== currentUser.username))];
        
        users.forEach(username => {
            const option = document.createElement('option');
            option.value = username;
            option.textContent = username;
            select.appendChild(option);
        });
        
        // Add DM option for players
        if (currentUser.role === 'player') {
            const dmOption = document.createElement('option');
            dmOption.value = 'dm';
            dmOption.textContent = 'DM';
            select.appendChild(dmOption);
        }
        
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function openSecretMessageModal() {
    document.getElementById('secret-message-modal').style.display = 'block';
}

function closeSecretMessageModal() {
    document.getElementById('secret-message-modal').style.display = 'none';
    document.getElementById('secret-recipient').value = '';
    document.getElementById('secret-message-text').value = '';
}

async function sendSecretMessage() {
    const recipient = document.getElementById('secret-recipient').value;
    const message = document.getElementById('secret-message-text').value.trim();
    
    if (!recipient || !message) {
        showNotification('Please select a recipient and enter a message', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/secret-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient, message })
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeSecretMessageModal();
            showNotification(`Secret message sent to ${recipient}`, 'success');
        } else {
            showNotification('Failed to send secret message', 'error');
        }
    } catch (error) {
        console.error('Error sending secret message:', error);
        showNotification('Failed to send secret message', 'error');
    }
}

function showSecretMessage(messageData) {
    const parchment = document.getElementById('secret-parchment');
    const sender = document.getElementById('parchment-sender');
    const message = document.getElementById('parchment-message');
    
    sender.textContent = messageData.sender;
    message.textContent = messageData.message;
    
    // Animate parchment appearing
    parchment.style.display = 'block';
    parchment.style.animation = 'parchmentSlideIn 0.8s ease-out';
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
        if (parchment.style.display === 'block') {
            parchment.style.animation = 'parchmentSlideOut 0.5s ease-in';
            setTimeout(() => {
                parchment.style.display = 'none';
            }, 500);
        }
    }, 10000);
}

// DM Book System
async function loadDMBookSection(section) {
    if (currentUser.role !== 'dm' && section !== 'overview') {
        showNotification('Only DMs can access this content', 'warning');
        return;
    }
    
    currentSection = section;
    
    // Update active chapter button
    document.querySelectorAll('.chapter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-section="${section}"]`).classList.add('active');
    
    try {
        const response = await fetch(`/api/dm/book/${section}`);
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('book-chapter-content').innerHTML = `
                <h2>${data.title}</h2>
                ${data.content}
            `;
            
            // Update editor with current content
            document.getElementById('chapter-title').value = data.title;
            document.getElementById('chapter-content').value = data.content;
        } else {
            document.getElementById('book-chapter-content').innerHTML = `
                <h2>Section Not Found</h2>
                <p>This section of the DM book could not be loaded.</p>
            `;
        }
    } catch (error) {
        console.error('Error loading DM book section:', error);
        document.getElementById('book-chapter-content').innerHTML = `
            <h2>Error</h2>
            <p>Failed to load this section. Please try again.</p>
        `;
    }
}

function startEditingChapter() {
    if (currentUser.role !== 'dm') {
        showNotification('Only DMs can edit the book', 'warning');
        return;
    }
    
    editingChapter = true;
    document.getElementById('book-chapter-content').style.display = 'none';
    document.getElementById('book-chapter-editor').style.display = 'block';
    
    document.getElementById('edit-chapter-btn').style.display = 'none';
    document.getElementById('save-chapter-btn').style.display = 'inline-block';
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';
}

function cancelEditingChapter() {
    editingChapter = false;
    document.getElementById('book-chapter-content').style.display = 'block';
    document.getElementById('book-chapter-editor').style.display = 'none';
    
    document.getElementById('edit-chapter-btn').style.display = 'inline-block';
    document.getElementById('save-chapter-btn').style.display = 'none';
    document.getElementById('cancel-edit-btn').style.display = 'none';
}

async function saveChapter() {
    const title = document.getElementById('chapter-title').value;
    const content = document.getElementById('chapter-content').value;
    
    try {
        const response = await fetch(`/api/dm/book/${currentSection}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content })
        });
        
        const data = await response.json();
        
        if (data.success) {
            cancelEditingChapter();
            loadDMBookSection(currentSection);
            showNotification('Chapter saved successfully', 'success');
        } else {
            showNotification('Failed to save chapter', 'error');
        }
    } catch (error) {
        console.error('Error saving chapter:', error);
        showNotification('Failed to save chapter', 'error');
    }
}

// Chat and Dice functionality
function toggleDicePanel() {
    const panel = document.getElementById('quick-dice-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// Campaign data management
async function loadCampaignData() {
    try {
        const response = await fetch('/api/campaign');
        const data = await response.json();
        campaignData = data;
        renderCampaignData();
    } catch (error) {
        console.error('Error loading campaign data:', error);
        showNotification('Failed to load campaign data', 'error');
    }
}

function renderCampaignData() {
    const fields = ['location', 'session_notes', 'npcs', 'treasure'];
    
    fields.forEach(field => {
        const element = document.querySelector(`[data-field="${field}"] .field-content`);
        if (element) {
            const value = campaignData[field] || 'Click edit to add content...';
            element.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        }
    });
}

function updateCampaignField(key, value) {
    campaignData[key] = value;
    const element = document.querySelector(`[data-field="${key}"] .field-content`);
    if (element) {
        element.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }
}

function openEditModal(fieldElement) {
    const field = fieldElement.dataset.field;
    const modal = document.getElementById('edit-modal');
    const title = document.getElementById('edit-modal-title');
    const textarea = document.getElementById('edit-textarea');
    
    title.textContent = `Edit ${field.replace('_', ' ').toUpperCase()}`;
    
    const currentValue = campaignData[field] || '';
    textarea.value = typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2);
    
    currentEditField = field;
    modal.style.display = 'block';
}

async function saveFieldEdit() {
    if (!currentEditField) return;
    
    const textarea = document.getElementById('edit-textarea');
    const value = textarea.value;
    
    try {
        const response = await fetch(`/api/campaign/${currentEditField}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('edit-modal').style.display = 'none';
            showNotification('Field updated successfully', 'success');
        } else {
            showNotification('Failed to update field', 'error');
        }
    } catch (error) {
        console.error('Error updating field:', error);
        showNotification('Failed to update field', 'error');
    }
}

// Chat functionality
async function loadMessages() {
    try {
        const response = await fetch('/api/messages');
        const messages = await response.json();
        renderMessages(messages);
    } catch (error) {
        console.error('Error loading messages:', error);
        showNotification('Failed to load messages', 'error');
    }
}

function renderMessages(messages) {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    
    messages.forEach(message => {
        addMessageToChat(message, false);
    });
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function addMessageToChat(message, scrollToBottom = true) {
    const container = document.getElementById('chat-messages');
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.type || 'chat'}`;
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    
    messageElement.innerHTML = `
        <div class="message-header">
            <span class="message-username">${message.username}</span>
            <span class="message-timestamp">${timestamp}</span>
        </div>
        <div class="message-content">${message.message}</div>
    `;
    
    container.appendChild(messageElement);
    
    if (scrollToBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('send_message', { message, type: 'chat' });
        input.value = '';
    }
}

// File management
async function loadFiles() {
    try {
        const response = await fetch('/api/files');
        const files = await response.json();
        renderFiles(files);
    } catch (error) {
        console.error('Error loading files:', error);
        showNotification('Failed to load files', 'error');
    }
}

function renderFiles(files) {
    const container = document.getElementById('files-list');
    container.innerHTML = '';
    
    if (files.length === 0) {
        container.innerHTML = '<p>No files uploaded yet.</p>';
        return;
    }
    
    files.forEach(file => {
        const fileElement = document.createElement('div');
        fileElement.className = 'file-item';
        
        const uploadDate = new Date(file.upload_date).toLocaleDateString();
        
        fileElement.innerHTML = `
            <div class="file-info">
                <h4>${file.original_name}</h4>
                <div class="file-meta">
                    Uploaded by ${file.uploaded_by} on ${uploadDate}
                </div>
            </div>
            <div class="file-actions">
                <a href="/files/${file.filename}" target="_blank" class="btn btn-primary btn-small">View</a>
                <a href="/files/${file.filename}" download="${file.original_name}" class="btn btn-secondary btn-small">Download</a>
            </div>
        `;
        
        container.appendChild(fileElement);
    });
}

async function uploadFile() {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        showLoading(true);
        
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('File uploaded successfully', 'success');
            loadFiles();
        } else {
            showNotification(data.error || 'Failed to upload file', 'error');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showNotification('Failed to upload file', 'error');
    } finally {
        showLoading(false);
        fileInput.value = '';
    }
}

// Dice rolling
function rollDice(diceType = null, modifier = null, reason = null) {
    const dice = diceType || document.getElementById('dice-type').value;
    const mod = modifier !== null ? modifier : parseInt(document.getElementById('dice-modifier').value) || 0;
    const rollReason = reason || document.getElementById('dice-reason').value;
    
    socket.emit('dice_roll', {
        dice: dice,
        modifier: mod,
        reason: rollReason
    });
    
    // Clear reason field after rolling (but keep dice type and modifier)
    if (!reason) {
        document.getElementById('dice-reason').value = '';
    }
}

// Utility functions
function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (container.contains(notification)) {
                container.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

function showLoading(show) {
    const loading = document.getElementById('loading');
    loading.style.display = show ? 'block' : 'none';
}

// Auto-refresh functionality
setInterval(() => {
    // Refresh data every 30 seconds to keep in sync
    if (!document.hidden) {
        loadCharacters();
        updateCombatDisplay();
    }
}, 30000);

// Handle page visibility change
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Page became visible, refresh data
        loadInitialData();
        renderBattleMap();
    }
});
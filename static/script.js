// Global variables
let socket;
let currentUser = null;
let characters = [];
let campaignData = {};
let currentEditField = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    initializeEventListeners();
    loadInitialData();
});

// Socket.IO initialization
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
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
    
    // Modal close buttons
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', (e) => {
            e.target.closest('.modal').style.display = 'none';
        });
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
    
    document.querySelectorAll('.quick-roll').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const dice = e.target.dataset.dice;
            const reason = e.target.dataset.reason;
            rollDice(dice, 0, reason);
        });
    });
    
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
    }
}

// Load initial data
async function loadInitialData() {
    await loadCharacters();
    await loadCampaignData();
    await loadMessages();
    await loadFiles();
}

// Character management
async function loadCharacters() {
    try {
        const response = await fetch('/api/characters');
        const data = await response.json();
        characters = data;
        renderCharacters();
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
    div.innerHTML = `
        <div class="character-header">
            <div>
                <div class="character-name">${character.name}</div>
                <div class="character-class">${character.class || 'Unknown Class'}</div>
                ${character.username ? `<div class="character-player">Player: ${character.username}</div>` : ''}
            </div>
        </div>
        
        <div class="character-stats">
            <div class="stat-item">
                <span class="stat-label">Level</span>
                <span class="stat-value">${character.level}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">HP</span>
                <span class="stat-value">${character.hp_current}/${character.hp_max}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">AC</span>
                <span class="stat-value">${character.ac}</span>
            </div>
        </div>
        
        ${character.notes ? `<div class="character-notes">${character.notes}</div>` : ''}
        
        <div class="character-controls">
            <button class="btn btn-small btn-primary" onclick="editCharacter(${character.id})">Edit</button>
            <button class="btn btn-small btn-secondary" onclick="duplicateCharacter(${character.id})">Duplicate</button>
        </div>
    `;
    return div;
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
        notes: formData.get('notes'),
        stats: {}
    };
    
    try {
        let response;
        if (modal.dataset.characterId) {
            // Update existing character
            response = await fetch(`/api/characters/${modal.dataset.characterId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(characterData)
            });
        } else {
            // Create new character
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
    loadCharacters();
}, 30000);

// Handle page visibility change
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Page became visible, refresh data
        loadInitialData();
    }
});
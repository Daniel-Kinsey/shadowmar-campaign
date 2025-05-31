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

// Character sheet variables
let currentCharacterSheet = null;
let isEditingSheet = false;

// Skill to ability mapping
const skillAbilityMap = {
    'acrobatics': 'dexterity',
    'animal-handling': 'wisdom',
    'arcana': 'intelligence',
    'athletics': 'strength',
    'deception': 'charisma',
    'history': 'intelligence',
    'insight': 'wisdom',
    'intimidation': 'charisma',
    'investigation': 'intelligence',
    'medicine': 'wisdom',
    'nature': 'intelligence',
    'perception': 'wisdom',
    'performance': 'charisma',
    'persuasion': 'charisma',
    'religion': 'intelligence',
    'sleight-of-hand': 'dexterity',
    'stealth': 'dexterity',
    'survival': 'wisdom'
};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const usernameDisplay = document.getElementById('username-display');
    const roleDisplay = document.getElementById('role-badge');
    
    if (!usernameDisplay || !roleDisplay) {
        console.error('Username or role display elements not found');
        return;
    }
    
    currentUser = {
        username: usernameDisplay.textContent,
        role: roleDisplay.textContent
    };
    
    initializeSocket();
    initializeEventListeners();
    initializeCharacterSheet();
    loadInitialData();
    initializeBattleMap();
    
    // Show DM-only controls if user is DM
    if (currentUser.role === 'dm') {
        const dmCombatControls = document.getElementById('dm-combat-controls');
        const dmBookControls = document.getElementById('dm-book-edit-controls');
        if (dmCombatControls) dmCombatControls.style.display = 'flex';
        if (dmBookControls) dmBookControls.style.display = 'flex';
    }
    
    enhanceAddCharacterButton();
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
        if (data.action === 'delete') {
            showNotification(`${data.character_name} deleted by ${data.deleted_by}`, 'info');
        } else {
            showNotification(`Character updated by ${data.updated_by}`, 'info');
        }
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
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.location.href = '/logout';
        });
    }
    
    // Character management
    const saveCharBtn = document.getElementById('save-character');
    const cancelCharBtn = document.getElementById('cancel-character');
    if (saveCharBtn) saveCharBtn.addEventListener('click', saveCharacter);
    if (cancelCharBtn) cancelCharBtn.addEventListener('click', closeCharacterModal);
    
    // Combat controls
    const startCombatBtn = document.getElementById('start-combat-btn');
    const endCombatBtn = document.getElementById('end-combat-btn');
    const nextTurnBtn = document.getElementById('next-turn-btn');
    const confirmCombatBtn = document.getElementById('confirm-combat-start');
    const cancelCombatBtn = document.getElementById('cancel-combat-setup');
    const addEnemyBtn = document.getElementById('add-enemy-btn');
    
    if (startCombatBtn) startCombatBtn.addEventListener('click', openCombatSetup);
    if (endCombatBtn) endCombatBtn.addEventListener('click', endCombat);
    if (nextTurnBtn) nextTurnBtn.addEventListener('click', nextTurn);
    if (confirmCombatBtn) confirmCombatBtn.addEventListener('click', startCombat);
    if (cancelCombatBtn) cancelCombatBtn.addEventListener('click', closeCombatSetup);
    if (addEnemyBtn) addEnemyBtn.addEventListener('click', addEnemyToCombat);
    
    // Battle map controls
    const openBattlemapBtn = document.getElementById('open-battlemap-window');
    const toggleGridBtn = document.getElementById('toggle-grid');
    const centerMapBtn = document.getElementById('center-map');
    
    if (openBattlemapBtn) openBattlemapBtn.addEventListener('click', openBattleMapWindow);
    if (toggleGridBtn) toggleGridBtn.addEventListener('click', toggleGrid);
    if (centerMapBtn) centerMapBtn.addEventListener('click', centerMap);
    
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            selectTool(e.target.dataset.tool);
        });
    });
    
    // Chat and secret messages
    const secretMsgBtn = document.getElementById('secret-message-btn');
    const diceRollBtn = document.getElementById('dice-roll-btn');
    const sendSecretBtn = document.getElementById('send-secret-message');
    const cancelSecretBtn = document.getElementById('cancel-secret-message');
    
    if (secretMsgBtn) secretMsgBtn.addEventListener('click', openSecretMessageModal);
    if (diceRollBtn) diceRollBtn.addEventListener('click', toggleDicePanel);
    if (sendSecretBtn) sendSecretBtn.addEventListener('click', sendSecretMessage);
    if (cancelSecretBtn) cancelSecretBtn.addEventListener('click', closeSecretMessageModal);
    
    // DM Book controls
    document.querySelectorAll('.chapter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            loadDMBookSection(e.target.dataset.section);
        });
    });
    
    const editChapterBtn = document.getElementById('edit-chapter-btn');
    const saveChapterBtn = document.getElementById('save-chapter-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    
    if (editChapterBtn) editChapterBtn.addEventListener('click', startEditingChapter);
    if (saveChapterBtn) saveChapterBtn.addEventListener('click', saveChapter);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', cancelEditingChapter);
    
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
    const sendMsgBtn = document.getElementById('send-message');
    const chatInput = document.getElementById('chat-input');
    
    if (sendMsgBtn) sendMsgBtn.addEventListener('click', sendMessage);
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
    
    // File upload
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            if (fileInput) fileInput.click();
        });
    }
    
    if (fileInput) fileInput.addEventListener('change', uploadFile);
    
    // Dice rolling
    const rollDiceBtn = document.getElementById('roll-dice');
    if (rollDiceBtn) rollDiceBtn.addEventListener('click', () => rollDice());
    
    // Editable fields
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const field = e.target.closest('.editable-field');
            openEditModal(field);
        }
    });
    
    const saveEditBtn = document.getElementById('save-edit');
    const cancelEditBtn2 = document.getElementById('cancel-edit');
    
    if (saveEditBtn) saveEditBtn.addEventListener('click', saveFieldEdit);
    if (cancelEditBtn2) {
        cancelEditBtn2.addEventListener('click', () => {
            const editModal = document.getElementById('edit-modal');
            if (editModal) editModal.style.display = 'none';
        });
    }
    
    // Battle map mouse events
    const canvas = document.getElementById('battlemap-canvas');
    if (canvas) {
        canvas.addEventListener('mousedown', handleBattleMapMouseDown);
        canvas.addEventListener('mousemove', handleBattleMapMouseMove);
        canvas.addEventListener('mouseup', handleBattleMapMouseUp);
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }
}

// Character Sheet System
function initializeCharacterSheet() {
    // Character sheet event listeners
    const saveSheetBtn = document.getElementById('save-character-sheet');
    const cancelSheetBtn = document.getElementById('cancel-character-sheet');
    const deleteCharBtn = document.getElementById('delete-character-btn');
    
    if (saveSheetBtn) saveSheetBtn.addEventListener('click', saveCharacterSheet);
    if (cancelSheetBtn) cancelSheetBtn.addEventListener('click', closeCharacterSheet);
    if (deleteCharBtn) deleteCharBtn.addEventListener('click', confirmDeleteCharacter);
    
    // Ability score change listeners
    ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(ability => {
        const input = document.getElementById(`sheet-${ability}`);
        if (input) {
            input.addEventListener('input', () => updateModifiers());
        }
    });
    
    // Proficiency bonus and level change listeners
    const profInput = document.getElementById('sheet-proficiency');
    const levelInput = document.getElementById('sheet-level');
    if (profInput) profInput.addEventListener('input', () => updateModifiers());
    if (levelInput) levelInput.addEventListener('change', updateProficiencyBonus);
    
    // Skill and save proficiency listeners
    document.querySelectorAll('.save-checkbox, .skill-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => updateModifiers());
    });
    
    setTimeout(() => {
        addQuickRollListeners();
    }, 1000);
}

// Calculate ability modifier
function getAbilityModifier(score) {
    return Math.floor((score - 10) / 2);
}

// Update all modifiers and dependent values
function updateModifiers() {
    const abilities = {
        strength: parseInt(document.getElementById('sheet-strength').value) || 10,
        dexterity: parseInt(document.getElementById('sheet-dexterity').value) || 10,
        constitution: parseInt(document.getElementById('sheet-constitution').value) || 10,
        intelligence: parseInt(document.getElementById('sheet-intelligence').value) || 10,
        wisdom: parseInt(document.getElementById('sheet-wisdom').value) || 10,
        charisma: parseInt(document.getElementById('sheet-charisma').value) || 10
    };
    
    const proficiencyBonus = parseInt(document.getElementById('sheet-proficiency').value) || 2;
    
    // Update ability modifiers
    Object.entries(abilities).forEach(([ability, score]) => {
        const modifier = getAbilityModifier(score);
        const modElement = document.getElementById(`${ability.substring(0, 3)}-modifier`);
        if (modElement) {
            modElement.textContent = modifier >= 0 ? `+${modifier}` : `${modifier}`;
        }
    });
    
    // Update saving throws
    Object.entries(abilities).forEach(([ability, score]) => {
        const modifier = getAbilityModifier(score);
        const isProficient = document.getElementById(`save-${ability.substring(0, 3)}-prof`).checked;
        const total = modifier + (isProficient ? proficiencyBonus : 0);
        const saveElement = document.getElementById(`save-${ability.substring(0, 3)}`);
        if (saveElement) {
            saveElement.textContent = total >= 0 ? `+${total}` : `${total}`;
        }
    });
    
    // Update skills
    Object.entries(skillAbilityMap).forEach(([skill, ability]) => {
        const abilityScore = abilities[ability];
        const modifier = getAbilityModifier(abilityScore);
        const isProficient = document.getElementById(`skill-${skill}`).checked;
        const total = modifier + (isProficient ? proficiencyBonus : 0);
        const skillElement = document.getElementById(`skill-${skill}-mod`);
        if (skillElement) {
            skillElement.textContent = total >= 0 ? `+${total}` : `${total}`;
        }
    });
    
    // Update initiative (Dex modifier)
    const dexModifier = getAbilityModifier(abilities.dexterity);
    document.getElementById('sheet-initiative').value = dexModifier;
}

// Auto-calculate proficiency bonus based on level
function updateProficiencyBonus() {
    const level = parseInt(document.getElementById('sheet-level').value) || 1;
    const proficiencyBonus = Math.ceil(level / 4) + 1; // D&D 5e proficiency progression
    document.getElementById('sheet-proficiency').value = proficiencyBonus;
    updateModifiers();
}

// Open character sheet with improved error handling
async function openCharacterSheet(characterId = null) {
    try {
        currentCharacterSheet = characterId;
        isEditingSheet = characterId !== null;
        
        const modal = document.getElementById('character-sheet-modal');
        if (!modal) {
            console.error('Character sheet modal not found');
            showNotification('Character sheet modal not found', 'error');
            return;
        }
        
        const title = document.getElementById('character-sheet-title');
        const deleteBtn = document.getElementById('delete-character-btn');
        
        if (isEditingSheet) {
            if (title) title.textContent = 'Character Sheet';
            if (deleteBtn) deleteBtn.style.display = 'inline-block';
            
            try {
                const response = await fetch(`/api/characters/${characterId}/sheet`);
                const character = await response.json();
                
                if (response.ok) {
                    populateCharacterSheet(character);
                } else {
                    showNotification('Failed to load character sheet', 'error');
                    return;
                }
            } catch (error) {
                console.error('Error loading character sheet:', error);
                showNotification('Failed to load character sheet', 'error');
                return;
            }
        } else {
            if (title) title.textContent = 'Create New Character';
            if (deleteBtn) deleteBtn.style.display = 'none';
            clearCharacterSheet();
        }
        
        modal.style.display = 'block';
        setTimeout(() => {
            updateModifiers();
            addQuickRollListeners();
        }, 100);
    } catch (error) {
        console.error('Error opening character sheet:', error);
        showNotification('Failed to open character sheet', 'error');
    }
}

// Populate character sheet with data
function populateCharacterSheet(character) {
    // Basic info
    document.getElementById('sheet-char-name').value = character.name || '';
    document.getElementById('sheet-class').value = character.class || '';
    document.getElementById('sheet-level').value = character.level || 1;
    document.getElementById('sheet-race').value = character.race || '';
    document.getElementById('sheet-background').value = character.background || '';
    document.getElementById('sheet-alignment').value = character.alignment || '';
    
    // Ability scores
    document.getElementById('sheet-strength').value = character.strength || 10;
    document.getElementById('sheet-dexterity').value = character.dexterity || 10;
    document.getElementById('sheet-constitution').value = character.constitution || 10;
    document.getElementById('sheet-intelligence').value = character.intelligence || 10;
    document.getElementById('sheet-wisdom').value = character.wisdom || 10;
    document.getElementById('sheet-charisma').value = character.charisma || 10;
    
    // Combat stats
    document.getElementById('sheet-ac').value = character.ac || 10;
    document.getElementById('sheet-initiative').value = character.initiative || 0;
    document.getElementById('sheet-speed').value = character.speed || 30;
    
    // Hit points
    document.getElementById('sheet-hp-max').value = character.hp_max || 10;
    document.getElementById('sheet-hp-current').value = character.hp_current || 10;
    document.getElementById('sheet-hp-temp').value = 0;
    
    // Other stats
    document.getElementById('sheet-inspiration').value = character.inspiration || 0;
    document.getElementById('sheet-proficiency').value = character.proficiency_bonus || 2;
    
    // Text areas
    document.getElementById('sheet-attacks').value = character.attacks_spells || '';
    document.getElementById('sheet-equipment').value = character.equipment || '';
    document.getElementById('sheet-languages').value = character.languages || '';
    document.getElementById('sheet-features').value = character.features_traits || '';
    document.getElementById('sheet-personality').value = character.personality_traits || '';
    document.getElementById('sheet-ideals').value = character.ideals || '';
    document.getElementById('sheet-bonds').value = character.bonds || '';
    document.getElementById('sheet-flaws').value = character.flaws || '';
    
    // Skills and saves proficiencies
    const skills = character.skills || {};
    const saves = character.saving_throws || {};
    
    Object.keys(skillAbilityMap).forEach(skill => {
        const checkbox = document.getElementById(`skill-${skill}`);
        if (checkbox) {
            checkbox.checked = skills[skill] || false;
        }
    });
    
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(save => {
        const checkbox = document.getElementById(`save-${save}-prof`);
        if (checkbox) {
            checkbox.checked = saves[save] || false;
        }
    });
}

// Clear character sheet for new character
function clearCharacterSheet() {
    // Basic info
    document.getElementById('sheet-char-name').value = '';
    document.getElementById('sheet-class').value = '';
    document.getElementById('sheet-level').value = 1;
    document.getElementById('sheet-race').value = '';
    document.getElementById('sheet-background').value = '';
    document.getElementById('sheet-alignment').value = '';
    
    // Ability scores - set to default 10
    ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(ability => {
        document.getElementById(`sheet-${ability}`).value = 10;
    });
    
    // Combat stats
    document.getElementById('sheet-ac').value = 10;
    document.getElementById('sheet-initiative').value = 0;
    document.getElementById('sheet-speed').value = 30;
    
    // Hit points
    document.getElementById('sheet-hp-max').value = 10;
    document.getElementById('sheet-hp-current').value = 10;
    document.getElementById('sheet-hp-temp').value = 0;
    
    // Other stats
    document.getElementById('sheet-inspiration').value = 0;
    document.getElementById('sheet-proficiency').value = 2;
    
    // Text areas
    document.getElementById('sheet-attacks').value = '';
    document.getElementById('sheet-equipment').value = '';
    document.getElementById('sheet-languages').value = '';
    document.getElementById('sheet-features').value = '';
    document.getElementById('sheet-personality').value = '';
    document.getElementById('sheet-ideals').value = '';
    document.getElementById('sheet-bonds').value = '';
    document.getElementById('sheet-flaws').value = '';
    
    // Clear all checkboxes
    document.querySelectorAll('.save-checkbox, .skill-checkbox, .death-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
}

// Save character sheet
async function saveCharacterSheet() {
    const characterData = gatherCharacterData();
    
    if (!characterData.name.trim()) {
        showNotification('Character name is required', 'warning');
        return;
    }
    
    try {
        let response;
        if (isEditingSheet) {
            response = await fetch(`/api/characters/${currentCharacterSheet}`, {
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
            closeCharacterSheet();
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

// Gather all character data from the form
function gatherCharacterData() {
    // Gather skills proficiencies
    const skills = {};
    Object.keys(skillAbilityMap).forEach(skill => {
        const checkbox = document.getElementById(`skill-${skill}`);
        if (checkbox) {
            skills[skill] = checkbox.checked;
        }
    });
    
    // Gather saving throw proficiencies
    const savingThrows = {};
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(save => {
        const checkbox = document.getElementById(`save-${save}-prof`);
        if (checkbox) {
            savingThrows[save] = checkbox.checked;
        }
    });
    
    return {
        name: document.getElementById('sheet-char-name').value,
        class: document.getElementById('sheet-class').value,
        race: document.getElementById('sheet-race').value,
        background: document.getElementById('sheet-background').value,
        level: parseInt(document.getElementById('sheet-level').value) || 1,
        alignment: document.getElementById('sheet-alignment').value,
        
        // Ability scores
        strength: parseInt(document.getElementById('sheet-strength').value) || 10,
        dexterity: parseInt(document.getElementById('sheet-dexterity').value) || 10,
        constitution: parseInt(document.getElementById('sheet-constitution').value) || 10,
        intelligence: parseInt(document.getElementById('sheet-intelligence').value) || 10,
        wisdom: parseInt(document.getElementById('sheet-wisdom').value) || 10,
        charisma: parseInt(document.getElementById('sheet-charisma').value) || 10,
        
        // Combat stats
        hp_current: parseInt(document.getElementById('sheet-hp-current').value) || 10,
        hp_max: parseInt(document.getElementById('sheet-hp-max').value) || 10,
        ac: parseInt(document.getElementById('sheet-ac').value) || 10,
        speed: parseInt(document.getElementById('sheet-speed').value) || 30,
        initiative: parseInt(document.getElementById('sheet-initiative').value) || 0,
        
        // Other stats
        inspiration: parseInt(document.getElementById('sheet-inspiration').value) || 0,
        proficiency_bonus: parseInt(document.getElementById('sheet-proficiency').value) || 2,
        
        // Text fields
        attacks_spells: document.getElementById('sheet-attacks').value,
        equipment: document.getElementById('sheet-equipment').value,
        languages: document.getElementById('sheet-languages').value,
        proficiencies: document.getElementById('sheet-languages').value, // Combine for now
        features_traits: document.getElementById('sheet-features').value,
        personality_traits: document.getElementById('sheet-personality').value,
        ideals: document.getElementById('sheet-ideals').value,
        bonds: document.getElementById('sheet-bonds').value,
        flaws: document.getElementById('sheet-flaws').value,
        
        // Proficiencies
        skills: skills,
        saving_throws: savingThrows,
        
        // Additional fields
        stats: {},
        spell_slots: {},
        status_effects: [],
        notes: ''
    };
}

// Close character sheet
function closeCharacterSheet() {
    document.getElementById('character-sheet-modal').style.display = 'none';
    currentCharacterSheet = null;
    isEditingSheet = false;
}

// Delete character functionality
function deleteCharacter(characterId, characterName) {
    if (confirm(`Are you sure you want to delete "${characterName}"? This action cannot be undone.`)) {
        performDeleteCharacter(characterId);
    }
}

function confirmDeleteCharacter() {
    if (currentCharacterSheet) {
        const characterName = document.getElementById('sheet-char-name').value || 'this character';
        if (confirm(`Are you sure you want to delete "${characterName}"? This action cannot be undone.`)) {
            performDeleteCharacter(currentCharacterSheet);
        }
    }
}

async function performDeleteCharacter(characterId) {
    try {
        const response = await fetch(`/api/characters/${characterId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeCharacterSheet();
            loadCharacters();
            showNotification('Character deleted successfully', 'success');
        } else {
            showNotification('Failed to delete character', 'error');
        }
    } catch (error) {
        console.error('Error deleting character:', error);
        showNotification('Failed to delete character', 'error');
    }
}

// Quick roll functions
function rollSkill(skillName) {
    const skillElement = document.getElementById(`skill-${skillName}-mod`);
    if (skillElement) {
        const modifier = parseInt(skillElement.textContent) || 0;
        const characterName = document.getElementById('sheet-char-name').value || 'Character';
        
        socket.emit('dice_roll', {
            dice: 'd20',
            modifier: modifier,
            reason: `${skillName.replace('-', ' ')} check for ${characterName}`
        });
    }
}

function rollSave(saveAbility) {
    const saveElement = document.getElementById(`save-${saveAbility}`);
    if (saveElement) {
        const modifier = parseInt(saveElement.textContent) || 0;
        const characterName = document.getElementById('sheet-char-name').value || 'Character';
        const abilityNames = {
            'str': 'Strength',
            'dex': 'Dexterity', 
            'con': 'Constitution',
            'int': 'Intelligence',
            'wis': 'Wisdom',
            'cha': 'Charisma'
        };
        
        socket.emit('dice_roll', {
            dice: 'd20',
            modifier: modifier,
            reason: `${abilityNames[saveAbility]} save for ${characterName}`
        });
    }
}

// Add click listeners for quick rolls
function addQuickRollListeners() {
    // Add click listeners to skill modifiers
    document.querySelectorAll('.skill-modifier').forEach(element => {
        const skillName = element.id.replace('skill-', '').replace('-mod', '');
        element.style.cursor = 'pointer';
        element.title = `Click to roll ${skillName.replace('-', ' ')}`;
        element.addEventListener('click', () => rollSkill(skillName));
    });
    
    // Add click listeners to save modifiers
    document.querySelectorAll('.save-modifier').forEach(element => {
        const saveAbility = element.id.replace('save-', '');
        element.style.cursor = 'pointer';
        element.title = `Click to roll ${saveAbility} save`;
        element.addEventListener('click', () => rollSave(saveAbility));
    });
}

// Enhanced add character button functionality
function enhanceAddCharacterButton() {
    const addCharacterBtn = document.getElementById('add-character-btn');
    if (addCharacterBtn) {
        addCharacterBtn.onclick = () => openCharacterSheet();
    }
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
    const selectedTab = document.getElementById(`${tabName}-tab`);
    const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);
    
    if (selectedTab) selectedTab.classList.add('active');
    if (selectedBtn) selectedBtn.classList.add('active');
    
    // Load tab-specific data if needed
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

// Load initial data on application startup
async function loadInitialData() {
    try {
        await loadCharacters();
        await loadCampaignData();
        await loadMessages();
        await loadFiles();
        await loadCombatState();
        await loadUsersList();
    } catch (error) {
        console.error('Error loading initial data:', error);
        showNotification('Failed to load some data. Please refresh the page.', 'warning');
    }
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
    
    // Check if user can delete this character
    const canDelete = currentUser.role === 'dm' || character.user_id === currentUser.id;
    const canEdit = currentUser.role === 'dm' || character.user_id === currentUser.id;
    
    div.innerHTML = `
        <div class="character-header">
            <div>
                <div class="character-name">${character.name}</div>
                <div class="character-class">${character.class || 'Unknown Class'} ${character.race ? `(${character.race})` : ''} - Level ${character.level}</div>
                ${character.username ? `<div class="character-player">Player: ${character.username}</div>` : ''}
            </div>
        </div>
        
        <div class="character-stats">
            <div class="stat-item">
                <span class="stat-label">HP</span>
                <span class="stat-value hp-tracker" data-char-id="${character.id}">
                    ${canEdit ? 
                        `<input type="number" class="hp-input" value="${character.hp_current}" min="0" max="${character.hp_max}" data-char-id="${character.id}">` :
                        character.hp_current
                    }
                    /${character.hp_max}
                </span>
            </div>
            <div class="stat-item">
                <span class="stat-label">AC</span>
                <span class="stat-value">${character.ac}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Speed</span>
                <span class="stat-value">${character.speed || 30}ft</span>
            </div>
        </div>
        
        ${statusEffectsHtml}
        
        <div class="character-controls">
            <button class="btn btn-small btn-primary" onclick="openCharacterSheet(${character.id})">📋 View Sheet</button>
            ${canEdit ? `<button class="btn btn-small btn-secondary" onclick="editCharacter(${character.id})">✏️ Quick Edit</button>` : ''}
            ${canDelete ? `<button class="btn btn-small btn-danger" onclick="deleteCharacter(${character.id}, '${character.name.replace(/'/g, "\\'")}')">🗑️ Delete</button>` : ''}
            ${character.in_combat ? '<span class="combat-indicator">⚔️ In Combat</span>' : ''}
        </div>
    `;
    
    // Add HP change listeners only if user can edit
    if (canEdit) {
        const hpInput = div.querySelector('.hp-input');
        if (hpInput) {
            hpInput.addEventListener('change', (e) => {
                updateCharacterHP(character.id, parseInt(e.target.value));
            });
        }
    }
    
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
    if (!playerSheet) return;
    
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
                    <span>Speed:</span> <span>${character.speed || 30}ft</span>
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
    if (!canvas) return;
    
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
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const tokensContainer = document.getElementById('battlemap-tokens');
    if (!tokensContainer) return;
    
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
    if (!tokensContainer) return;
    
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
    if (canvas) {
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
    if (!tokenList) return;
    
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
    window.open('/battlemap', '_blank', 'width=1200,height=800');
}

// Campaign data functions
async function loadCampaignData() {
    try {
        const response = await fetch('/api/campaign');
        const data = await response.json();
        campaignData = data;
        updateCampaignFields();
    } catch (error) {
        console.error('Error loading campaign data:', error);
        showNotification('Failed to load campaign data', 'error');
    }
}

function updateCampaignFields() {
    Object.entries(campaignData).forEach(([key, value]) => {
        updateCampaignField(key, value);
    });
}

function updateCampaignField(key, value) {
    const field = document.querySelector(`[data-field="${key}"] .field-content`);
    if (field) {
        field.textContent = value || 'No data available';
    }
}

function openEditModal(field) {
    const fieldKey = field.dataset.field;
    const content = campaignData[fieldKey] || '';
    
    currentEditField = fieldKey;
    
    const modal = document.getElementById('edit-modal');
    const textarea = document.getElementById('edit-textarea');
    const title = document.getElementById('edit-modal-title');
    
    title.textContent = `Edit ${fieldKey.replace('_', ' ').toUpperCase()}`;
    textarea.value = content;
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

// Chat functions
async function loadMessages() {
    try {
        const response = await fetch('/api/messages');
        const messages = await response.json();
        
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        
        messages.forEach(message => {
            addMessageToChat(message);
        });
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    } catch (error) {
        console.error('Error loading messages:', error);
        showNotification('Failed to load messages', 'error');
    }
}

function addMessageToChat(message) {
    const container = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.type || 'chat'}`;
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">${message.username}</span>
            <span class="message-timestamp">${timestamp}</span>
        </div>
        <div class="message-content">${message.message}</div>
    `;
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('send_message', { message });
        input.value = '';
    }
}

// Secret message functions
async function loadUsersList() {
    // For now, we'll just populate with known users
    const select = document.getElementById('secret-recipient');
    if (select) {
        select.innerHTML = '<option value="">Select recipient...</option>';
        
        // Add all users except current user
        if (currentUser.role === 'dm') {
            // DM can send to all players
            const uniquePlayers = [...new Set(characters.map(c => c.username))];
            uniquePlayers.forEach(username => {
                if (username && username !== currentUser.username) {
                    const option = document.createElement('option');
                    option.value = username;
                    option.textContent = username;
                    select.appendChild(option);
                }
            });
        } else {
            // Players can send to DM
            const option = document.createElement('option');
            option.value = 'dm';
            option.textContent = 'Dungeon Master';
            select.appendChild(option);
        }
    }
}

function openSecretMessageModal() {
    const modal = document.getElementById('secret-message-modal');
    loadUsersList();
    modal.style.display = 'block';
}

function closeSecretMessageModal() {
    const modal = document.getElementById('secret-message-modal');
    modal.style.display = 'none';
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
            showNotification('Secret message sent!', 'success');
        } else {
            showNotification('Failed to send message', 'error');
        }
    } catch (error) {
        console.error('Error sending secret message:', error);
        showNotification('Failed to send message', 'error');
    }
}

function showSecretMessage(data) {
    const parchment = document.getElementById('secret-parchment');
    const sender = document.getElementById('parchment-sender');
    const message = document.getElementById('parchment-message');
    
    sender.textContent = data.sender;
    message.textContent = data.message;
    
    parchment.style.display = 'block';
    parchment.style.animation = 'parchmentSlideIn 0.5s ease-out';
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
        parchment.style.animation = 'parchmentSlideOut 0.5s ease-out';
        setTimeout(() => {
            parchment.style.display = 'none';
        }, 500);
    }, 10000);
}

// Dice rolling functions
function toggleDicePanel() {
    const panel = document.getElementById('quick-dice-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function rollDice() {
    const diceType = document.getElementById('dice-type').value;
    const modifier = parseInt(document.getElementById('dice-modifier').value) || 0;
    const reason = document.getElementById('dice-reason').value;
    
    socket.emit('dice_roll', {
        dice: diceType,
        modifier: modifier,
        reason: reason
    });
}

// File management functions
async function loadFiles() {
    try {
        const response = await fetch('/api/files');
        const files = await response.json();
        
        const container = document.getElementById('files-list');
        container.innerHTML = '';
        
        files.forEach(file => {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'file-item';
            
            const uploadDate = new Date(file.upload_date).toLocaleDateString();
            
            fileDiv.innerHTML = `
                <div class="file-info">
                    <h4>${file.original_name}</h4>
                    <div class="file-meta">
                        Uploaded by ${file.uploaded_by} on ${uploadDate}
                    </div>
                </div>
                <div class="file-actions">
                    <a href="/files/${file.filename}" target="_blank" class="btn btn-small btn-primary">View</a>
                    <a href="/files/${file.filename}" download="${file.original_name}" class="btn btn-small btn-secondary">Download</a>
                </div>
            `;
            
            container.appendChild(fileDiv);
        });
    } catch (error) {
        console.error('Error loading files:', error);
        showNotification('Failed to load files', 'error');
    }
}

async function uploadFile() {
    const input = document.getElementById('file-input');
    const file = input.files[0];
    
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            input.value = '';
            showNotification('File uploaded successfully', 'success');
        } else {
            showNotification('Failed to upload file', 'error');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showNotification('Failed to upload file', 'error');
    }
}

// DM Book functions
async function loadDMBookSection(section) {
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
        } else {
            document.getElementById('book-chapter-content').innerHTML = `
                <h2>Error</h2>
                <p>Failed to load section: ${data.error}</p>
            `;
        }
    } catch (error) {
        console.error('Error loading DM book section:', error);
        document.getElementById('book-chapter-content').innerHTML = `
            <h2>Error</h2>
            <p>Failed to load section. Please try again.</p>
        `;
    }
}

function startEditingChapter() {
    if (currentUser.role !== 'dm') return;
    
    editingChapter = true;
    
    const content = document.getElementById('book-chapter-content');
    const editor = document.getElementById('book-chapter-editor');
    const editBtn = document.getElementById('edit-chapter-btn');
    const saveBtn = document.getElementById('save-chapter-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    
    // Get current content
    const titleElement = content.querySelector('h2');
    const title = titleElement ? titleElement.textContent : '';
    const contentHtml = content.innerHTML.replace(/<h2>.*?<\/h2>/, '').trim();
    
    document.getElementById('chapter-title').value = title;
    document.getElementById('chapter-content').value = contentHtml;
    
    content.style.display = 'none';
    editor.style.display = 'block';
    editBtn.style.display = 'none';
    saveBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'inline-block';
}

async function saveChapter() {
    if (currentUser.role !== 'dm') return;
    
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

function cancelEditingChapter() {
    editingChapter = false;
    
    const content = document.getElementById('book-chapter-content');
    const editor = document.getElementById('book-chapter-editor');
    const editBtn = document.getElementById('edit-chapter-btn');
    const saveBtn = document.getElementById('save-chapter-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    
    content.style.display = 'block';
    editor.style.display = 'none';
    editBtn.style.display = 'inline-block';
    saveBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
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

// Initialize DM Book on load
document.addEventListener('DOMContentLoaded', () => {
    // Load default DM Book section after other initialization
    setTimeout(() => {
        loadDMBookSection('overview');
    }, 500);
});
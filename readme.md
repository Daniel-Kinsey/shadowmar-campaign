# Chronicles of Shadowmar - Campaign Management System

A professional, full-featured D&D campaign management application designed specifically for the Chronicles of Shadowmar pirate campaign. This system provides everything a DM needs to run immersive sessions with real-time party tracking, NPC dialog management, combat tracking, and an interactive battle map.

## 🏴‍☠️ Features

### **Core Campaign Management**
- **Real-time Party Dashboard**: Track HP, AC, spell slots, location, and status effects
- **Interactive Player Stats**: Click to edit HP, spell slots, and other vital statistics
- **Level Management**: Automatic XP tracking with level-up notifications
- **Session Notes**: Comprehensive session logging and history

### **Advanced NPC System**
- **Dynamic Dialog Engine**: Pre-made responses by category (greeting, quest, help, goodbye)
- **Personality-Based Responses**: Each NPC has unique personality traits affecting their speech
- **Custom Response Builder**: Add custom dialog on-the-fly during sessions
- **NPC Database**: Organize NPCs by importance and location

### **Combat Management**
- **Initiative Tracker**: Automated sorting with turn progression
- **Health Tracking**: Real-time HP management for all combatants
- **Status Effects**: Track buffs, debuffs, and conditions
- **Turn Timer**: Optional 30-second turn timer with visual countdown
- **Round Counter**: Automatic round progression

### **Interactive Battle Map**
- **Grid-Based Movement**: Drag-and-drop token positioning
- **Spell Templates**: Visual spell area effects (15ft cone, 20ft radius, etc.)
- **Measurement Tools**: Distance measurement with line-of-sight checking
- **Token Management**: Player, enemy, and NPC tokens with color coding
- **Fullscreen Display**: Perfect for table-mounted screens

### **Quest & Experience System**
- **Quest Database**: Track all campaign quests with status updates
- **XP Distribution**: Party-wide experience awarding with automatic level calculations
- **Treasure Management**: Log and track treasure distribution
- **Progress Tracking**: Visual progress bars for XP to next level

### **Interactive Sourcebook**
- **Live Editing**: Edit campaign content in real-time
- **Chapter Organization**: Organized by campaign sections
- **Content Management**: Add new NPCs, locations, and lore during sessions
- **Backup System**: Automatic content versioning

### **Professional Features**
- **Multi-User Support**: Admin, DM, and Player roles
- **Secure Authentication**: JWT-based login system
- **Auto-Save**: Automatic data persistence every 30 seconds
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Keyboard Shortcuts**: Spacebar for initiative, Ctrl+S for save, Ctrl+B for battle map

## 🚀 Deployment

### **Railway Deployment** (Recommended)

1. **Fork this repository** to your GitHub account

2. **Connect to Railway**:
   - Go to [Railway.app](https://railway.app)
   - Click "Start a New Project"
   - Choose "Deploy from GitHub repo"
   - Select your forked repository

3. **Environment Variables**:
   Railway will automatically detect this as a Node.js app. Set these environment variables in your Railway dashboard:
   ```
   JWT_SECRET=your_super_secure_jwt_secret_key_here
   NODE_ENV=production
   ```

4. **Deploy**:
   - Railway will automatically build and deploy your application
   - Your app will be available at a Railway-provided URL

### **Docker Deployment**

```bash
# Build the image
docker build -t shadowmar-campaign .

# Run the container
docker run -p 3000:3000 -e JWT_SECRET=your_secret_key shadowmar-campaign
```

### **Local Development**

```bash
# Clone the repository
git clone https://github.com/yourusername/shadowmar-campaign-manager.git
cd shadowmar-campaign-manager

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your settings
# Start the development server
npm run dev
```

## 🎮 Usage

### **Initial Setup**

1. **First Login**: Use the default credentials:
   - Username: `dm`
   - Password: `shadowmar2024`

2. **Add Players**: Navigate to the Players section and add your party members

3. **Configure NPCs**: Set up key NPCs in the NPC section with their personalities and responses

4. **Create Quests**: Add current campaign quests in the Quest section

### **Running a Session**

1. **Dashboard Overview**: Start each session by reviewing the party status on the main dashboard

2. **Combat Management**:
   - Click "Roll Initiative" to start combat
   - Use the initiative tracker to manage turn order
   - Click HP values to adjust health during combat

3. **NPC Interactions**:
   - Click "Talk" next to any NPC for instant dialog options
   - Use pre-made responses or add custom dialog
   - Responses are randomly selected from available options

4. **Battle Map**:
   - Click "Open Battle Map" for the interactive map
   - Add tokens for players, enemies, and NPCs
   - Use spell templates and measurement tools
   - Perfect for a table-mounted screen or second monitor

5. **Session Notes**:
   - Document important events in the Session Notes section
   - Notes are automatically timestamped and organized

### **XP and Loot Management**

1. **Award Experience**: Use the Loot & XP section to distribute party XP
2. **Level-Up Notifications**: Players who can level up will show notifications
3. **Treasure Tracking**: Log treasure finds and distribution

## 🔧 Configuration

### **Environment Variables**

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | Secret key for authentication | Required |
| `NODE_ENV` | Environment mode | `development` |
| `ADMIN_USERNAME` | Default admin username | `dm` |
| `ADMIN_PASSWORD` | Default admin password | `shadowmar2024` |

### **Database**

The application uses SQLite for data storage, which is perfect for Railway deployment. The database is automatically created and initialized on first startup.

### **Security Features**

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS Protection**: Configurable cross-origin resource sharing
- **Helmet Security**: Security headers for production
- **Input Validation**: All user inputs are validated and sanitized
- **Authentication**: JWT tokens with 24-hour expiration

## 📱 Mobile Support

The application is fully responsive and supports:
- **Touch Interactions**: Tap to edit, drag tokens on mobile
- **Responsive Layout**: Adapts to any screen size
- **Mobile-Friendly Controls**: Large touch targets for mobile users

## 🎯 Campaign-Specific Features

### **Shadowmar Lore Integration**
- Pre-loaded with Xylos NPCs and locations
- Constellation-based magic system references
- Pirate ship role mechanics
- Drowned city atmosphere and themes

### **Session Continuity**
- Tracks current party location (Xylos Market Square)
- Session 3 starting point with previous session history
- Pre-configured with campaign NPCs (The Minister, Trenchkin Elder)
- Quest progression from previous sessions

## 🛠️ Technical Details

### **Technology Stack**
- **Backend**: Node.js with Express
- **Database**: SQLite with sqlite3
- **Authentication**: JWT with bcryptjs
- **Frontend**: Vanilla JavaScript with modern CSS
- **Security**: Helmet, express-rate-limit, express-validator

### **API Endpoints**
- `POST /api/login` - User authentication
- `GET /api/players` - Retrieve all players
- `PUT /api/players/:id` - Update player data
- `GET /api/npcs` - Retrieve all NPCs
- `POST /api/npcs` - Create new NPC
- `GET /api/combat` - Get combat state
- `PUT /api/combat` - Update combat state
- `GET /api/battle-map` - Get battle map data
- `PUT /api/battle-map` - Update battle map

### **Performance Optimizations**
- **Compression**: Gzip compression for all responses
- **Caching**: Static asset caching
- **Database Indexing**: Optimized queries for real-time updates
- **Memory Management**: Efficient data structures for large campaigns

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## ⚓ Support

For support, feature requests, or bug reports, please open an issue on GitHub.

---

**May your blades stay sharp, your wits keen, and your sails always catch the twilight wind!** 🏴‍☠️
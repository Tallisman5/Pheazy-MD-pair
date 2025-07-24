require('dotenv').config();
const { makeWALegacySocket, useSingleFileAuthState, delay } = require('@whiskeysockets/baileys');
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Store pairing codes and session data (in production, use a database)
const activePairings = new Map();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Generate random pairing code (format: LORD-XXXX)
function generatePairingCode() {
    const prefix = "LORD-";
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return prefix + code;
}

// Generate random session ID (format: Pheazy~20chars)
function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/request-pairing', (req, res) => {
    const { number } = req.body;
    
    if (!number || !number.match(/^\d{10,15}$/)) {
        return res.status(400).json({ error: "Invalid number format. Please enter digits only (10-15 digits)" });
    }
    
    const pairingCode = generatePairingCode();
    activePairings.set(pairingCode, { 
        number: number + '@s.whatsapp.net',
        status: 'pending',
        createdAt: Date.now(),
        attempts: 0
    });
    
    // Cleanup old pending pairings
    cleanupPairings();
    
    res.json({ 
        code: pairingCode,
        message: "Check your WhatsApp for a pairing notification"
    });
});

// Cleanup pending pairings older than 15 minutes
function cleanupPairings() {
    const now = Date.now();
    for (const [code, data] of activePairings.entries()) {
        if (data.status === 'pending' && (now - data.createdAt) > 15 * 60 * 1000) {
            activePairings.delete(code);
        }
    }
}

// WhatsApp Client Initialization
async function initWhatsAppClient() {
    const { state, saveState } = useSingleFileAuthState('./auth_info.json');
    
    const sock = makeWALegacySocket({
        auth: state,
        printQRInTerminal: true,
        logger: console,
        version: [2, 2413, 1], // Latest version as of July 2025
        browser: ['Pheazy-MD Pairing', 'Safari', '1.0.0']
    });
    
    // Connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== 401) {
                console.log("Reconnecting...");
                initWhatsAppClient();
            } else {
                console.log("Connection closed. Please restart the server.");
            }
        }
        
        if (connection === 'open') {
            console.log("WhatsApp client connected");
        }
        
        if (qr) {
            console.log("QR code generated");
        }
    });
    
    // Save credentials
    sock.ev.on('creds.update', saveState);
    
    // Message handler
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message || !message.message) return;
        
        const messageText = message.message.extendedTextMessage?.text || 
                          message.message.conversation;
        
        // Check for pairing confirmation
        if (messageText && messageText.includes('trying to link a device?')) {
            const quotedText = message.message.extendedTextMessage?.contextInfo?.quotedMessage?.conversation;
            const pairingCode = extractPairingCode(quotedText || messageText);
            
            if (pairingCode && activePairings.has(pairingCode)) {
                const pairing = activePairings.get(pairingCode);
                pairing.attempts += 1;
                
                // Generate session ID
                const sessionId = `Pheazy~${generateRandomString(20)}`;
                
                // Send session ID to user
                await sock.sendMessage(pairing.number, {
                    text: `hi thanks for choosing Pheazy-MD this is your session id below copy and use it to deploy your bot\n${sessionId}`,
                    forwarded: true
                });
                
                // Mark as completed
                pairing.status = 'completed';
                pairing.sessionId = sessionId;
                pairing.completedAt = Date.now();
                
                console.log(`Session ID delivered to ${pairing.number}`);
            }
        }
    });
    
    return sock;
}

function extractPairingCode(text) {
    if (!text) return null;
    const match = text.match(/LORD-[A-Z0-9]{4}/);
    return match ? match[0] : null;
}

// Start server
async function startServer() {
    try {
        await initWhatsAppClient();
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Pairing site available at: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log("Shutting down server...");
    process.exit(0);
});
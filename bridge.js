/**
 * @file bridge.js
 * @description WebSocket (Browser) <-> TCP (C Server) Bridge + Web Server
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Environment Variables
const PORT = process.env.PORT || 9000;
const TCP_PORT = parseInt(process.env.TCP_PORT) || 9001;
const TCP_HOST = process.env.TCP_HOST || '127.0.0.1';

// 1. Static Web Server (Serve monitoring dashboard)
app.use(express.static(__dirname));

// 2. WebSocket Server (for Browser, attached to same HTTP server)
const wss = new WebSocket.Server({ server });
console.log(`🚀 Monitoring Server running on port ${PORT}`);

// 3. TCP Client (to C Server)
let tcpClient = null;

function connectToCServer() {
    console.log(`🔗 Connecting to C Server at ${TCP_HOST}:${TCP_PORT}...`);
    tcpClient = new net.Socket();

    tcpClient.connect(TCP_PORT, TCP_HOST, () => {
        console.log('✅ Successfully connected to C Server');
    });

    let buffer = Buffer.alloc(0);

    tcpClient.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 4) {
            const msgLen = buffer.readUInt32BE(0);

            if (buffer.length >= 4 + msgLen) {
                const jsonStr = buffer.slice(4, 4 + msgLen).toString();
                buffer = buffer.slice(4 + msgLen);

                // Forward to all connected WS clients
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(jsonStr);
                    }
                });
            } else {
                break;
            }
        }
    });

    tcpClient.on('close', () => {
        console.log('❌ C Server disconnected. Retrying in 2 seconds...');
        setTimeout(connectToCServer, 2000);
    });

    tcpClient.on('error', (err) => {
        console.error('⚠️ TCP Error:', err.message);
    });
}

connectToCServer();

wss.on('connection', (ws) => {
    console.log('👤 Browser client connected');
    ws.on('close', () => console.log('👤 Browser client disconnected'));
});

// Start the integrated server
server.listen(PORT, () => {
    console.log(`📡 Dashboard available at http://localhost:${PORT}`);
});
